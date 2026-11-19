# Harness Forge Protocol (SkillOps + PMSP Memory + MCP)

Factory and governance layer ensuring every skill and project memory document adheres to strict deterministic schemas across target repositories (`project`, `global`, or `--target <plugin>`).

## Four-Layer Standard Enforcement
1. **Validated MCP Writes (`mcp-server/server.mjs`)**: `memory_upsert`, `memory_record_adr`, and `skill_scaffold` verify `source_refs` on disk, compute SHA-256 + line maps, and recompile `memory.rc.json` transactionally.
2. **HASP Runtime Guardrails (`hooks.json`)**: `pf-rcjson-readonly` blocks direct edits to `memory.rc.json`/`MEMORY.md`/`.cache/`; `pf-memory-guard` & `pf-skill-contract-guard` validate direct file edits and auto-rebuild indexes.
3. **Blocking `Stop` Hook & Git Hook**: Refuses turn completion if `.memory/` is out of sync; `forge-cli.mjs install-git-hook` guards human commits.
4. **Code-to-Memory Drift Detection**: `forge-cli.mjs memory drift` hashes `source_refs` against HEAD and flags `stale: true`.

## Enterprise `rcjson` MCP Coexistence
Set `"FORGE_MCP_MODE": "validator-only"` when pairing with an external read-only company `rcjson` MCP — the `.memory/` layout and HASP hooks stay 100% compatible.
