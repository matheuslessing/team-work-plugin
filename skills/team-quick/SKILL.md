---
name: team-quick
description: "[Teamwork Small Focused Team] Run 1 Milestone Worker + repeated Adversarial Reviewer & Forensic Auditor loop for a self-contained bug fix, feature, or refactor."
argument-hint: "<description of the self-contained fix or feature>"
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

# Teamwork Small Focused Team (`/team-quick`)

Use this workflow when the task is a **single self-contained change** (a bug fix, small feature, or contained refactor) that does not need to be split across multiple parallel milestone workers, but still demands **Teamwork's adversarial review and forensic integrity guarantees**.

## Step 0: Automatic Runtime Detection (No User Reminder Needed)
Run environment detection and workspace initialization first:
```bash
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" init --workdir .
```
- **If `DEVIN_CLOUD` is detected (DO NOT wait for the user to remind you to use workflows)**:
  1. **Primary Cloud Engine**: Run `.agents/teamwork/workflow.py --mode quick` (`teamwork-quick-pipeline`: `1 Worker -> Parallel Reviewer + Forensic Auditor loop`).
  2. **Automatic Fallback**: If the Dynamic Workflow runner is not active in this session, immediately use **Managed Devins** (`devin_session_create` + `devin_session_gather`) to spawn `worker_m1` followed by parallel `reviewer_1` and `auditor_1`.
- **If `DEVIN_CLI_LOCAL` is detected**:
  - Dispatch local custom subagents (`teamwork:worker`, `teamwork:reviewer`, `teamwork:forensic-auditor`).

## Execution Protocol

1. **Initialize Workspace**:
   - Record the task and acceptance criteria in `.agents/teamwork/ORIGINAL_REQUEST.md` with header:
     `This is a single self-contained fix; keep it small and focused.`
   - Ensure `.agents/teamwork/orchestrator_1/GATE_STATUS.md` exists.

2. **Step 1 — Focused Implementation (`worker`)**:
   - Create `.agents/teamwork/worker_m1/DISPATCH.md` with exact scope and acceptance criteria.
   - Dispatch `worker_m1` (via `.agents/teamwork/workflow.py --mode quick`, `devin_session_create`, or `teamwork:worker`) to investigate the root cause, implement the fix, add/update authentic unit/integration tests, and produce its 5-Component `handoff.md`.

3. **Step 2 — Adversarial Review & Forensic Gate**:
   - Dispatch `reviewer` and `forensic-auditor` in parallel to inspect `worker_m1`'s changes and tests.
   - Record verdicts in `.agents/teamwork/orchestrator_1/GATE_STATUS.md`.

4. **Step 3 — Iterative Hardening**:
   - If `reviewer` returns `REQUEST_CHANGES` or `forensic-auditor` returns `🔴 INTEGRITY VIOLATION`, spawn `worker_remediation` to fix the exact defects and re-run the Gate until `APPROVE` + `🟢 CLEAN`.
