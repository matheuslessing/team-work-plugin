#!/usr/bin/env python3
"""
Token Optimization and User Approval Gate Test Suite:
1. Validates Skill Token Bloat Analyzer & Gradient Clipper.
2. Validates PreToolUse Self-Healing Approval Hook.
"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
import sys

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
token_optimizer = importlib.import_module("skill-token-optimizer")


class TestTokenOptimizerAndApprovalHook(unittest.TestCase):
    """Tests token budget management and mandatory human approval hooks."""

    def setUp(self):
        self.optimizer = token_optimizer.SkillTokenOptimizer()

    def test_detect_conversational_bloat_and_budget_exceeded(self):
        bloated_text = (
            "---\nname: bloated\ndescription: bloated\n---\n# Bloated\n\n"
            "As an AI language model, please feel free to run this. I hope this helps!\n"
            + ("Some long prose lines.\n" * 400)
        )
        with tempfile.NamedTemporaryFile("w+", suffix=".md", delete=False, encoding="utf-8") as f:
            f.write(bloated_text)
            f_path = Path(f.name)

        try:
            audit = self.optimizer.analyze_skill_bloat(f_path)
            self.assertGreater(len(audit.issues), 0)
            self.assertTrue(any("CONVERSATIONAL_BLOAT" in i for i in audit.issues))
        finally:
            f_path.unlink()

    def test_gradient_clip_skill_text(self):
        raw = "As an AI language model, run `npm test`.\n\n\n\n\n"
        clipped = self.optimizer.clip_skill_text(raw)
        self.assertNotIn("As an AI language model", clipped)
        self.assertNotIn("\n\n\n", clipped)
        self.assertIn("`npm test`", clipped)

    def test_self_healing_approval_hook_intercepts_adoption(self):
        hook_path = SCRIPTS_DIR / "self-healing-gate-hook.py"
        payload = {
            "toolCall": {
                "name": "run_command",
                "args": {"CommandLine": "python scripts/skillopt-engine.py adopt --skill sample.md"}
            }
        }
        p = subprocess.Popen(
            [sys.executable, str(hook_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True
        )
        out, _ = p.communicate(json.dumps(payload))
        res = json.loads(out)
        self.assertEqual(res.get("decision"), "ask")
        self.assertIn("[SELF-HEALING APPROVAL GATE]", res.get("reason", ""))


if __name__ == "__main__":
    unittest.main(verbosity=2)
