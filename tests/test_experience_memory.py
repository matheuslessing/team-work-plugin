#!/usr/bin/env python3
"""
Tests and Stress Tests for Rejected Edit Buffer & Harness² Experience Library.
1. Validates that previously rejected edits are strictly blocked from re-attempt.
2. Validates persistent EXPERIENCE.md accumulation and invariant rules.
3. Stress tests 1,000 rapid negative queries across high-concurrency threads.
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
        """1,000 concurrent buffer writes and queries."""
        for i in range(100):
            self.buffer.record_rejected_edit(f"skill_{i}", f"t_{i}", f"r_{i}", "bad")

        def query_task(idx):
            blocked, _ = self.buffer.is_edit_prohibited(f"skill_{idx % 100}", f"t_{idx % 100}", f"r_{idx % 100}")
            return blocked

        start = time.time()
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(query_task, range(1000)))
        elapsed = time.time() - start

        self.assertTrue(all(results))
        self.assertLess(elapsed, 0.5, f"1000 buffer queries took too long: {elapsed:.3f}s")


if __name__ == "__main__":
    unittest.main(verbosity=2)
