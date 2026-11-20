---
trigger: glob
globs:
  - ".agents/teamwork/**"
description: Runtime routing for Devin Cloud (workflow.py / Managed Devins + 30m watch_dog) vs Devin CLI Local / Antigravity.
---

# Automatic Runtime Detection & 30-Min `watch_dog`

Runtime is auto-detected on `SessionStart` / `UserPromptSubmit` via `teamwork-cli.mjs detect-env`:
- **`DEVIN_CLOUD`**: 30m VM keep-alive daemon starts automatically (`watchdog start --window-min 30 --interval-min 10`). Execute `.agents/teamwork/workflow.py --mode <full|quick|survey|gate>`, or fall back to Managed Devins (`devin_session_create` + `devin_session_gather` + `devin_schedule_manage` `*/20 * * * *`).
- **`DEVIN_CLI_LOCAL` / `ANTIGRAVITY`**: Dispatch scoped subagents (`teamwork:*`) with isolated Git Worktrees (`spawn ... --worktree`) and Swarm Board (`board.jsonl` `#seq`).
