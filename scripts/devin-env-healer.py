#!/usr/bin/env python3
"""
Devin Cloud Environment & Blueprint Profiler + Auto-Healer.
Detects startup latency, broken blueprints, missing environment secrets,
and cold-start bottlenecks in Devin Cloud VMs.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class EnvironmentDiagnostic:
    issue_type: str        # "STARTUP_LATENCY" | "MISSING_SECRET" | "BROKEN_BLUEPRINT" | "SLOW_DEPENDENCY"
    severity: str          # "CRITICAL" | "WARNING" | "INFO"
    source_file: str       # e.g., ".devin/blueprint.yaml" or ".env"
    details: str
    remediation_suggestion: str
    bounded_target: Optional[str] = None
    bounded_replacement: Optional[str] = None


class DevinEnvironmentDiagnoser:
    """Diagnoses and heals environment startup and blueprint latency in Devin Cloud."""

    LATENCY_THRESHOLD_SECONDS = 45.0

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root

    def inspect_blueprint(self, blueprint_path: Path) -> List[EnvironmentDiagnostic]:
        """Scans blueprint.yaml for anti-patterns causing slow VM boot or broken builds."""
        diagnostics = []
        if not blueprint_path.exists():
            return diagnostics

        content = blueprint_path.read_text(encoding="utf-8")

        # Anti-pattern 1: Heavy installs running inside `maintenance` or runtime instead of `initialize`
        if re.search(r"apt-get\s+update.*install", content) and "initialize:" not in content:
            diagnostics.append(
                EnvironmentDiagnostic(
                    issue_type="STARTUP_LATENCY",
                    severity="WARNING",
                    source_file=str(blueprint_path),
                    details="System packages (apt-get) are installed outside of 'initialize'. This causes repeated downloads on every session boot instead of being cached in the snapshot image.",
                    remediation_suggestion="Move apt-get packages to the 'initialize:' section of blueprint.yaml so Devin bakes them into the snapshot."
                )
            )

        # Anti-pattern 2: Uncached npm / pip installs without frozen lockfiles or cache mounts
        if re.search(r"npm\s+install(?!\s+--prefer-offline|\s+--cache|\s+ci)", content):
            diagnostics.append(
                EnvironmentDiagnostic(
                    issue_type="SLOW_DEPENDENCY",
                    severity="WARNING",
                    source_file=str(blueprint_path),
                    details="`npm install` is resolving packages over the network on startup instead of using frozen lockfiles (`npm ci`).",
                    remediation_suggestion="Replace `npm install` with `npm ci` in blueprint maintenance to use fast snapshot caching.",
                    bounded_target="npm install",
                    bounded_replacement="npm ci"
                )
            )

        # Anti-pattern 3: Hardcoded credentials or missing secret references
        if re.search(r"(?:api_key|secret|token)\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}['\"]", content, re.IGNORECASE):
            diagnostics.append(
                EnvironmentDiagnostic(
                    issue_type="MISSING_SECRET",
                    severity="CRITICAL",
                    source_file=str(blueprint_path),
                    details="Hardcoded sensitive credentials found in blueprint.yaml.",
                    remediation_suggestion="Migrate credential to Devin Cloud Secrets (Settings -> Resources -> Secrets) and inject via env var."
                )
            )

        return diagnostics

    def analyze_startup_logs(self, log_text: str) -> List[EnvironmentDiagnostic]:
        """Extracts latency and failure spikes from VM bootstrap / dynamic workflow logs."""
        diagnostics = []

        # Detect build step durations e.g., "Step 'npm install' took 120s"
        duration_matches = re.finditer(r"(?:Step|Command)\s+['\"](?P<step>[^'\"]+)['\"]\s+(?:took|elapsed):\s*(?P<secs>\d+(?:\.\d+)?)s", log_text, re.IGNORECASE)
        for m in duration_matches:
            step = m.group("step")
            secs = float(m.group("secs"))
            if secs > self.LATENCY_THRESHOLD_SECONDS:
                diagnostics.append(
                    EnvironmentDiagnostic(
                        issue_type="STARTUP_LATENCY",
                        severity="CRITICAL" if secs > 90 else "WARNING",
                        source_file="devin_boot_log",
                        details=f"Step '{step}' consumed {secs:.1f}s, causing significant VM startup bottleneck and slow response times.",
                        remediation_suggestion=f"Pre-bake '{step}' into Devin Snapshot via initialize section or use local dependency cache."
                    )
                )

        # Detect missing environment variables or connection timeouts
        if re.search(r"(?:connection timed out|ETIMEDOUT|ECONNREFUSED|401 Unauthorized|403 Forbidden)", log_text, re.IGNORECASE):
            diagnostics.append(
                EnvironmentDiagnostic(
                    issue_type="MISSING_SECRET",
                    severity="CRITICAL",
                    source_file="devin_boot_log",
                    details="Environment connection timeout or authentication failure detected during setup.",
                    remediation_suggestion="Verify Devin Cloud Environment Variables and Secrets configuration in the Devin project settings."
                )
            )

        return diagnostics


def main():
    workspace = Path(".")
    diagnoser = DevinEnvironmentDiagnoser(workspace)

    blueprint_candidates = [
        workspace / ".devin" / "blueprint.yaml",
        workspace / ".devin" / "blueprint.yml",
        workspace / "blueprint.yaml",
        workspace / "blueprint.yml",
    ]

    all_diagnostics = []
    for bp in blueprint_candidates:
        if bp.exists():
            all_diagnostics.extend(diagnoser.inspect_blueprint(bp))

    # Log inspection if provided via stdin or argument
    if len(sys.argv) > 1 and sys.argv[1] == "--log" and len(sys.argv) > 2:
        log_file = Path(sys.argv[2])
        if log_file.exists():
            all_diagnostics.extend(diagnoser.analyze_startup_logs(log_file.read_text(encoding="utf-8", errors="ignore")))

    report = {
        "timestamp": time.time(),
        "total_issues": len(all_diagnostics),
        "status": "HEALTHY" if len(all_diagnostics) == 0 else "NEEDS_OPTIMIZATION",
        "diagnostics": [
            {
                "issue_type": d.issue_type,
                "severity": d.severity,
                "source_file": d.source_file,
                "details": d.details,
                "remediation": d.remediation_suggestion,
                "bounded_target": d.bounded_target,
                "bounded_replacement": d.bounded_replacement,
            }
            for d in all_diagnostics
        ]
    }

    print(json.dumps(report, indent=2))
    sys.exit(0 if len(all_diagnostics) == 0 else 1)


if __name__ == "__main__":
    main()
