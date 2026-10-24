#!/usr/bin/env python3
"""
Harness² Contrastive Engine: Propose-Probe-Compose for Agent Harnesses and Skills.
Extracted from Google Research Harness² core methodology.
Analyzes run failures, behavioral contrasts, and synthesizes refined skills/prompts.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class ExecutionContrast:
    task_id: str
    failed_command: str
    error_output: str
    remedied_command: Optional[str] = None
    root_cause_clause: Optional[str] = None
    lesson_learned: Optional[str] = None


class HarnessContrastiveProposer:
    """Proposes targeted skill & harness refinements based on behavioral contrast."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root

    def analyze_trajectory(self, trajectory_log: str) -> List[ExecutionContrast]:
        """Extracts contrastive failure-vs-success pairs from execution logs."""
        contrasts = []
        
        # Match lines like: Command 'docker-compose up -d --no-deps' failed: exit code 127
        failure_pattern = re.compile(
            r"Command\s+['\"](?P<cmd>[^'\"]+)['\"]\s+failed:\s*(?P<err>[^\r\n]+)",
            re.IGNORECASE
        )
        
        for match in failure_pattern.finditer(trajectory_log):
            cmd = match.group("cmd").strip()
            err = match.group("err").strip()
            contrasts.append(
                ExecutionContrast(
                    task_id="run_contrast",
                    failed_command=cmd,
                    error_output=err
                )
            )
        return contrasts

    def compose_skill_patch(self, skill_text: str, contrast: ExecutionContrast) -> Tuple[Optional[str], Optional[str]]:
        """
        Synthesizes a contrastive Propose-Probe-Compose patch:
        Finds where the failed command or its syntax appears in the skill,
        and generates the corrected replacement block.
        """
        # Exact match
        if contrast.failed_command in skill_text:
            target = contrast.failed_command
            replacement = contrast.remedied_command or f"# NOTE: {contrast.error_output}\n{contrast.failed_command}"
            return target, replacement

        # Markdown backtick match e.g. `cmd`
        backtick_cmd = f"`{contrast.failed_command}`"
        if backtick_cmd in skill_text:
            target = backtick_cmd
            replacement = f"`{contrast.remedied_command.strip('`')}`" if contrast.remedied_command else backtick_cmd
            return target, replacement

        return None, None
