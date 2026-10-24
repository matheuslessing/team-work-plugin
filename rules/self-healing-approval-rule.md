# Mandatory User Approval Gate for Self-Healing & Skill Mutations

This rule enforces human-in-the-loop governance over automated self-evolution actions.

---

## 1. Zero Silent Overwrites
No agent or automated process may overwrite, adopt, or modify any file inside `skills/` or `.devin/blueprint.yaml` without explicit user confirmation.

---

## 2. PreToolUse Gating
When a self-healing action (`scripts/skillopt-engine.py adopt` or `scripts/devin-blueprint-optimizer.py`) is triggered:
1. The lifecycle hook intercepts the tool call before execution.
2. The user is presented with the exact diff:
   - What line was defective.
   - What replacement is proposed.
   - Why it failed in the terminal/Gate.
3. The mutation only proceeds after the user clicks "Allow" or inputs explicit confirmation.
