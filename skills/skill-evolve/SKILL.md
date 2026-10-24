---
name: skill-evolve
description: >-
  Use this skill whenever an existing skill is found to be incorrect, out of date,
  or when an adversarial gate fails due to flawed skill instructions. Automatically
  optimizes and refines the skill using bounded edits and validation gates.
---

# Skill Evolution & Auto-Refinement Protocol

This skill operationalizes **SkillOpt** and **Harness²** self-evolution within the agent workspace.

## 1. When to Trigger
- **Gate Failure**: When `GATE_STATUS.md` records `FAIL` caused by outdated CLI syntax, wrong flags, or invalid workflows in a skill.
- **Runtime Error**: When an agent reports a command failure that directly followed instructions in a `SKILL.md`.
- **Session Consolidation**: At the end of a successful task, to capture non-obvious workspace quirks or verified commands.

## 2. Refinement Steps

### Step 1: Trace the Defect
Identify:
1. The exact file path of the defective skill: `skills/<skill_name>/SKILL.md`.
2. The specific target text block containing the obsolete/failing instructions.
3. The empirical working solution discovered during execution.

### Step 2: Propose Bounded Diff
Do **NOT** overwrite the entire file manually. Run the SkillOpt proposal gate:

```bash
python scripts/skillopt-engine.py propose \
  --skill skills/<skill_name>/SKILL.md \
  --target "<exact block of text to replace>" \
  --replacement "<corrected block of text>"
```

### Step 3: Verify the Validation Gate
Confirm that the JSON output returns:
```json
"validation_gate": "PASS",
"can_adopt": true
```
If errors are reported (e.g., broken frontmatter or malformed codeblocks), adjust the replacement block.

### Step 4: Adopt the Refinement
Execute adoption to persist the change with automatic backup creation:

```bash
python scripts/skillopt-engine.py adopt \
  --skill skills/<skill_name>/SKILL.md \
  --target "<exact block of text to replace>" \
  --replacement "<corrected block of text>"
```

### Step 5: Document in Handoff
Record the change in `.agents/teamwork/skill_optimizer/handoff.md` following the 5-Component Handoff standard.
