#!/usr/bin/env python3
"""
Enterprise Extension:
1. MCP Error Interceptor & Resilient Retry Engine.
2. ADR & Docs Context Synthesizer.
3. Skill Conflict & Contradiction Resolver (Semantic & Opposing Rules Deduplication).
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
skillopt_engine = importlib.import_module("skillopt-engine")


@dataclass
class MCPErrorAction:
    decision: str  # "FALLBACK_TOOL" | "AUTO_RETRY" | "CIRCUIT_BREAKER" | "ESCALATE_GATE"
    remediation_hint: str
    circuit_broken: bool = False


class MCPResilienceInterceptor:
    """Handles enterprise MCP tool failures (transient timeouts, schema errors, auth drops)."""

    def handle_mcp_error(self, tool_name: str, error_payload: str) -> MCPErrorAction:
        err_lower = error_payload.lower()

        # 1. Transient network / timeout error -> Retry with backoff
        if any(term in err_lower for term in ["timeout", "timed out", "econnreset", "socket hang up", "503", "504"]):
            return MCPErrorAction(
                decision="AUTO_RETRY",
                remediation_hint=f"Transient network glitch on MCP tool '{tool_name}'. Retry with 2s exponential backoff.",
                circuit_broken=False
            )

        # 2. Authentication / Permission drop -> Circuit breaker to prevent runaway tokens
        if any(term in err_lower for term in ["401", "403", "unauthorized", "forbidden", "token expired", "invalid api key"]):
            return MCPErrorAction(
                decision="CIRCUIT_BREAKER",
                remediation_hint=f"MCP '{tool_name}' failed with authentication error. Tripping circuit breaker to stop runaway loop.",
                circuit_broken=True
            )

        # 3. Schema / argument incompatibility -> Fallback or Escalate to Gate
        return MCPErrorAction(
            decision="FALLBACK_TOOL",
            remediation_hint=f"MCP '{tool_name}' returned schema error. Falling back to native CLI or reporting defect.",
            circuit_broken=False
        )


class ADRContextIntegrator:
    """Bridges enterprise Docs MCP / ADR repositories into Teamwork PROJECT.md."""

    def synthesize_adrs_into_contracts(self, adr_list: List[Dict[str, str]], base_project_plan: str) -> str:
        """Injects relevant Architecture Decision Records directly into Phase 0/1 Interface Contracts."""
        if not adr_list:
            return base_project_plan

        adr_section = "\n\n## 🏛️ Enterprise ADR Mandates (From Docs MCP / ADR Repo)\n"
        for adr in adr_list:
            adr_section += f"### ADR-{adr.get('id', 'DOC')}: {adr.get('title', 'Policy')}\n"
            adr_section += f"- **Decision**: {adr.get('decision', 'N/A')}\n"
            adr_section += f"- **Constraint**: {adr.get('constraint', 'N/A')}\n\n"

        if "## 🏛️ Enterprise ADR Mandates" in base_project_plan:
            return base_project_plan

        return base_project_plan + adr_section


class SkillContradictionResolver:
    """Detects and resolves duplicated skills or opposing/conflicting rules."""

    OPPOSING_PAIRS = [
        (r"\bdo not mock\b", r"\bmock everything\b"),
        (r"\buse npm ci\b", r"\buse npm install\b"),
        (r"\bnever touch production\b", r"\bedit production files\b"),
        (r"\bwrite e2e tests\b", r"\bskip all tests\b"),
        (r"\buse pnpm\b", r"\buse yarn\b"),
    ]

    def find_contradictions(self, skill_a_text: str, skill_b_text: str) -> List[Tuple[str, str]]:
        """Scans two skills to find mutually exclusive or opposing directives."""
        contradictions = []
        for pat1, pat2 in self.OPPOSING_PAIRS:
            m1_in_a = bool(re.search(pat1, skill_a_text, re.IGNORECASE))
            m2_in_b = bool(re.search(pat2, skill_b_text, re.IGNORECASE))
            
            m2_in_a = bool(re.search(pat2, skill_a_text, re.IGNORECASE))
            m1_in_b = bool(re.search(pat1, skill_b_text, re.IGNORECASE))

            if (m1_in_a and m2_in_b) or (m2_in_a and m1_in_b):
                contradictions.append((pat1, pat2))

        return contradictions

    def resolve_duplicate_or_contradiction(
        self,
        primary_skill_path: Path,
        secondary_skill_path: Path
    ) -> Tuple[bool, str]:
        """
        Applies SkillOpt discipline to resolve duplicate or contradictory skills:
        Deprecates the inferior/conflicting rule in favor of the primary ADR-aligned rule.
        """
        text_a = primary_skill_path.read_text(encoding="utf-8")
        text_b = secondary_skill_path.read_text(encoding="utf-8")

        contradictions = self.find_contradictions(text_a, text_b)
        if not contradictions:
            return True, "No opposing contradictions found"

        # Apply bounded diff to deprecate conflicting directive in secondary skill
        for pat1, pat2 in contradictions:
            m = re.search(pat2, text_b, re.IGNORECASE)
            if m:
                target = m.group(0)
                replacement = f"DEPRECATED (ADR Override: See {primary_skill_path.name})"
                ok, modified, msg = skillopt_engine.apply_bounded_edit(text_b, target, replacement)
                if ok:
                    secondary_skill_path.write_text(modified, encoding="utf-8")
                    return True, f"Resolved contradiction: replaced '{target}' with deprecation note"

        return False, "Could not resolve contradiction cleanly"


def main():
    print(json.dumps({"module": "enterprise-mcp-adr-contradiction-engine", "status": "ACTIVE"}))


if __name__ == "__main__":
    main()
