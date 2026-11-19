---
name: forge-skill
description: "[Forge Skill Factory] Scaffold and validate new skills in SkillOps 5-tuple + HASP + Progressive Disclosure format for project, global, or plugin targets."
argument-hint: "<skill-name> [--scope project|global|plugin] [--target <dir>]"
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

# Forge Standardized Skill (`/forge-skill`)

Create a new SkillOps-compliant skill (`SKILL.md` + `skill.contract.json` + optional HASP `.pf.mjs`) in the target repository or plugin.

## Target Scopes (Skill Scope Cascade)
- `--scope project` *(default)*: `<repo>/.agents/skills/<name>/`
- `--scope global`: `~/.devin/skills/<name>/`
- `--scope plugin --target <dir>`: `<dir>/skills/<name>/`

## Steps
1. Scaffold via CLI (or MCP `skill_scaffold`):
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skill scaffold <name> --scope project --description "<clear 1-sentence trigger description>" --authority scoped_worker --update-graph
   ```
2. Keep `SKILL.md` under 220 lines (extract long guides into `references/`).
3. Populate `P_preconditions`, `O_operation`, `A_artifacts`, `V_validators`, `F_failure_modes`, and `ecosystem_edges` in `skill.contract.json`.
4. Validate strictly:
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skill validate <target_dir>/<name>
   ```
