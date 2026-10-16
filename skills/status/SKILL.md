---
name: status
description: Display a live dashboard of the current Teamwork mission (.agents/teamwork/), including active subagents, milestone statuses, and Gate verdicts.
allowed-tools:
  - read
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Mission Status Dashboard (`/teamwork:status`)

Inspect `.agents/teamwork/` in the current repository and present a concise status dashboard:

1. Check `.agents/teamwork/ORIGINAL_REQUEST.md`, `.agents/teamwork/sentinel/BRIEFING.md`, `.agents/teamwork/orchestrator_1/BRIEFING.md`, `.agents/teamwork/orchestrator_1/PROJECT.md`, and `.agents/teamwork/orchestrator_1/GATE_STATUS.md`.
2. Scan all `<agent_id>/BRIEFING.md`, `progress.md`, and `handoff.md` files under `.agents/teamwork/`.
3. Present:
   - **Mission & Integrity Mode**
   - **Current Phase & Active Orchestrator**
   - **Team Roster Table** (`Agent | Archetype | Milestone | Status | Verdict`)
   - **Gate Status Summary** (`Iteration | Reviewers | Challengers | Forensic Auditor | Gate Result`)
   - **Dead Ends / Active Remediation Items** (from `DEAD_ENDS.md` and `GATE_STATUS.md`)
