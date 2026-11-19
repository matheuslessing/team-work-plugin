---
name: team-quick
description: "[Teamwork Small Focused Team] Compact pipeline (1 scoped Worker + parallel Adversarial Reviewer & Binary Forensic Auditor loop) for contained fixes or small features."
argument-hint: "<description of self-contained fix or feature>"
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

Compact pipeline for self-contained fixes that still require independent adversarial review and forensic anti-cheat verification.

## Steps
1. Run `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" init --workdir .` and record scope in `.agents/teamwork/ORIGINAL_REQUEST.md`.
2. **Implementation (`worker_quick_1`)**:
   - Register worker scope (`teamwork-cli.mjs spawn worker_quick_1 worker --own <target_globs>`).
   - Implement genuine fix + authentic unit/integration tests; verify 0 compile/test errors; write 5-Component `handoff.md`.
3. **Compact Gate (`reviewer` + `forensic-auditor`)**:
   - Spawn `teamwork:reviewer` and `teamwork:forensic-auditor` in parallel.
   - Update `<active_orchestrator>/GATE_STATUS.md`.
4. **Remediation Loop (max 3 iterations)**:
   - On `REQUEST_CHANGES` or `🔴 INTEGRITY VIOLATION`, log to `DEAD_ENDS.md`, spawn `worker_remediation_K`, and re-run the Gate until `APPROVE` + `🟢 CLEAN`.
   - Transition `state.json` to `DONE` only when Gate passes.
