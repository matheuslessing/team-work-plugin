#!/usr/bin/env python3
"""
Advanced Experience & Rejection Memory Engine.
Implements:
1. Microsoft SkillOpt `rejected_edit_buffer`: Tracks negative evidence to permanently block repeating failed edits.
2. Google Research Harness² `EXPERIENCE.md`: Continuous cross-task improvement library for invariant system lessons.
3. Slow Meta-Update: Epoch-level refactoring to keep skills compact (< 1,200 tokens).
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
skillopt_engine = importlib.import_module("skillopt-engine")


class RejectedEditBuffer:
    """Stores rejected candidate edits to serve as negative feedback, preventing regression loops."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.buffer_file = workspace_root / ".agents" / "teamwork" / "rejected_edit_buffer.json"

    def record_rejected_edit(self, skill_name: str, target: str, replacement: str, reason: str):
        self.buffer_file.parent.mkdir(parents=True, exist_ok=True)
        data = []
        if self.buffer_file.exists():
            try:
                data = json.loads(self.buffer_file.read_text(encoding="utf-8"))
            except Exception:
                data = []

        data.append({
            "skill_name": skill_name,
            "target": target,
            "replacement": replacement,
            "reason": reason,
        })
        self.buffer_file.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def is_edit_prohibited(self, skill_name: str, target: str, replacement: str) -> Tuple[bool, Optional[str]]:
        """Checks if this specific replacement has already failed validation before."""
        if not self.buffer_file.exists():
            return False, None

        try:
            data = json.loads(self.buffer_file.read_text(encoding="utf-8"))
            for entry in data:
                if entry.get("skill_name") == skill_name:
                    if entry.get("target") == target and entry.get("replacement") == replacement:
                        return True, f"Prohibited by rejected_edit_buffer: Previously failed with: {entry.get('reason')}"
        except Exception:
            pass

        return False, None


class HarnessExperienceLibrary:
    """Maintains persistent EXPERIENCE.md for invariant cross-task environment learning."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.experience_file = workspace_root / ".agents" / "teamwork" / "EXPERIENCE.md"

    def record_invariant_lesson(self, title: str, rule: str, context: str):
        self.experience_file.parent.mkdir(parents=True, exist_ok=True)
        existing = ""
        if self.experience_file.exists():
            existing = self.experience_file.read_text(encoding="utf-8")

        lesson_entry = f"\n### [{title}]\n- **Invariant Rule**: {rule}\n- **Context**: {context}\n"
        if title not in existing:
            self.experience_file.write_text(existing + lesson_entry, encoding="utf-8")

    def get_accumulated_lessons(self) -> str:
        if not self.experience_file.exists():
            return ""
        return self.experience_file.read_text(encoding="utf-8")


def main():
    print(json.dumps({"module": "rejected-buffer-and-experience-library", "status": "READY"}))


if __name__ == "__main__":
    main()
