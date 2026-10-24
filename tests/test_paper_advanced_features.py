#!/usr/bin/env python3
"""
Test Suite for Advanced Paper Capabilities:
1. Google Research Harness²:
   - Trajectory Divergence Step Isolator (t* finder)
   - Interactive Sandbox Probe (pre-composition verification)
2. Microsoft SkillOpt:
   - Slow Meta-Update (epoch-level parameter consolidation & token pruning)
3. Teamwork Multi-Agent Engineering:
   - Victory Audit Certification & SHA-256 Cryptographic Manifest
"""

import json
import tempfile
import unittest
from pathlib import Path
import sys

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
harness_mod = importlib.import_module("harness-probe")
memory_mod = importlib.import_module("experience-memory")
victory_mod = importlib.import_module("victory-auditor")


class TestHarnessTrajectoryDivergenceAndProbe(unittest.TestCase):
    """Tests Google Research Harness² t* divergence isolation and sandbox probing."""

    def setUp(self):
        self.divergence_finder = harness_mod.TrajectoryDivergenceFinder()
        self.sandbox_probe = harness_mod.InteractiveSandboxProbe(timeout_seconds=5.0)

    def test_find_exact_divergence_step_t_star(self):
        """Validates that t* is pinpointed at the exact divergence step between trajectories."""
        successful_trajectory = [
            {"step": 0, "tool": "read_file", "args": {"Path": "app.py"}, "status": "SUCCESS"},
            {"step": 1, "tool": "run_command", "args": {"cmd": "pytest -v"}, "status": "SUCCESS"},
            {"step": 2, "tool": "write_file", "args": {"Path": "handoff.md"}, "status": "SUCCESS"},
        ]

        failing_trajectory = [
            {"step": 0, "tool": "read_file", "args": {"Path": "app.py"}, "status": "SUCCESS"},
            {"step": 1, "tool": "run_command", "args": {"cmd": "pytest --invalid-flag"}, "status": "ERROR", "output": "unrecognized argument"},
            {"step": 2, "tool": "write_file", "args": {"Path": "handoff.md"}, "status": "SUCCESS"},
        ]

        divergence = self.divergence_finder.find_divergence_step(failing_trajectory, successful_trajectory)
        self.assertIsNotNone(divergence)
        self.assertEqual(divergence.step_index, 1)
        self.assertIn("invalid-flag", divergence.failing_action)
        self.assertIn("pytest -v", divergence.expected_or_successful_action)

    def test_interactive_sandbox_probe_execution(self):
        """Validates that candidate probe commands execute in sandbox before composition."""
        # Valid command probe
        success, out, code = self.sandbox_probe.probe_candidate_action("python -c \"print('probe_ok')\"")
        self.assertTrue(success)
        self.assertEqual(code, 0)
        self.assertIn("probe_ok", out)

        # Invalid command probe
        fail_success, fail_out, fail_code = self.sandbox_probe.probe_candidate_action("python -c \"raise ValueError('boom')\"")
        self.assertFalse(fail_success)
        self.assertNotEqual(fail_code, 0)
        self.assertIn("boom", fail_out)


class TestSkillOptSlowMetaUpdate(unittest.TestCase):
    """Tests Microsoft SkillOpt Slow Meta-Update skill parameter consolidation."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.workspace_root = Path(self.tmp.name)
        self.consolidator = memory_mod.SlowMetaUpdateConsolidator(self.workspace_root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_slow_meta_update_pruning_and_token_compression(self):
        """Validates pruning of deprecated clauses and token compression while preserving frontmatter."""
        fragmented_skill = """---
name: sample-skill
description: A fragmented skill with accumulated diffs
---

# Sample Skill

## Directives
- Always run tests before commit
- Always run tests before commit
- DEPRECATED (ADR Override: See old_db.md)
- DEPRECATED (ADR Override: See mongo.md)
- Use standard linting



## Execution Steps
Step 1: Init project.
"""
        ok, consolidated, stats = self.consolidator.consolidate_skill(fragmented_skill)
        self.assertTrue(ok)
        self.assertNotIn("DEPRECATED", consolidated)
        self.assertEqual(stats["deprecated_pruned"], 2)
        self.assertGreater(stats["compression_ratio"], 0.15)
        # Verify deduplicated bullet point
        self.assertEqual(consolidated.count("Always run tests before commit"), 1)
        # Verify frontmatter preserved
        self.assertTrue(consolidated.startswith("---\nname: sample-skill"))


class TestTeamworkVictoryAudit(unittest.TestCase):
    """Tests Teamwork Victory Audit cryptographic manifest and 5-component compliance."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.workspace_root = Path(self.tmp.name)
        self.auditor = victory_mod.VictoryAuditor(self.workspace_root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_victory_audit_full_certification(self):
        """Validates SHA-256 fingerprinting and 5-component handoff checking."""
        # 1. Create a deliverable file
        deliverable = self.workspace_root / "src" / "service.py"
        deliverable.parent.mkdir(parents=True, exist_ok=True)
        deliverable.write_text("print('Production Deliverable')", encoding="utf-8")

        # 2. Create valid 5-component handoff
        handoff = self.workspace_root / ".agents" / "teamwork" / "worker_1" / "handoff.md"
        handoff.parent.mkdir(parents=True, exist_ok=True)
        handoff_text = """# Handoff Report
## 1. Observation
All 10 tests passed.
## 2. Logic Chain
Deduction confirms requirement R1 met.
## 3. Caveats
No caveats.
## 4. Conclusion
Work finished cleanly.
## 5. Verification Method
Run python -m unittest.
"""
        handoff.write_text(handoff_text, encoding="utf-8")

        # 3. Run audit
        report = self.auditor.run_victory_audit([deliverable])
        self.assertTrue(report.passed)
        self.assertEqual(report.verdict, "🟢 CLEAN")
        self.assertIn("src/service.py", report.file_manifest)
        self.assertIsNotNone(report.certificate_path)

        # 4. Check certificate file on disk
        cert_file = Path(report.certificate_path)
        self.assertTrue(cert_file.exists())
        cert_text = cert_file.read_text(encoding="utf-8")
        self.assertIn("Cryptographic Manifest (SHA-256)", cert_text)
        self.assertIn("src/service.py", cert_text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
