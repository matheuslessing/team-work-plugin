---
name: team-worktree
description: "[Teamwork Worktree Isolation] Provision, inspect, merge (after CLEAN Gate), and prune isolated Git Worktrees for concurrent milestone workers."
argument-hint: "<status|create|diff|merge|prune> [agent_id]"
allowed-tools:
  - read
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Git Worktree Lifecycle (`/team-worktree`)

Isolate parallel workers physically in `.agents/teamwork/<agent_id>/worktree` (`teamwork/<agent_id>`) and merge only after Gate approval.

## Commands
- **Create isolated workspace**:
  `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" spawn <agent_id> worker --milestone M1 --own "src/m1/**" --worktree`
- **Inspect worktrees & diff**:
  `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" worktree status --workdir .`
  `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" worktree diff <agent_id> --workdir .`
- **Merge after CLEAN Gate** (blocks merge if `GATE_STATUS.md` is not PASS/CLEAN):
  `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" worktree merge <agent_id> --workdir .`
- **Cleanup**:
  `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" worktree prune <agent_id> --delete-branch --workdir .`
