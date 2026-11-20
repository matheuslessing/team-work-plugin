---
name: forge-evolve
description: "[Forge Harness² + Voyager Evolver] Run post-mission cross-task recursion: promote verified lessons to .memory/, propose HASP Program Functions or learned skills, and gate with Skill-Use evals."
argument-hint: "[--suite <eval-dir>] [--min-score 0.90]"
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

# Forge Recursive Harness Evolver (`/forge-evolve`)

Implements **Harnessing-Level Recursion** (*Harness²*) and **Verified Skill Library Promotion** (*Voyager*).

## Governed Evolution Protocol (Never Commit Directly to Main)
1. **Collect Execution Evidence**:
   - Inspect `.agents/teamwork/skill-bom.json`, `<active_orchestrator>/DEAD_ENDS.md`, and `skill-telemetry.jsonl`.
2. **Promote Verified Project Memory**:
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" memory promote --workdir .
   ```
3. **Propose & Verify New Learned Skill / HASP PF**:
   - Spawn `forge:harness-evolver` on an isolated branch (`teamwork/evolve`) to turn repeated dead ends into deterministic `.pf.mjs` guards or `.memory/skills-learned/<name>/` procedures.
4. **Regression Gate (`Skill-Use` + `SkillOps`)**:
   ```bash
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" skillops audit --skills-dir .agents/skills --strict
   node "${PLUGIN_ROOT}/scripts/forge-cli.mjs" eval-skills --suite tests/evals/skill-use --min-score 0.90
   ```
   Only merge the evolution branch if SU Score improves or holds with zero regressions.
