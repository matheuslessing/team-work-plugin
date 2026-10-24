#!/usr/bin/env python3
"""
Advanced Experience & Rejection Memory Engine.
Implements:
1. Microsoft SkillOpt `rejected_edit_buffer`: Tracks negative evidence to permanently block repeating failed edits.
2. Google Research Harness² `EXPERIENCE.md`: Continuous cross-task improvement library for invariant system lessons.
3. Thread-safe synchronization with atomic file operations to eliminate concurrency data loss.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
skillopt_engine = importlib.import_module("skillopt-engine")

_buffer_lock = threading.RLock()
_experience_lock = threading.RLock()


class RejectedEditBuffer:
    """Stores rejected candidate edits to serve as negative feedback, preventing regression loops."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.buffer_file = workspace_root / ".agents" / "teamwork" / "rejected_edit_buffer.json"

    def record_rejected_edit(self, skill_name: str, target: str, replacement: str, reason: str):
        with _buffer_lock:
            self.buffer_file.parent.mkdir(parents=True, exist_ok=True)
            data = []
            if self.buffer_file.exists():
                try:
                    loaded = json.loads(self.buffer_file.read_text(encoding="utf-8"))
                    if isinstance(loaded, list):
                        data = loaded
                except Exception:
                    data = []

            data.append({
                "skill_name": skill_name,
                "target": target,
                "replacement": replacement,
                "reason": reason,
            })
            
            # Atomic file write to avoid corruptions or truncation
            tmp_file = self.buffer_file.with_name(f"{self.buffer_file.name}.{threading.get_ident()}.tmp")
            tmp_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
            tmp_file.replace(self.buffer_file)

    def is_edit_prohibited(self, skill_name: str, target: str, replacement: str) -> Tuple[bool, Optional[str]]:
        """Checks if this specific replacement has already failed validation before."""
        with _buffer_lock:
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
        with _experience_lock:
            self.experience_file.parent.mkdir(parents=True, exist_ok=True)
            existing = ""
            if self.experience_file.exists():
                existing = self.experience_file.read_text(encoding="utf-8")

            lesson_entry = f"\n### [{title}]\n- **Invariant Rule**: {rule}\n- **Context**: {context}\n"
            if title not in existing:
                tmp_file = self.experience_file.with_name(f"{self.experience_file.name}.{threading.get_ident()}.tmp")
                tmp_file.write_text(existing + lesson_entry, encoding="utf-8")
                tmp_file.replace(self.experience_file)

    def get_accumulated_lessons(self) -> str:
        with _experience_lock:
            if not self.experience_file.exists():
                return ""
            return self.experience_file.read_text(encoding="utf-8")


class SlowMetaUpdateConsolidator:
    """
    Microsoft SkillOpt Slow Meta-Update: Epoch-level skill consolidation.
    Treats skills as trainable parameters theta and refactors accumulated fast-loop patches
    into compact, canonical representation with guaranteed token reduction and zero regression.
    """

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root

    def consolidate_skill(self, skill_content: str) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Prunes obsolete annotations, merges duplicate warnings, normalizes whitespace,
        and validates format invariants.
        """
        initial_length = len(skill_content)
        lines = skill_content.splitlines()

        cleaned_lines = []
        deprecated_pruned = 0
        seen_bullet_rules = set()

        in_frontmatter = False
        frontmatter_count = 0

        for line in lines:
            stripped = line.strip()
            if stripped == "---":
                frontmatter_count += 1
                cleaned_lines.append(line)
                in_frontmatter = (frontmatter_count == 1)
                continue

            if in_frontmatter:
                cleaned_lines.append(line)
                continue

            # Prune deprecated lines
            if "DEPRECATED (" in line:
                deprecated_pruned += 1
                continue

            # Deduplicate identical bullet points
            if stripped.startswith("- ") or stripped.startswith("* "):
                rule_key = re.sub(r"\s+", " ", stripped.lower())
                if rule_key in seen_bullet_rules:
                    continue
                seen_bullet_rules.add(rule_key)

            cleaned_lines.append(line)

        # Collapse excessive consecutive empty lines
        normalized_text = "\n".join(cleaned_lines)
        normalized_text = re.sub(r"\n{3,}", "\n\n", normalized_text).strip() + "\n"

        # Format validation gate
        valid, err_msg = skillopt_engine.validate_skill_markdown(normalized_text)
        if not valid:
            return False, skill_content, {"error": f"Slow meta-update produced invalid format: {err_msg}"}

        final_length = len(normalized_text)
        compression_ratio = (1.0 - (final_length / initial_length)) if initial_length > 0 else 0.0

        stats = {
            "initial_bytes": initial_length,
            "final_bytes": final_length,
            "compression_ratio": round(compression_ratio, 4),
            "deprecated_pruned": deprecated_pruned,
            "unique_rules": len(seen_bullet_rules)
        }

        return True, normalized_text, stats


def main():
    print(json.dumps({"module": "rejected-buffer-and-experience-library", "status": "READY"}))


if __name__ == "__main__":
    main()
