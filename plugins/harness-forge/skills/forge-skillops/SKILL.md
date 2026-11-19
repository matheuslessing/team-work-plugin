---
name: forge-skillops
description: "[Forge SkillOps Maintenance] Build Skill Ecosystem Graph (5 edge types), detect skill technical debt/redundancy, and execute library-time maintenance without extra LLM calls."
argument-hint: "<audit|graph|telemetry> [--skills-dir <dir>] [--strict]"
allowed-tools:
  - read
  - glob
  - exec
triggers:
  - user
  - model
---

# Forge SkillOps Ecosystem Manager (`/forge-skillops`)

Library-time skill maintenance (*SkillOps*, arXiv:2605.13716) preventing skill technical debt, broken validators, and context bloat.

## Commands
- **Audit all skills** (validates 5-tuples, HASP `.pf.mjs` links, bloat, and Jaccard overlap):
  ```bash
  node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skillops audit --skills-dir .agents/skills --strict
  ```
- **Build Ecosystem Graph** (`depends_on`, `compatible_with`, `redundant_with`, `alternative_to`, `lineage`):
  ```bash
  node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skillops graph --skills-dir .agents/skills
  ```
- **Inspect Skill Telemetry** (success rate & token cost):
  ```bash
  node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skillops telemetry --workdir .
  ```

## Maintenance Actions
Act on `maintenanceActions`: `merge` overlapping skills, `repair` invalid contracts, `add_validator` for unchecked skills, or `retire` obsolete skills.
