---
name: team-gate
description: "[Teamwork Verification Gate] Execute parallel 3-agent Gate (Adversarial Reviewer + Empirical Challenger + Binary Forensic Auditor) updating GATE_STATUS.md."
argument-hint: "[iteration number or target milestones]"
allowed-tools:
  - read
  - grep
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Verification Gate (`/team-gate`)

Run an independent 3-agent Gate on the active orchestrator iteration (`Gate — Iteration K`).

## Dispatch (Parallel)
1. **`teamwork:reviewer`** (`read_only`): Line-by-line verification against `ORIGINAL_REQUEST.md` and frozen `PROJECT.md` contracts (`APPROVE` | `REQUEST_CHANGES`).
2. **`teamwork:challenger`** (`read_only`): Empirical boundary, concurrency, and stress probes (`APPROVE` | `REQUEST_CHANGES`).
3. **`teamwork:forensic-auditor`** (`audit_only`): Runs `scan-integrity --strict` + 4-phase anti-cheat audit (`🟢 CLEAN` | `🔴 INTEGRITY VIOLATION`).

## Verdict Aggregation
Update `<active_orchestrator>/GATE_STATUS.md` and validate:
```bash
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" check-gate --workdir .
```
- **PASS** only when every Reviewer = `APPROVE`, every Challenger = `APPROVE`, and Forensic Auditor = `🟢 CLEAN`.
- On **FAIL**, record root causes in `<active_orchestrator>/DEAD_ENDS.md` and remediate (using Propose–Probe–Compose after iteration 2).
