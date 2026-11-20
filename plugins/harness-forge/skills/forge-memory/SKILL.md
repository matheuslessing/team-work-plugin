---
name: forge-memory
description: "[Forge PMSP Memory] Initialize, query, record ADRs, and manage Project Memory (.memory/ + compiled memory.rc.json) with zero-trust validation."
argument-hint: "<init|index|search|read|upsert|adr|rebuild|promote> [args]"
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

# Forge PMSP Project Memory (`/forge-memory`)

Manage the repository's 4-layer Project Memory (`.memory/`) backed by compiled `memory.rc.json`, `MEMORY.md`, and local BM25 search.

## Hard Rules (Enforced by HASP + MCP)
- **NEVER edit `memory.rc.json`, `MEMORY.md`, or `.memory/.cache/*` directly** (`pf-rcjson-readonly` blocks direct edits).
- Always write via MCP (`memory_upsert` / `memory_record_adr` / `memory_promote`) OR write valid frontmatter `.md` files and let `pf-memory-guard` / `forge-cli.mjs memory rebuild` compile `memory.rc.json`.

## Operations
- **Initialize**: `node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" memory init --workdir .`
- **Index / Search / Read section**: `memory index`, `memory search --query "..."`, `memory read <id> --section <sec>`
- **Record ADR**: `node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" memory adr --title "..." --context "..." --decision "..." --consequences "..."`
- **Promote Teamwork lessons**: `node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" memory promote --workdir .`
