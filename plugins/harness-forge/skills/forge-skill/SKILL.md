---
name: forge-skill
description: "[Forge Skill Factory] Smart skill triage + scaffolding and validation in SkillOps 5-tuple + HASP + Progressive Disclosure format for project, global, or plugin targets."
argument-hint: "[skill-name or target path] [--scope project|global|plugin] [--target <dir>]"
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

# Forge Standardized Skill & Smart Triage (`/forge-skill`)

Single entry-point for creating, checking, or routing skills in the target repository or plugin.

## Target Scopes (Skill Scope Cascade)
- `--scope project` *(default)*: `<repo>/.agents/skills/<name>/`
- `--scope global`: `~/.agents/skills/<name>/`
- `--scope plugin --target <dir>`: `<dir>/skills/<name>/`

## Step 0: Smart Deterministic Triage (Zero LLM)
When the target already exists or no specific operation was requested, triage first (or call MCP `skill_triage`):
```bash
node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skill triage [target] --workdir .
```
Route by `action`:
- `SCAFFOLD` -> proceed to Steps 1–4 below.
- `MIGRATE` -> run `/forge-migrate-skill`.
- `SKILLOPS_FIX` -> run `/forge-skillops` (directory) or `/forge-validate` (single skill).
- `EVAL_EVOLVE` -> run `/forge-evolve` (`eval-skills`).
- `CLEAN` -> report clean status.

## Steps 1–4 (Scaffold New Skill)
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
