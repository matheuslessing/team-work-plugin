---
name: survey
description: Run Phase 0 parallel codebase exploration using read-only Explorer subagents and synthesize findings into .agents/teamwork/orchestrator_1/PROJECT.md.
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

# Teamwork Phase 0 Codebase Survey (`/teamwork:survey`)

Execute a comprehensive, read-only multi-agent survey of the codebase to establish empirical facts, identify root causes, and author `.agents/teamwork/orchestrator_1/PROJECT.md`.

## Steps

1. **Partition Survey Scope**:
   Divide the project requirements (from `.agents/teamwork/ORIGINAL_REQUEST.md` or the user's prompt) into 2–3 logical domains (`explorer_survey_1`, `explorer_survey_2`, `explorer_survey_3`).
2. **Create Dispatch Files**:
   Write `.agents/teamwork/explorer_survey_N/DISPATCH.md` for each explorer defining its exact investigation scope.
3. **Spawn Parallel Explorers**:
   Spawn `teamwork:explorer` subagents in parallel to investigate their assigned domains and produce `analysis.md` and 5-Component `handoff.md`.
4. **Synthesize `PROJECT.md`**:
   Cross-check all Explorer handoff reports and write `.agents/teamwork/orchestrator_1/PROJECT.md` with:
   - `## Architecture`
   - `## Feature Inventory` (table mapping 100% of requirements `F1..Fn` to milestones)
   - `## Milestones` (`TestTrack`, `M1..Mn`, `M_Final`)
   - `## Interface Contracts` (exact class/function signatures and events)
   - `## Code Layout`
