---
name: team-run
description: "[Teamwork Full Pipeline] Execute the full Dual-Track LTS pipeline: Survey -> Contract Freeze -> Isolated Worktree Milestones + E2E Tests -> Adversarial & Forensic Gate -> Propose-Probe-Compose -> Victory Audit."
argument-hint: "[project prompt or path to ORIGINAL_REQUEST.md]"
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

# Teamwork Autonomous Dual-Track Pipeline (`/team-run`)

Orchestrate end-to-end delivery through the LTS state machine (`INIT -> SURVEY -> CONTRACT_FROZEN -> DUAL_TRACK -> GATE -> VICTORY_AUDIT -> DONE`).

## Execution Steps
1. **Initialize Harness**:
   - Run `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" init --workdir .` (creates `state.json`, `view.json`, detects `DEVIN_CLOUD` vs `DEVIN_CLI_LOCAL` / `ANTIGRAVITY`, and provisions Cloud `workflow.py` + 30m `watch_dog` if needed).
   - Ensure `.agents/teamwork/ORIGINAL_REQUEST.md` defines `R1..Rn` and `- [ ]` acceptance criteria.
2. **Phase 0 — Survey & Contract Freeze**:
   - Transition to `SURVEY` and run `/team-survey` (consults `.memory/memory.rc.json` first, spawns parallel read-only `teamwork:explorer`s, synthesizes `<active_orchestrator>/PROJECT.md`).
   - Run `/team-contract-freeze` to hash `PROJECT.md § Interface Contracts` into `state.json`.
3. **Phase 1 — Dual-Track Execution**:
   - Transition to `DUAL_TRACK`.
   - Spawn Track A (`teamwork:test-writer`) for 4-tier E2E tests (`TEST_INFRA.md`, dynamic runner, `TEST_READY.md`).
   - Spawn Track B (`teamwork:worker`) per milestone using `teamwork-cli.mjs spawn <id> worker --own <globs> --worktree`.
   - Coordinate via `board.jsonl` `#seq` references (`/team-board`).
4. **Phase 2 — Verification Gate**:
   - Transition to `GATE` and run `/team-gate` (`reviewer` + `challenger` + `forensic-auditor` in parallel -> `GATE_STATUS.md`).
5. **Phase 3 — Remediation & Harness² Propose–Probe–Compose**:
   - If Gate fails once: log in `DEAD_ENDS.md`, spawn `worker_remediation_1`, re-run Gate.
   - If Gate fails >= 2x: run **Propose–Probe–Compose** ($k=2$ isolated worktree hypotheses probed live, then contrastively composed).
   - Never run Victory Audit while Gate is `FAIL`.
6. **Phase 4 — Merge, Victory Audit & Memory Promotion**:
   - Merge approved worktrees (`/team-worktree`), spawn `teamwork:victory-auditor`.
   - Upon `🟢 CLEAN`, transition to `DONE` and promote verified gotchas/ADRs to `.memory/`.
