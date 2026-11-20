---
name: forge-drift
description: "[Forge Drift Detector] Compare source_refs SHA-256 hashes and symbol references against current files on disk to flag and cure stale project memory."
argument-hint: "[--fail-on-drift]"
allowed-tools:
  - read
  - grep
  - glob
  - exec
triggers:
  - user
  - model
---

# Forge Code-to-Memory Drift Detector (`/forge-drift`)

Prevent agents from trusting outdated documentation by verifying SHA-256 prefixes and symbols in `source_refs` against live files.

## Steps
1. Run deterministic drift check (recompiles `memory.rc.json` with `stale: true` and exact `drift_reasons`):
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" memory drift --workdir .
   ```
2. For each stale entry, inspect the changed code file and spawn `harness-forge:memory-curator` (or call `memory_upsert`) to refresh the `.md` doc and reset `stale: false`.
3. Retire obsolete docs cleanly with `memory retire <id> --status superseded --superseded-by <new_id>`.
