# Enterprise `rcjson` MCP Adapter & Coexistence Guide

## 1. Compatibility Design ("Only the MCP Changes")

`harness-forge` cleanly separates **on-disk persistence** (`.memory/`) from **MCP transport**:

- **`.memory/memory.rc.json`** is deterministically compiled from individual Markdown files (`.memory/{architecture,decisions,contracts,gotchas}/*.md`) so merge conflicts never happen and human/code diffs remain clean in Git.
- **`FORGE_MEMORY_ROOT` / `.forge.json`**: If your enterprise documentation lives outside the code repo or in a custom folder, add `.forge.json` at the repo root:
  ```json
  {
    "memoryRoot": "../company-docs/.memory"
  }
  ```

## 2. Two Operating Modes

| Scenario | Recommended `FORGE_MCP_MODE` | Read Path | Write & Standard Guarantee |
|---|---|---|---|
| **Standalone / Personal / Open Source** | `"full"` *(default)* | Embedded `harness-forge-memory` MCP (`memory_index`, `memory_search`, `memory_read`) | MCP `memory_upsert` + HASP Hooks (`pf-rcjson-readonly`, `pf-memory-guard`) + `Stop` gate |
| **Enterprise with Company `rcjson` MCP** | `"validator-only"` | Your company `rcjson` MCP reads `.memory/memory.rc.json` and `.memory/**/*.md` | `harness-forge` MCP provides `memory_upsert` / `memory_drift` / `skill_validate`, and HASP hooks validate any direct Markdown edit + recompile `memory.rc.json` automatically |

## 3. Custom Enterprise Index Mapping

If your company's `rcjson` MCP expects additional top-level keys or different filenames, add a small mapper script reading `.memory/memory.rc.json` (which contains `schema_version`, `git_head`, and `entries[]` with `id`, `kind`, `status`, `stale`, `path`, `summary`, `tags`, `token_estimate`, `sections[]`, `source_refs[]`).
