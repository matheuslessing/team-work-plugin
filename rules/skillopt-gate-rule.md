# SkillOpt & Harness² Continuous Evolution Gate Rule

This rule governs how agents handle flawed skills, command breakdowns, and knowledge updates.

---

## 1. Zero-Toleration for Silent Skill Drift
When an agent encounters a command failure, API error, or obsolete argument caused by directly following a workspace `SKILL.md`:
1. The agent **MUST NOT** simply ignore the error, hack around it locally, and move on without reporting.
2. The agent **MUST** flag the skill defect in its `handoff.md` and trigger `teamwork:skill-optimizer` or `/skill-evolve`.

---

## 2. Bounded Diff Requirement
- Under no circumstances should an agent rewrite an entire skill document from memory or scratch.
- All modifications to `skills/*/SKILL.md` must be bounded diffs (`Add`, `Delete`, `Replace`) executed through `scripts/skillopt-engine.py`.
- Frontmatter schemas (`name` e `description`) must always remain intact so progressive disclosure discovery is never broken.

---

## 3. Strict Validation Gate (`gate_no_regression`)
Every proposed evolution of a skill must pass:
1. Syntax and markdown integrity verification (`scripts/skillopt-engine.py validate`).
2. Preservation of verification sections and safety guardrails.
3. Verification that previous valid test scenarios continue to execute without regression.
