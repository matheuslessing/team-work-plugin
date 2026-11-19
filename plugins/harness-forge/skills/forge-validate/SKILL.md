---
name: forge-validate
description: "[Forge Compliance Gate] Strictly validate 100% of .memory/ docs, memory.rc.json index sync, and skill SkillOps contracts without LLM calls."
argument-hint: "[--workdir <dir>] [--strict]"
allowed-tools:
  - read
  - glob
  - exec
triggers:
  - user
  - model
---

# Forge Strict Standard Validator (`/forge-validate`)

Deterministic validator verifying both PMSP Project Memory and SkillOps contracts.

## Steps
1. Run strict validation across workspace memory and project skills:
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" validate --workdir . --strict
   ```
2. Optionally install the local Git pre-commit hook to guard human edits too:
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" install-git-hook --workdir .
   ```
3. If `memory.rc.json` is out of sync, run `memory rebuild` (never edit `memory.rc.json` manually).
