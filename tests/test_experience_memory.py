#!/usr/bin/env python3
"""
Tests and Stress Tests for Rejected Edit Buffer & Harness² Experience Library.
1. Validates that previously rejected edits are strictly blocked from re-attempt.
2. Validates persistent EXPERIENCE.md accumulation and invariant rules.
3. Stress tests 100 concurrent writes and 1,000 rapid negative queries across high-concurrency threads.
"""

import concurrent.futures
import tempfile
import time
import unittest
from pathlib import Path
import sys

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
memory_mod = importlib.import_module("experience-memory")


class TestExperienceMemoryAndRejectionBuffer(unittest.TestCase):
    """Tests rejected edit buffer gating and invariant lesson accumulation."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.buffer = memory_mod.RejectedEditBuffer(self.tmp_path)
        self.exp_lib = memory_mod.HarnessExperienceLibrary(self.tmp_path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_rejected_edit_blocking(self):
        skill = "deploy-skill"
        target = "run old_cmd"
        replacement = "run bad_candidate"

        # Initially not blocked
        blocked, _ = self.buffer.is_edit_prohibited(skill, target, replacement)
        self.assertFalse(blocked)

        # Record failed attempt into buffer
        self.buffer.record_rejected_edit(skill, target, replacement, "Exit status 1: invalid argument")

        # Now it MUST be blocked
        blocked, reason = self.buffer.is_edit_prohibited(skill, target, replacement)
        self.assertTrue(blocked)
        self.assertIn("rejected_edit_buffer", reason)

    def test_harness_experience_accumulation(self):
        self.exp_lib.record_invariant_lesson(
            title="DOCKER_VM_SUDO",
            rule="Always prepend sudo in this Ubuntu VM container",
            context="Encountered permission denied on docker.sock"
        )
        lessons = self.exp_lib.get_accumulated_lessons()
        self.assertIn("DOCKER_VM_SUDO", lessons)
        self.assertIn("Always prepend sudo", lessons)

    def test_high_concurrency_buffer_stress(self):
        """Validates that 100 concurrent writes survive with 0% data loss under parallel load."""
        def write_task(idx):
            self.buffer.record_rejected_edit(f"skill_{idx}", f"t_{idx}", f"r_{idx}", "bad")

        # 100 concurrent writers
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            list(pool.map(write_task, range(100)))

        # Verify all 100 entries survived
        import json
        persisted = json.loads(self.buffer.buffer_file.read_text(encoding="utf-8"))
        self.assertEqual(len(persisted), 100, f"Expected 100 entries, but got {len(persisted)} (data loss detected!)")

        # 1,000 concurrent queries
        def query_task(idx):
            blocked, _ = self.buffer.is_edit_prohibited(f"skill_{idx % 100}", f"t_{idx % 100}", f"r_{idx % 100}")
            return blocked

        start = time.time()
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(query_task, range(1000)))
        elapsed = time.time() - start

        self.assertTrue(all(results))
        self.assertLess(elapsed, 1.0, f"1000 buffer queries took too long: {elapsed:.3f}s")

    def test_concurrent_experience_lessons(self):
        """Validates that concurrent invariant lessons from multiple agents accumulate safely."""
        def record_task(idx):
            self.exp_lib.record_invariant_lesson(f"RULE_{idx}", f"Rule content {idx}", f"Context {idx}")

        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            list(pool.map(record_task, range(50)))

        accumulated = self.exp_lib.get_accumulated_lessons()
        for idx in range(50):
            self.assertIn(f"RULE_{idx}", accumulated)


if __name__ == "__main__":
    unittest.main(verbosity=2)
