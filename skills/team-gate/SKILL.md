---
name: team-gate
description: "[Teamwork Verification Gate] Execute the full 3-agent Gate (Adversarial Reviewer + Empirical Challenger + Binary Forensic Auditor) and record verdicts in GATE_STATUS.md."
argument-hint: "[iteration number or target milestones]"
allowed-tools:
  - read
  - edit
  - grep
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Verification Gate (`/team-gate`)

Run an independent, multi-agent Verification Gate across the implemented milestones and test suites.

## Step 0: Automatic Runtime Detection & 30-Minute `watch_dog` (No User Reminder Needed)
Run environment detection and automatic 30-minute VM `watch_dog` startup first:
```bash
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" detect-env --workdir .
```
- **If `DEVIN_CLOUD` is detected**: `detect-env` automatically starts the 30-minute `watch_dog` daemon (`window=30m, pulse=10m`). Automatically run `.agents/teamwork/workflow.py --mode gate` (`teamwork-gate-pipeline`) as primary engine, or fall back automatically to spawning parallel Reviewer, Challenger, and Forensic Auditor child sessions via `devin_session_create` + `devin_session_gather` (with `devin_schedule_manage` `*/20 * * * *` `watch_dog`).
- **If `DEVIN_CLI_LOCAL` is detected**: Spawn parallel `teamwork:reviewer`, `teamwork:challenger`, and `teamwork:forensic-auditor` subagents.

## Steps

1. **Determine Gate Iteration**:
   Check `.agents/teamwork/orchestrator_1/GATE_STATUS.md` to determine the current iteration (`Gate — Iteration K`).
2. **Dispatch Gate Subagents in Parallel**:
   - **`reviewer`** (`reviewer_K`): Line-by-line code & requirements verification against `ORIGINAL_REQUEST.md` and `PROJECT.md`. Outputs `APPROVE` or `REQUEST_CHANGES`.
   - **`challenger`** (`challenger_K`): Empirical stress, boundary, and edge-case testing via `exec`. Outputs `APPROVE` or `REQUEST_CHANGES`.
   - **`forensic-auditor`** (`auditor_K`): Exhaustive 4-phase integrity audit checking production code, assets, test suites (for mock tautologies), and live test runner execution. Outputs `🟢 CLEAN` or `🔴 INTEGRITY VIOLATION`.
3. **Update `GATE_STATUS.md`**:
   Compile all verdicts into a markdown table in `.agents/teamwork/orchestrator_1/GATE_STATUS.md`:
   - **Gate Result = `PASS`** only if all Reviewers = `APPROVE`, all Challengers = `APPROVE`, and Forensic Auditor = `🟢 CLEAN`.
   - **Gate Result = `FAIL`** if any agent rejects or flags a violation; list every exact defect at the bottom of `GATE_STATUS.md` for immediate remediation.
