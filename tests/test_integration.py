#!/usr/bin/env python3
"""
Comprehensive Local Test Suite for Teamwork + Harness² + SkillOpt Integration.
Runs static verification, schema validation, bounded diff gate testing,
anti-regression enforcement, multi-agent contract checks, and Devin Cloud environment healing.
"""

import unittest
import os
import sys
import tempfile
from pathlib import Path

# Add scripts directory to path
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
skillopt_engine = importlib.import_module("skillopt-engine")
harness_probe = importlib.import_module("harness-probe")
env_healer = importlib.import_module("devin-env-healer")


class TestSkillOptEngine(unittest.TestCase):
    """Tests the SkillOpt bounded diff optimizer and validation gate."""

    def setUp(self):
        self.valid_skill = (
            "---\n"
            "name: test-sample\n"
            "description: Sample test skill for automated testing.\n"
            "---\n\n"
            "# Sample Test Skill\n\n"
            "## Steps\n"
            "1. Run `python --version`\n"
            "2. Execute `npm test`\n"
        )
        self.broken_skill_frontmatter = (
            "name: test-sample\n"
            "# Sample Test Skill without frontmatter\n"
        )
        self.broken_skill_codeblocks = (
            "---\n"
            "name: test-broken\n"
            "description: Broken code block skill\n"
            "---\n\n"
            "# Broken Code Block\n"
            "```python\n"
            "def test(): pass\n"
        )

    def test_validation_passes_valid_skill(self):
        valid, errors = skillopt_engine.validate_skill_markdown(self.valid_skill)
        self.assertTrue(valid, f"Expected valid skill to pass, got: {errors}")
        self.assertEqual(len(errors), 0)

    def test_validation_catches_missing_frontmatter(self):
        valid, errors = skillopt_engine.validate_skill_markdown(self.broken_skill_frontmatter)
        self.assertFalse(valid)
        self.assertTrue(any("frontmatter" in e.lower() for e in errors))

    def test_validation_catches_unclosed_codeblocks(self):
        valid, errors = skillopt_engine.validate_skill_markdown(self.broken_skill_codeblocks)
        self.assertFalse(valid)
        self.assertTrue(any("code blocks" in e.lower() for e in errors))

    def test_bounded_diff_unique_match(self):
        target = "Execute `npm test`"
        replacement = "Execute `pytest -v`"
        ok, modified, msg = skillopt_engine.apply_bounded_edit(self.valid_skill, target, replacement)
        self.assertTrue(ok)
        self.assertIn("pytest -v", modified)
        self.assertNotIn("npm test", modified)

    def test_bounded_diff_fails_on_duplicate_target(self):
        duplicate_text = self.valid_skill + "\nExecute `npm test` again\n"
        ok, _, msg = skillopt_engine.apply_bounded_edit(duplicate_text, "Execute `npm test`", "replaced")
        self.assertFalse(ok)
        self.assertIn("multiple times", msg)

    def test_validation_gate_blocks_regressed_test_suite(self):
        gate = skillopt_engine.evaluate_validation_gate(
            candidate_content=self.valid_skill,
            original_content=self.valid_skill,
            test_suite_passed=False,
            no_regression=True
        )
        self.assertEqual(gate.gate_status, "FAIL")
        self.assertEqual(gate.action, "reject")
        self.assertTrue(any("regression" in e.lower() for e in gate.errors))


class TestHarnessContrastiveProbe(unittest.TestCase):
    """Tests the Harness² Propose-Probe-Compose contrastive logic."""

    def setUp(self):
        self.proposer = harness_probe.HarnessContrastiveProposer(Path("."))
        self.sample_log = (
            "Step 4: Executing tool\n"
            "Command 'npm test --legacy-peer-deps' failed: exit code 127\n"
            "Error: command not found: npm\n"
        )

    def test_extract_contrasts_from_log(self):
        contrasts = self.proposer.analyze_trajectory(self.sample_log)
        self.assertGreaterEqual(len(contrasts), 1)
        self.assertIn("npm test --legacy-peer-deps", contrasts[0].failed_command)

    def test_compose_skill_patch(self):
        skill_text = (
            "# My Skill\n"
            "Run `npm test --legacy-peer-deps` to start.\n"
        )
        contrast = harness_probe.ExecutionContrast(
            task_id="t1",
            failed_command="`npm test --legacy-peer-deps`",
            error_output="exit code 127",
            remedied_command="`pnpm test`"
        )
        target, rep = self.proposer.compose_skill_patch(skill_text, contrast)
        self.assertEqual(target, "`npm test --legacy-peer-deps`")
        self.assertEqual(rep, "`pnpm test`")


class TestDevinEnvironmentHealer(unittest.TestCase):
    """Tests detection of slow blueprints, startup latency, and environment secrets."""

    def setUp(self):
        self.diagnoser = env_healer.DevinEnvironmentDiagnoser(Path("."))

    def test_detect_slow_startup_logs(self):
        log_sample = (
            "Starting Devin Cloud VM...\n"
            "Step 'npm install' took: 110s\n"
            "Step 'build' took: 15s\n"
        )
        diagnostics = self.diagnoser.analyze_startup_logs(log_sample)
        self.assertEqual(len(diagnostics), 1)
        self.assertEqual(diagnostics[0].issue_type, "STARTUP_LATENCY")
        self.assertIn("110.0s", diagnostics[0].details)

    def test_detect_uncached_blueprint_installs(self):
        with tempfile.NamedTemporaryFile("w+", suffix=".yaml", delete=False) as f:
            f.write("maintenance:\n  run: npm install\n")
            f_path = Path(f.name)
        try:
            diags = self.diagnoser.inspect_blueprint(f_path)
            self.assertEqual(len(diags), 1)
            self.assertEqual(diags[0].issue_type, "SLOW_DEPENDENCY")
            self.assertEqual(diags[0].bounded_target, "npm install")
            self.assertEqual(diags[0].bounded_replacement, "npm ci")
        finally:
            f_path.unlink()


class TestWorkspaceStructure(unittest.TestCase):
    """Verifies all files, skills, and agents exist with proper schema in the plugin."""

    def setUp(self):
        self.root = Path(__file__).resolve().parent.parent

    def test_manifest_exists(self):
        manifest = self.root / "plugin.json"
        self.assertTrue(manifest.exists(), "plugin.json must exist at root")

    def test_all_workspace_skills_pass_gate(self):
        skills_dir = self.root / "skills"
        self.assertTrue(skills_dir.exists())
        for skill_md in skills_dir.glob("*/SKILL.md"):
            content = skill_md.read_text(encoding="utf-8")
            valid, errors = skillopt_engine.validate_skill_markdown(content)
            self.assertTrue(valid, f"Skill {skill_md.name} failed gate: {errors}")

    def test_mandatory_agents_exist(self):
        agents_dir = self.root / "agents"
        required_agents = [
            "sentinel.md",
            "orchestrator.md",
            "forensic-auditor.md",
            "victory-auditor.md",
            "skill-optimizer.md"
        ]
        for ag in required_agents:
            ag_path = agents_dir / ag
            self.assertTrue(ag_path.exists(), f"Mandatory agent profile {ag} missing!")


if __name__ == "__main__":
    unittest.main(verbosity=2)
