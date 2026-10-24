#!/usr/bin/env python3
"""
Scheduler Test Suite:
Validates scheduled skill review gates, cron expression configuration,
and automatic periodic audit execution.
"""

import tempfile
import unittest
from pathlib import Path
import sys

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
sched_mod = importlib.import_module("skill-scheduler")


class TestSkillScheduler(unittest.TestCase):
    """Tests periodic scheduled skill review gates."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.scheduler = sched_mod.SkillReviewScheduler(self.tmp_path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_save_and_load_schedule_config(self):
        cfg = {"enabled": True, "cron_expression": "0 3 * * *", "tasks": ["golden_suite"]}
        self.scheduler.save_config(cfg)
        loaded = self.scheduler.load_config()
        self.assertEqual(loaded["cron_expression"], "0 3 * * *")

    def test_execute_scheduled_review_gate(self):
        # Create minimal valid skills directory
        skills_dir = self.tmp_path / "skills"
        skills_dir.mkdir(parents=True)
        report = self.scheduler.run_scheduled_review_gate()
        self.assertIn("overall_status", report)
        self.assertIn("timestamp", report)


if __name__ == "__main__":
    unittest.main(verbosity=2)
