---
name: team-status
description: "[Teamwork Mission Dashboard] Render live outcome Threads, Attention queue, Skill-BOM summary, and Gate status from view.json and state.json."
allowed-tools:
  - read
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Mission Dashboard (`/team-status`)

Generate and present the outcome-oriented live dashboard (Antigravity Narrator `view.json` model) across the active orchestrator generation.

## Steps
1. Run:
   ```bash
   node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" status --workdir .
   ```
2. Optionally inspect `.agents/teamwork/view.json`, `.agents/teamwork/state.json`, `.agents/teamwork/board-meta.json`, and active `GATE_STATUS.md`.
3. Present:
   - **LTS Phase, Active Orchestrator & Budget Usage** (`spawns_used`, `remediations_used`)
   - **Outcome Threads & Workstream States**
   - **Prioritized Attention Queue** (`decision > failure > review > stuck > quota > error > fyi`)
   - **Latest Gate Result & Stall Monitor Check**
