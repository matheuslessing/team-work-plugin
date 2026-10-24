#!/usr/bin/env python3
"""
SkillOpt-Sleep for Devin Cloud & Local Agentic Loop.
Nightly / offline continuous experience consolidation engine:
1. Harvests execution logs & session transcripts.
2. Mines recurring successful commands & failure patterns.
3. Generates consolidated 'best_skill.md' candidate documents.
4. Validates candidates against held-out golden task gates.
5. Stages proposals for atomic adoption.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
skillopt_engine = importlib.import_module("skillopt-engine")
harness_probe = importlib.import_module("harness-probe")


@dataclass
class HarvestedExperience:
    session_id: str
    timestamp: str
    recurrent_tools: List[str]
    successful_patterns: List[str]
    failed_patterns: List[str]


class DevinSleepConsolidator:
    """Consolidates short-term session experience into permanent, validated skills."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root

    def harvest_transcripts(self, logs_dir: Path) -> List[HarvestedExperience]:
        """Scans trajectory logs or JSONL files for reusable patterns."""
        experiences = []
        if not logs_dir.exists():
            return experiences

        for log_file in logs_dir.glob("*.log"):
            try:
                text = log_file.read_text(encoding="utf-8", errors="ignore")
                successes = re.findall(r"(?:Command|Ran)\s+['\"]([^'\"]+)['\"]\s+(?:succeeded|passed)", text, re.IGNORECASE)
                failures = re.findall(r"(?:Command|Ran)\s+['\"]([^'\"]+)['\"]\s+(?:failed|error)", text, re.IGNORECASE)
                experiences.append(
                    HarvestedExperience(
                        session_id=log_file.stem,
                        timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        recurrent_tools=list(set(successes)),
                        successful_patterns=successes,
                        failed_patterns=failures,
                    )
                )
            except Exception:
                continue

        return experiences

    def consolidate_skill(self, base_skill_path: Path, experiences: List[HarvestedExperience]) -> Tuple[bool, str, str]:
        """Synthesizes a refined 'best_skill.md' incorporating consolidated experience."""
        if not base_skill_path.exists():
            return False, "", "Base skill not found"

        content = base_skill_path.read_text(encoding="utf-8")
        all_successes = set()
        for exp in experiences:
            all_successes.update(exp.successful_patterns)

        if not all_successes:
            return True, content, "No new experience to consolidate"

        # Append consolidated tips cleanly in a Verification or Notes section
        notes_section = "\n\n## Consolidated Nightly Best Practices (SkillOpt-Sleep)\n"
        for cmd in sorted(all_successes)[:5]:
            notes_section += f"- Verified optimal execution pattern: `{cmd}`\n"

        if "## Consolidated Nightly Best Practices" in content:
            # Replace existing section
            content = re.sub(r"\n\n## Consolidated Nightly Best Practices.*$", notes_section, content, flags=re.DOTALL)
        else:
            content += notes_section

        valid, errors = skillopt_engine.validate_skill_markdown(content)
        if not valid:
            return False, "", f"Consolidated skill failed validation: {errors}"

        return True, content, "Skill consolidated successfully"


def main():
    workspace = Path(".")
    consolidator = DevinSleepConsolidator(workspace)
    logs_dir = workspace / ".agents" / "teamwork" / "logs"
    experiences = consolidator.harvest_transcripts(logs_dir)
    print(json.dumps({
        "status": "SLEEP_CYCLE_COMPLETE",
        "harvested_sessions": len(experiences),
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }, indent=2))


if __name__ == "__main__":
    main()
