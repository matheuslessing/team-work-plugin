# Teamwork Suite — Multi-Plugin Engineering Architecture

This repository is a Devin CLI / Cloud & Antigravity **Meta-Plugin Suite** bundling two self-contained plugins:
1. **`plugins/teamwork/`**: Autonomous Dual-Track LTS execution harness (`Sentinel -> Orchestrator -> Explorers -> Contract Freeze -> Track A/B -> Adversarial & Forensic Gate -> Harness² Propose-Probe-Compose -> Victory Audit`).
2. **`plugins/harness-forge/`**: SkillOps 5-tuple skill factory/migrator, PMSP Project Memory (`.memory/` + compiled `memory.rc.json`), embedded stdio MCP server, drift detector, and `Skill-Use` benchmark suite.

Shared validation schemas, YAML frontmatter helpers, and HASP Program Function runners live in `packages/core/` and are synced into each sub-plugin via `node scripts/sync-core.mjs`.
