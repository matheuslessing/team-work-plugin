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
3. **Design It Twice & Synthesize `<active_orchestrator>/PROJECT.md`**:
   - For critical or shared subsystem boundaries, explore **2 candidate deep-module interface designs** (Ousterhout depth/seam/leverage) before locking signatures.
   - Partition `## Milestones` into independently testable **Vertical Slices** (`M1..Mn`, end-to-end deliverable slices rather than disconnected horizontal layers) with disjoint `Own exclusively:` paths.
   - Merge all Explorer `handoff.md` findings into `PROJECT.md` with: `## Architecture`, `## Feature Inventory`, `## Milestones`, `## Interface Contracts`, and `## Code Layout`.
4. **Next Gate**:
   - Run `/team-contract-freeze` to hash `§ Interface Contracts` before starting Dual-Track workers.
