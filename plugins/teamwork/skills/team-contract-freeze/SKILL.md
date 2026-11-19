---
name: team-contract-freeze
description: "[Teamwork Contract Freeze] Validate and SHA-256 hash PROJECT.md Interface Contracts into state.json before parallel Track A & Track B execution."
argument-hint: "[optional path to PROJECT.md]"
allowed-tools:
  - read
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Contract Freeze (`/team-contract-freeze`)

Prevents interface signature drift between Track A (`test-writer`) and parallel Track B (`worker` milestones) by freezing `PROJECT.md § Interface Contracts`.

## Steps
1. Verify `<active_orchestrator>/PROJECT.md` contains non-empty `## Interface Contracts` and `## Feature Inventory`.
2. Execute:
   ```bash
   node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" state freeze-contract --workdir .
   ```
3. Confirm `state.json` records `contract_sha256` and phase `CONTRACT_FROZEN`.
4. Announce the frozen digest on `board.jsonl`:
   ```bash
   node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" board post --from coordinator --text "@all Interface contracts frozen in PROJECT.md. Track A and Track B may start."
   ```
