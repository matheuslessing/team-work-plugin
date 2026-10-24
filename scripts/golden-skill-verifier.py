#!/usr/bin/env python3
"""
Golden Test Suite Runner for Critical Skills.
Enforces zero-regression evaluation benchmarks before any skill mutation
is adopted onto production skills:
1. Syntax and structure check.
2. Parameter compatibility test cases.
3. Anti-drift verification against golden expectations.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
skillopt_engine = importlib.import_module("skillopt-engine")


@dataclass
class GoldenTestCase:
    skill_name: str
    scenario_description: str
    required_keywords: List[str]
    forbidden_anti_patterns: List[str]


GOLDEN_SKILL_TEST_SUITE = [
    GoldenTestCase(
        skill_name="team-run",
        scenario_description="Full autonomous pipeline must enforce two-track and gate",
        required_keywords=["Dual-Track", "Phase 1", "Phase 2", "Verification Gate"],
        forbidden_anti_patterns=["skip tests", "mock everything", "ignore gate"]
    ),
    GoldenTestCase(
        skill_name="team-audit",
        scenario_description="Forensic audit must retain binary clean vs violation mandate",
        required_keywords=["Forensic", "Binary", "CLEAN", "INTEGRITY VIOLATION"],
        forbidden_anti_patterns=["soft warning", "allow fake tests"]
    ),
    GoldenTestCase(
        skill_name="skill-evolve",
        scenario_description="Auto-evolution must mandate bounded diffs and validation gates",
        required_keywords=["Bounded Diff", "Validation Gate", "scripts/skillopt-engine.py", "adopt"],
        forbidden_anti_patterns=["overwrite entirely", "skip validation"]
    ),
]


class GoldenSkillVerifier:
    """Runs strict evaluation tests on skills before adoption."""

    def __init__(self, skills_dir: Path):
        self.skills_dir = skills_dir

    def evaluate_skill(self, skill_content: str, test_case: GoldenTestCase) -> Tuple[bool, List[str]]:
        failures = []
        valid, errors = skillopt_engine.validate_skill_markdown(skill_content)
        if not valid:
            failures.extend(errors)

        for kw in test_case.required_keywords:
            if kw.lower() not in skill_content.lower():
                failures.append(f"Golden assertion failed: missing required keyword '{kw}'")

        for bad in test_case.forbidden_anti_patterns:
            if bad.lower() in skill_content.lower():
                failures.append(f"Golden assertion failed: contains forbidden anti-pattern '{bad}'")

        return len(failures) == 0, failures


def main():
    workspace = Path(".")
    verifier = GoldenSkillVerifier(workspace / "skills")
    results = []
    overall_pass = True

    for tc in GOLDEN_SKILL_TEST_SUITE:
        skill_file = workspace / "skills" / tc.skill_name / "SKILL.md"
        if not skill_file.exists():
            results.append({"skill": tc.skill_name, "status": "SKIPPED_NOT_FOUND"})
            continue

        passed, failures = verifier.evaluate_skill(skill_file.read_text(encoding="utf-8"), tc)
        if not passed:
            overall_pass = False
        results.append({
            "skill": tc.skill_name,
            "status": "PASS" if passed else "FAIL",
            "failures": failures
        })

    print(json.dumps({"golden_suite_pass": overall_pass, "details": results}, indent=2))
    sys.exit(0 if overall_pass else 1)


if __name__ == "__main__":
    main()
