---
name: team-survey
description: "[Teamwork Phase 0 Survey] Consult project memory (.memory/) for architecture & drift, dispatch parallel read-only Explorers, and synthesize PROJECT.md."
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

Produce an empirical, contract-ready architecture plan (`<active_orchestrator>/PROJECT.md`) without burning tokens on redundant blind grepping.

## Steps
1. **Memory-First Lookup (PMSP)**:
   - If `.memory/memory.rc.json` exists, query index and run drift check (`forge-cli.mjs memory drift` or MCP `memory_index` + `memory_drift`) to reuse verified context and flag stale docs.
2. **Partition & Dispatch Parallel Explorers**:
   - Transition state to `SURVEY` (`teamwork-cli.mjs state transition SURVEY`).
   - Spawn 2–3 `teamwork:explorer` agents (`authority_profile: read_only`) with `DISPATCH.md` covering distinct domains.
3. **Synthesize `<active_orchestrator>/PROJECT.md`**:
   - Merge all Explorer `handoff.md` findings into `PROJECT.md` with: `## Architecture`, `## Feature Inventory`, `## Milestones`, `## Interface Contracts`, and `## Code Layout` (assigning strictly disjoint `Own exclusively:` paths per milestone).
4. **Next Gate**:
   - Run `/team-contract-freeze` to hash `§ Interface Contracts` before starting Dual-Track workers.
