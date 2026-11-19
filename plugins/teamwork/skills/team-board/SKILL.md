---
name: team-board
description: "[Teamwork Swarm Board] Append-only JSONL message board with channels, @mentions, #seq zero-copy handoff refs, and automated stall detection."
argument-hint: "<post|read|status|stall-check> [args]"
allowed-tools:
  - read
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Swarm Message Board & Stall Monitor (`/team-board`)

Antigravity-style zero-copy coordination across parallel agents using monotonic `#seq` references in `.agents/teamwork/board.jsonl`.

## Protocol Rules
- **Cite `#seq`, Never Copy-Paste**: Tell peers `@reviewer check #4` instead of duplicating reports.
- **Channels**: Keep cross-area chatter out of `main`; use `#survey`, `#tests`, `#m1`, `#gate`.
- **Stall Check**: Run `stall-check` to catch orphaned `[done]` results, unanswered `@mentions`, or error loops.

## Commands
```bash
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" board channel-create m1 --topic "Milestone 1" --workdir .
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" board post --from worker_m1 --channel m1 --text "@coordinator [done] -> .agents/teamwork/worker_m1/handoff.md"
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" board read --since 0 --channel m1 --reader coordinator
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" stall-check --stale-min 10 --workdir .
```
