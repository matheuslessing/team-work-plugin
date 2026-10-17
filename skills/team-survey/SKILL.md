---
name: team-survey
description: "[Teamwork Phase 0 Survey] Dispatch parallel read-only Explorer subagents to map architecture, trace root causes, and generate .agents/teamwork/orchestrator_1/PROJECT.md."
argument-hint: "[requirements or areas to survey]"
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

# Teamwork Phase 0 Codebase Survey (`/team-survey`)

Execute a comprehensive, read-only multi-agent survey of the codebase to establish empirical facts, identify root causes, and author `.agents/teamwork/orchestrator_1/PROJECT.md`.

## Step 0: Automatic Runtime Detection & 30-Minute `watch_dog` (No User Reminder Needed)
Run environment detection and automatic 30-minute VM `watch_dog` startup first:
```bash
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" detect-env --workdir .
```
- **If `DEVIN_CLOUD` is detected**: `detect-env` automatically starts the 30-minute `watch_dog` daemon (`window=30m, pulse=10m`). Automatically run `.agents/teamwork/workflow.py --mode survey` (`teamwork-survey-pipeline`) as primary engine, or fall back automatically to spawning parallel Explorer child sessions via `devin_session_create` + `devin_session_gather` (with `devin_schedule_manage` `*/20 * * * *` `watch_dog`).
- **If `DEVIN_CLI_LOCAL` is detected**: Spawn parallel `teamwork:explorer` custom subagents.

## Steps

1. **Partition Survey Scope**:
   Divide the project requirements (from `.agents/teamwork/ORIGINAL_REQUEST.md` or the user's prompt) into 2–3 logical domains (`explorer_survey_1`, `explorer_survey_2`, `explorer_survey_3`).
2. **Create Dispatch Files**:
   Write `.agents/teamwork/explorer_survey_N/DISPATCH.md` for each explorer defining its exact investigation scope.
3. **Spawn Parallel Explorers**:
   Dispatch the parallel explorers (via `.agents/teamwork/workflow.py --mode survey`, `devin_session_create`, or `teamwork:explorer`) to investigate their assigned domains and produce `analysis.md` and 5-Component `handoff.md`.
4. **Synthesize `PROJECT.md`**:
   Cross-check all Explorer handoff reports and write `.agents/teamwork/orchestrator_1/PROJECT.md` with:
   - `## Architecture`
   - `## Feature Inventory` (table mapping 100% of requirements `F1..Fn` to milestones)
   - `## Milestones` (`TestTrack`, `M1..Mn`, `M_Final`)
   - `## Interface Contracts` (exact class/function signatures and events)
   - `## Code Layout`
