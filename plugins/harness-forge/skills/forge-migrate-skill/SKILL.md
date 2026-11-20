---
name: forge-migrate-skill
description: "[Forge Skill Migrator] Analyze and upgrade legacy SKILL.md, playbooks, or prompts into standardized SkillOps 5-tuple + HASP + Progressive Disclosure skills."
argument-hint: "<path-to-legacy-skill> [--scope project|global|plugin] [--target <dir>]"
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

# Forge Legacy Skill Migrator (`/forge-migrate-skill`)

Convert any legacy `SKILL.md` or ad-hoc markdown instruction file into the SkillOps 5-tuple + HASP standard inside your chosen target scope (`project`, `global`, or `--target <plugin-dir>`).

## Steps
1. Run deterministic static pre-analysis:
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skill analyze-legacy <legacy_path>
   ```
2. Spawn `harness-forge:skill-migrator` (or apply directly):
   - Extract oversized details (> 220 lines) into `<target>/<name>/references/`.
   - Synthesize `skill.contract.json` (`P_preconditions`, `O_operation` authority profile, `A_artifacts`, `V_validators`, `F_failure_modes`, `ecosystem_edges`).
   - Convert brittle "remember to check X" prose warnings into deterministic `.pf.mjs` Program Functions when recurring failure risks exist.
3. Validate and refresh ecosystem graph:
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skill validate <target>/<name>
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skillops graph --skills-dir <target_skills_dir>
   ```
