---
name: team-cloud-workflow
description: "[Teamwork Devin Cloud 100%] Execute deterministic Python workflows (workflow.py) with 30m VM watch_dog, dynamic orchestrator resolution, and Harness² Propose-Probe-Compose."
argument-hint: "[--mode full|quick|survey|gate]"
allowed-tools:
  - read
  - grep
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Cloud Dynamic Workflow (`/team-cloud-workflow`)

Runs deterministic parallel orchestration in **Devin Cloud** (`.agents/teamwork/workflow.py`) or **Managed Devins** fallback with 3-layer 30-minute VM keep-alive (`watch_dog`).

## Workflow Modes
- `--mode full`: `Survey -> Dual-Track -> Gate -> Remediation / Propose-Probe-Compose -> Victory Audit` (hard barrier blocks Victory Audit on Gate failure).
- `--mode quick`: `1 Worker -> Reviewer + Forensic Auditor` loop with explicit `FAILED` escalation if exhausted.
- `--mode survey`: Parallel read-only Explorers -> `PROJECT.md`.
- `--mode gate`: Parallel `reviewer` + `challenger` + `forensic-auditor` -> deterministic `GATE_STATUS.md`.

## Commands
```bash
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" detect-env --workdir . --provision-workflow
python .agents/teamwork/workflow.py --check
python .agents/teamwork/workflow.py --mode full
```
If the Dynamic Workflow runner is unavailable, dispatch Managed Devins (`devin_session_create` + `devin_session_gather` + `devin_schedule_manage` `*/20 * * * *`).
