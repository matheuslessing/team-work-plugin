#!/usr/bin/env python3
"""
Enterprise Test Suite:
1. MCP Failure Interception & Circuit Breakers (Timeouts, Auth drops, Fallbacks).
2. ADR & Docs Context Injection into Teamwork Contracts.
3. Skill Contradiction & Opposing Rules Deduplication via SkillOpt.
"""

import tempfile
import unittest
from pathlib import Path
import sys

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
enterprise_mod = importlib.import_module("enterprise-integrations")


class TestEnterpriseMCPAndADR(unittest.TestCase):
    """Tests enterprise integrations: MCP resilient error handling, ADR synthesis, and contradiction resolution."""

    def setUp(self):
        self.interceptor = enterprise_mod.MCPResilienceInterceptor()
        self.adr_integrator = enterprise_mod.ADRContextIntegrator()
        self.contradiction_resolver = enterprise_mod.SkillContradictionResolver()

    def test_mcp_timeout_auto_retry(self):
        action = self.interceptor.handle_mcp_error("jira-mcp", "HTTP Connection timed out after 30s")
        self.assertEqual(action.decision, "AUTO_RETRY")
        self.assertFalse(action.circuit_broken)

    def test_mcp_auth_failure_circuit_breaker(self):
        action = self.interceptor.handle_mcp_error("vault-mcp", "401 Unauthorized: Invalid API Token")
        self.assertEqual(action.decision, "CIRCUIT_BREAKER")
        self.assertTrue(action.circuit_broken)

    def test_adr_synthesis_into_contracts(self):
        adrs = [
            {"id": "004", "title": "Database Access", "decision": "Use Prisma ORM only", "constraint": "No raw SQL"}
        ]
        base_plan = "# Project Plan\n## Interface Contracts\n"
        augmented = self.adr_integrator.synthesize_adrs_into_contracts(adrs, base_plan)
        self.assertIn("ADR-004", augmented)
        self.assertIn("Use Prisma ORM only", augmented)

    def test_skill_contradiction_detection_and_resolution(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            s_primary = tmp_path / "skill_primary.md"
            s_secondary = tmp_path / "skill_secondary.md"

            # Primary mandates 'do not mock'
            s_primary.write_text("---\nname: primary\ndescription: p\n---\n# P\nStrictly do not mock services.\n", encoding="utf-8")
            # Secondary instructs 'mock everything' (OPPOSING DIRECTIVE)
            s_secondary.write_text("---\nname: secondary\ndescription: s\n---\n# S\nFor testing, mock everything.\n", encoding="utf-8")

            # Detect and resolve
            ok, msg = self.contradiction_resolver.resolve_duplicate_or_contradiction(s_primary, s_secondary)
            self.assertTrue(ok)
            self.assertIn("DEPRECATED", s_secondary.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
