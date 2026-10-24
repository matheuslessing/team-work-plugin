#!/usr/bin/env python3
"""
Deep Stress Test & In-Session Skill Evolution Benchmark.
Simulates:
1. Dynamic invocation tracking of skills inside an active session.
2. In-session error detection and real-time self-healing of the invoked skill.
3. Rapid concurrent session bursts mutating and resolving skills simultaneously.
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
resolver_mod = importlib.import_module("session-skill-resolver")
skillopt_engine = importlib.import_module("skillopt-engine")
harness_probe = importlib.import_module("harness-probe")


class TestSessionSkillTrackingStress(unittest.TestCase):
    """Stress tests dynamic tracking and self-healing of skills invoked during a live session."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.skills_dir = self.tmp_path / "skills"
        self.skills_dir.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_in_session_invocation_and_targeted_healing(self):
        """Validates that only skills actually invoked in the session are targeted for auto-healing."""
        # 1. Cria 3 skills no projeto
        s1 = self.skills_dir / "skill-alpha" / "SKILL.md"
        s1.parent.mkdir()
        s1.write_text("---\nname: skill-alpha\ndescription: alpha\n---\n# Alpha\n`run_old_alpha`\n", encoding="utf-8")

        s2 = self.skills_dir / "skill-beta" / "SKILL.md"
        s2.parent.mkdir()
        s2.write_text("---\nname: skill-beta\ndescription: beta\n---\n# Beta\n`run_beta`\n", encoding="utf-8")

        # 2. Registra que APENAS 'skill-alpha' foi invocada na sessão
        resolver = resolver_mod.SessionSkillResolver(self.tmp_path)
        tracked_path = resolver.record_skill_invocation(session_id="sess_123", skill_name="skill-alpha", turn_idx=4)
        self.assertIsNotNone(tracked_path)

        active_skills = resolver.get_session_active_skills()
        self.assertIn("skill-alpha", active_skills)
        self.assertNotIn("skill-beta", active_skills)

        # 3. Simula erro no terminal e auto-cura direcionada à skill invocada na sessão
        target_skill_file = Path(active_skills["skill-alpha"])
        content = target_skill_file.read_text(encoding="utf-8")
        ok, modified, _ = skillopt_engine.apply_bounded_edit(content, "`run_old_alpha`", "`run_healed_alpha`")
        self.assertTrue(ok)

        gate = skillopt_engine.evaluate_validation_gate(modified, content, test_suite_passed=True, no_regression=True)
        self.assertEqual(gate.gate_status, "PASS")
        target_skill_file.write_text(modified, encoding="utf-8")

        # 4. Verifica que 'skill-alpha' foi curada e 'skill-beta' permaneceu intacta
        self.assertIn("`run_healed_alpha`", s1.read_text(encoding="utf-8"))
        self.assertIn("`run_beta`", s2.read_text(encoding="utf-8"))

    def test_concurrent_session_burst_invocations(self):
        """Stress tests 100 parallel sessions recording and resolving skill invocations."""
        resolver = resolver_mod.SessionSkillResolver(self.tmp_path)
        
        # Cria skill dummy
        dummy = self.skills_dir / "dummy" / "SKILL.md"
        dummy.parent.mkdir()
        dummy.write_text("---\nname: dummy\ndescription: dummy\n---\n# Dummy\n", encoding="utf-8")

        def session_worker(idx):
            p = resolver.record_skill_invocation(f"sess_{idx}", "dummy", idx)
            return p is not None

        start = time.time()
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(session_worker, range(100)))
        elapsed = time.time() - start

        self.assertTrue(all(results))
        self.assertLess(elapsed, 1.0, f"100 session records took too long: {elapsed:.3f}s")


if __name__ == "__main__":
    unittest.main(verbosity=2)
