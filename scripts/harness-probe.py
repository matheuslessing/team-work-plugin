#!/usr/bin/env python3
"""
Harness² Contrastive Engine: Propose-Probe-Compose for Agent Harnesses and Skills.
Extracted from Google Research Harness² core methodology.
Features:
1. Contrastive Proposer: Behavioral contrast mining from execution logs.
2. Trajectory Divergence Step Isolator (t* finder): Pinpointing the exact divergence step.
3. Interactive Sandbox Probe: Sandboxed pre-execution of proposed patches before composition.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ExecutionContrast:
    task_id: str
    failed_command: str
    error_output: str
    remedied_command: Optional[str] = None
    root_cause_clause: Optional[str] = None
    lesson_learned: Optional[str] = None


@dataclass
class DivergencePoint:
    step_index: int
    action_type: str
    failing_action: str
    expected_or_successful_action: Optional[str] = None
    divergence_reason: str = ""


class TrajectoryDivergenceFinder:
    """Isolates the exact divergence point (t*) where an agent trajectory derailed."""

    def find_divergence_step(
        self,
        failing_trajectory: List[Dict[str, Any]],
        successful_trajectory: Optional[List[Dict[str, Any]]] = None
    ) -> Optional[DivergencePoint]:
        """
        Compares step-by-step or inspects failure signals to locate t*.
        Each step is a dict: {"step": int, "tool": str, "args": dict, "status": str, "output": str}
        """
        if successful_trajectory:
            min_len = min(len(failing_trajectory), len(successful_trajectory))
            for i in range(min_len):
                fail_step = failing_trajectory[i]
                succ_step = successful_trajectory[i]

                # Check action divergence
                if fail_step.get("tool") != succ_step.get("tool") or fail_step.get("args") != succ_step.get("args"):
                    return DivergencePoint(
                        step_index=fail_step.get("step", i),
                        action_type=fail_step.get("tool", "unknown"),
                        failing_action=str(fail_step.get("args", {})),
                        expected_or_successful_action=str(succ_step.get("args", {})),
                        divergence_reason=f"Action mismatch at step {i}: {fail_step.get('tool')} vs {succ_step.get('tool')}"
                    )

                # Check status divergence
                if fail_step.get("status") == "ERROR" and succ_step.get("status") == "SUCCESS":
                    return DivergencePoint(
                        step_index=fail_step.get("step", i),
                        action_type=fail_step.get("tool", "unknown"),
                        failing_action=str(fail_step.get("args", {})),
                        expected_or_successful_action=str(succ_step.get("args", {})),
                        divergence_reason=f"Command execution error at step {i}: {fail_step.get('output', '')}"
                    )

        # Fallback: scan failing trajectory for first ERROR status
        for i, step in enumerate(failing_trajectory):
            if step.get("status") == "ERROR" or "error" in str(step.get("output", "")).lower():
                return DivergencePoint(
                    step_index=step.get("step", i),
                    action_type=step.get("tool", "exec"),
                    failing_action=str(step.get("args", {})),
                    divergence_reason=f"First failure detected at step {i}: {step.get('output', '')}"
                )

        return None


class InteractiveSandboxProbe:
    """Executes behavioral probe candidates in an isolated sub-process environment."""

    def __init__(self, timeout_seconds: float = 10.0):
        self.timeout_seconds = timeout_seconds

    def probe_candidate_action(
        self,
        command: str,
        env_vars: Optional[Dict[str, str]] = None,
        cwd: Optional[Path] = None
    ) -> Tuple[bool, str, int]:
        """Runs the proposed command in sandbox to verify whether it remedies the error."""
        clean_env = os.environ.copy()
        if env_vars:
            clean_env.update(env_vars)

        try:
            res = subprocess.run(
                command,
                shell=True,
                cwd=str(cwd) if cwd else None,
                env=clean_env,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds
            )
            success = (res.returncode == 0)
            output = (res.stdout + "\n" + res.stderr).strip()
            return success, output, res.returncode
        except subprocess.TimeoutExpired:
            return False, f"Probe timed out after {self.timeout_seconds}s", -1
        except Exception as e:
            return False, f"Probe failed with exception: {str(e)}", -2


class HarnessContrastiveProposer:
    """Proposes targeted skill & harness refinements based on behavioral contrast."""

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.divergence_finder = TrajectoryDivergenceFinder()
        self.sandbox_probe = InteractiveSandboxProbe()

    def analyze_trajectory(self, trajectory_log: str) -> List[ExecutionContrast]:
        """Extracts contrastive failure-vs-success pairs from execution logs."""
        contrasts = []
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
