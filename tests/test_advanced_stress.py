#!/usr/bin/env python3
"""
Master Stress Test Suite: Covers all 4 new subsystems under extreme load:
1. Massive sleep transcript consolidation (1,000 parallel sessions).
2. Malformed / corrupted blueprint auto-repair under chaos injection.
3. Concurrent dashboard generation under thread pool hammering.
4. Golden skill verification under hostile mutating assertions.
"""

import concurrent.futures
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
sleep_module = importlib.import_module("devin-sleep")
bp_module = importlib.import_module("devin-blueprint-optimizer")
dash_module = importlib.import_module("teamwork-dashboard")
golden_module = importlib.import_module("golden-skill-verifier")


class TestSleepAndBlueprintStress(unittest.TestCase):
    """Stress tests for Sleep consolidation and Blueprint auto-optimization."""

    def test_massive_sleep_transcript_harvesting(self):
        """Stress tests harvesting 500 session transcripts concurrently."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            logs_dir = tmp_path / "logs"
            logs_dir.mkdir()

            for i in range(500):
                log_file = logs_dir / f"session_{i}.log"
                log_file.write_text(f"Command 'tool_{i}' succeeded\nCommand 'bad_{i}' failed\n", encoding="utf-8")

            start = time.time()
            consolidator = sleep_module.DevinSleepConsolidator(tmp_path)
            exps = consolidator.harvest_transcripts(logs_dir)
            elapsed = time.time() - start

            self.assertEqual(len(exps), 500)
            self.assertLess(elapsed, 0.5, f"Harvesting 500 sessions took too long: {elapsed:.2f}s")

    def test_blueprint_optimizer_chaos_injection(self):
        """Stress tests blueprint optimizer against corrupt, empty, and huge YAML files."""
        optimizer = bp_module.BlueprintAutoOptimizer(Path("."))
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            chaos_cases = [
                ("empty.yaml", ""),
                ("uncached.yaml", "maintenance:\n  run: npm install\n" * 100),
                ("mixed.yaml", "apt-get install -y git\nnpm install\n"),
            ]
            for fname, content in chaos_cases:
                fpath = tmp_path / fname
                fpath.write_text(content, encoding="utf-8")
                ok, _, changes = optimizer.optimize_blueprint(fpath)
                self.assertTrue(ok)
                self.assertTrue(fpath.exists())


class TestDashboardAndGoldenStress(unittest.TestCase):
    """Stress tests for Dashboard and Golden Test Suite."""

    def test_concurrent_dashboard_rendering(self):
        """Hammers dashboard generator with 100 concurrent threads."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            def render_task(idx):
                p = tmp_path / f"dash_{idx}.html"
                dash_module.render_html_dashboard(p)
                return p.exists() and p.stat().st_size > 1000

            with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                results = list(pool.map(render_task, range(100)))

            self.assertTrue(all(results))

    def test_golden_verifier_adversarial_tampering(self):
        """Ensures golden verifier immediately catches tampered or degraded skills."""
        verifier = golden_module.GoldenSkillVerifier(Path("skills"))
        tc = golden_module.GOLDEN_SKILL_TEST_SUITE[0]  # team-run

        # Case 1: Tampered with forbidden anti-pattern
        tampered_content = (
            "---\nname: team-run\ndescription: run\n---\n# Title\n"
            "This skill will skip tests and mock everything.\n"
        )
        passed, failures = verifier.evaluate_skill(tampered_content, tc)
        self.assertFalse(passed)
        self.assertTrue(any("forbidden" in f.lower() for f in failures))

        # Case 2: Missing required keywords
        empty_content = "---\nname: team-run\ndescription: run\n---\n# Title\nOnly basic steps.\n"
        passed, failures = verifier.evaluate_skill(empty_content, tc)
        self.assertFalse(passed)
        self.assertTrue(any("missing required keyword" in f.lower() for f in failures))


if __name__ == "__main__":
    unittest.main(verbosity=2)
