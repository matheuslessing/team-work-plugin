---
name: quick
description: Run the Small Focused Team workflow (1 Explorer/Worker + repeated Adversarial Reviewer & Forensic Auditor loop) for a single self-contained bug fix, feature, or refactor.
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

# Teamwork Small Focused Team (`/teamwork:quick`)

Use this workflow when the task is a **single self-contained change** (a bug fix, small feature, or contained refactor) that does not need to be split across multiple parallel milestone workers, but still demands **Teamwork's adversarial review and forensic integrity guarantees**.

## Execution Protocol

1. **Initialize Workspace**:
   - Record the task and acceptance criteria in `.agents/teamwork/ORIGINAL_REQUEST.md` with header:
     `This is a single self-contained fix; keep it small and focused.`
   - Create `.agents/teamwork/orchestrator_1/GATE_STATUS.md`.

2. **Step 1 — Focused Implementation (`teamwork:worker`)**:
   - Create `.agents/teamwork/worker_m1/DISPATCH.md` with exact scope and acceptance criteria.
   - Spawn `teamwork:worker` to investigate the root cause, implement the fix, add/update authentic unit/integration tests, and produce its 5-Component `handoff.md`.

3. **Step 2 — Adversarial Review & Forensic Gate**:
   - Spawn `teamwork:reviewer` and `teamwork:forensic-auditor` in parallel to inspect `worker_m1`'s changes and tests.
   - Record verdicts in `.agents/teamwork/orchestrator_1/GATE_STATUS.md`.

4. **Step 3 — Iterative Hardening**:
   - If `reviewer` returns `REQUEST_CHANGES` or `forensic-auditor` returns `🔴 INTEGRITY VIOLATION`, spawn `worker_remediation` to fix the exact defects and re-run the Gate until `APPROVE` + `🟢 CLEAN`.
