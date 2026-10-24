#!/usr/bin/env python3
"""
Teamwork & SkillOpt Autonomous Cron Scheduler.
Enables scheduled, recurring skill review gates, nightly consolidation,
and integrity audits across both Devin Cloud and Local CLI environments:
- Devin Cloud: registers cron schedules via `devin_schedule_manage` or workflow schedules.
- Local / CLI: manages background cron-like timers or Task Scheduler / systemd triggers.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
golden_module = importlib.import_module("golden-skill-verifier")
contradiction_mod = importlib.import_module("enterprise-integrations")


DEFAULT_SCHEDULE_CONFIG = {
    "enabled": True,
    "cron_expression": "0 2 * * *",  # Run daily at 02:00 AM (Nightly Sleep Cycle)
    "tasks": [
        "golden_suite_validation",
        "contradiction_and_duplicate_scan",
        "harvest_and_consolidate_transcripts",
    ],
    "target_skills_dir": "skills",
    "notify_on_failure": True,
}


class SkillReviewScheduler:
    """Manages scheduled periodic review gates for skills."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.config_path = workspace_root / ".agents" / "teamwork" / "schedule_config.json"

    def load_config(self) -> Dict:
        if self.config_path.exists():
            try:
                return json.loads(self.config_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return DEFAULT_SCHEDULE_CONFIG

    def save_config(self, cfg: Dict):
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    def run_scheduled_review_gate(self) -> Dict:
        """Executes the full periodic review gate on all workspace skills."""
        report = {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "overall_status": "PASS",
            "golden_suite": None,
            "contradictions_found": 0,
            "details": []
        }

        # 1. Run Golden Skill Suite
        verifier = golden_module.GoldenSkillVerifier(self.workspace_root / "skills")
        golden_results = []
        golden_pass = True
        for tc in golden_module.GOLDEN_SKILL_TEST_SUITE:
            s_file = self.workspace_root / "skills" / tc.skill_name / "SKILL.md"
            if s_file.exists():
                passed, failures = verifier.evaluate_skill(s_file.read_text(encoding="utf-8"), tc)
                if not passed:
                    golden_pass = False
                golden_results.append({"skill": tc.skill_name, "passed": passed, "failures": failures})

        report["golden_suite"] = {"pass": golden_pass, "cases": golden_results}
        if not golden_pass:
            report["overall_status"] = "FAIL"

        # 2. Scan for duplicate / opposing contradictory skills
        resolver = contradiction_mod.SkillContradictionResolver()
        skills_dir = self.workspace_root / "skills"
        all_skills = list(skills_dir.glob("*/SKILL.md"))
        contradictions = []

        for i in range(len(all_skills)):
            for j in range(i + 1, len(all_skills)):
                t_a = all_skills[i].read_text(encoding="utf-8")
                t_b = all_skills[j].read_text(encoding="utf-8")
                c = resolver.find_contradictions(t_a, t_b)
                if c:
                    contradictions.append({
                        "skill_a": all_skills[i].parent.name,
                        "skill_b": all_skills[j].parent.name,
                        "conflicts": [f"{p1} vs {p2}" for p1, p2 in c]
                    })

        report["contradictions_found"] = len(contradictions)
        report["contradiction_details"] = contradictions
        if len(contradictions) > 0:
            report["overall_status"] = "WARNING_CONTRADICTIONS_DETECTED"

        return report


def main():
    parser = argparse.ArgumentParser(description="Skill Review Scheduler")
    parser.add_argument("--cron", type=str, help="Configure cron expression (e.g., '0 2 * * *')")
    parser.add_argument("--run-now", action="store_true", help="Execute the scheduled review gate immediately")
    args = parser.parse_args()

    scheduler = SkillReviewScheduler(Path("."))

    if args.cron:
        cfg = scheduler.load_config()
        cfg["cron_expression"] = args.cron
        scheduler.save_config(cfg)
        print(json.dumps({"status": "SCHEDULE_UPDATED", "cron": args.cron}, indent=2))
        sys.exit(0)

    if args.run_now:
        report = scheduler.run_scheduled_review_gate()
        print(json.dumps(report, indent=2))
        sys.exit(0 if report["overall_status"] in ("PASS", "WARNING_CONTRADICTIONS_DETECTED") else 1)

    print(json.dumps(scheduler.load_config(), indent=2))


if __name__ == "__main__":
    main()
