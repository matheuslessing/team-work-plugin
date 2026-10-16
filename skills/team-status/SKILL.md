---
name: team-status
description: "[Teamwork Mission Dashboard] Show live status of .agents/teamwork/, including active subagents, milestone progress, 5-Component Handoffs, and Gate verdicts."
allowed-tools:
  - read
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Mission Status Dashboard (`/team-status`)

Run `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" status --workdir .` and inspect `.agents/teamwork/` in the current repository to present a concise status dashboard:

1. Check `.agents/teamwork/RUNTIME_ENV.md`, `.agents/teamwork/ORIGINAL_REQUEST.md`, `.agents/teamwork/sentinel/BRIEFING.md`, `.agents/teamwork/orchestrator_1/BRIEFING.md`, `.agents/teamwork/orchestrator_1/PROJECT.md`, and `.agents/teamwork/orchestrator_1/GATE_STATUS.md`.
2. Scan all `<agent_id>/BRIEFING.md`, `progress.md`, and `handoff.md` files under `.agents/teamwork/`.
3. Present:
   - **Detected Runtime & Active Engine** (`DEVIN_CLOUD` [`.agents/teamwork/workflow.py` / Managed Devins] vs `DEVIN_CLI_LOCAL` [Custom CLI Subagents])
   - **Mission & Integrity Mode**
   - **Current Phase & Active Orchestrator**
   - **Team Roster Table** (`Agent | Archetype | Milestone | Status | Verdict`)
   - **Gate Status Summary** (`Iteration | Reviewers | Challengers | Forensic Auditor | Gate Result`)
   - **Dead Ends / Active Remediation Items** (from `DEAD_ENDS.md` and `GATE_STATUS.md`)
