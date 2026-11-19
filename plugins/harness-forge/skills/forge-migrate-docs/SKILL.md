---
name: forge-migrate-docs
description: "[Forge Docs Standardizer] Ingest existing docs/wikis/READMEs or map an undocumented codebase into standardized PMSP .memory/ notes with verified source_refs and compiled memory.rc.json."
argument-hint: "[source docs directory or target modules]"
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

# Forge Documentation Standardizer (`/forge-migrate-docs`)

Transform legacy project documentation (`docs/`, `README.md`, wikis, architecture notes) into clean, drift-tracked PMSP `.memory/` artifacts.

## Steps
1. Initialize `.memory/` in the target workspace:
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" memory init --workdir .
   ```
2. Spawn `forge:doc-standardizer` (or execute directly):
   - Inventory existing Markdown files and core codebase modules.
   - Split monolithic docs into focused notes across `architecture/`, `decisions/`, `contracts/`, and `gotchas/`.
   - Attach **real** `source_refs` (`path` + optional `symbols`) verified against files on disk, and persist each note via MCP `memory_upsert` (or `forge-cli.mjs memory upsert`) so `sha256_prefix`, `token_estimate`, and `memory.rc.json` compile automatically.
3. Verify strict sync & zero broken refs:
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" validate --workdir . --strict
   ```
