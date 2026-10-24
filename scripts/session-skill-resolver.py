#!/usr/bin/env python3
"""
Dynamic Session Skill Resolver & Ephemeral Tracker.
Tracks which skills were actively invoked / activated during the current session:
1. Resolves skill locations: Project workspace, User Global (~/.gemini/ or ~/.devin/), and Built-ins.
2. In-Session Invocation Tracker: Records active skills in the session context ledger.
3. Live In-Session Self-Evolution: Updates the exact skill instance that failed during runtime.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set


@dataclass
class SessionSkillManifest:
    session_id: str
    active_skills: Dict[str, str]  # skill_name -> absolute_path
    invoked_turn_history: List[Dict[str, str]] = field(default_factory=list)


class SessionSkillResolver:
    """Discovers and tracks skills loaded or invoked in the current active session."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.ledger_path = workspace_root / ".agents" / "teamwork" / "session_skills.json"

    def discover_available_skills(self) -> Dict[str, Path]:
        """Resolves all available skills prioritizing project > global > builtin."""
        skills = {}
        search_roots = [
            self.workspace_root / "skills",
            self.workspace_root / ".agents" / "skills",
            Path.home() / ".devin" / "skills",
            Path.home() / ".gemini" / "antigravity-cli" / "builtin" / "skills",
        ]

        for root in search_roots:
            if root.exists() and root.is_dir():
                for skill_dir in root.iterdir():
                    skill_md = skill_dir / "SKILL.md"
                    if skill_md.exists() and skill_dir.name not in skills:
                        skills[skill_dir.name] = skill_md

        return skills

    def record_skill_invocation(self, session_id: str, skill_name: str, turn_idx: int) -> Optional[Path]:
        """Records that a skill was actively invoked in this conversation session."""
        skills = self.discover_available_skills()
        if skill_name not in skills:
            return None

        skill_path = skills[skill_name]
        self.ledger_path.parent.mkdir(parents=True, exist_ok=True)

        data = {"session_id": session_id, "active_skills": {}, "history": []}
        if self.ledger_path.exists():
            try:
                data = json.loads(self.ledger_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        data["active_skills"][skill_name] = str(skill_path.resolve())
        data["history"].append({
            "turn": turn_idx,
            "skill": skill_name,
            "path": str(skill_path.resolve()),
        })

        self.ledger_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return skill_path

    def get_session_active_skills(self) -> Dict[str, str]:
        """Returns the dictionary of skills that were actually invoked in this session."""
        if not self.ledger_path.exists():
            return {}
        try:
            data = json.loads(self.ledger_path.read_text(encoding="utf-8"))
            return data.get("active_skills", {})
        except Exception:
            return {}


def main():
    resolver = SessionSkillResolver(Path("."))
    skills = resolver.discover_available_skills()
    print(json.dumps({
        "total_discovered_skills": len(skills),
        "skills": {k: str(v) for k, v in skills.items()}
    }, indent=2))


if __name__ == "__main__":
    main()
