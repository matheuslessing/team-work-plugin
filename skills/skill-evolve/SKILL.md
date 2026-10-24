---
name: skill-evolve
description: >-
  Use this skill whenever an existing skill is found to be incorrect, out of date,
  or when an adversarial gate fails due to flawed skill instructions. Automatically
  optimizes and refines the skill using bounded edits and validation gates.
---

# Skill Evolution & Auto-Refinement Protocol

This skill operationalizes **SkillOpt** and **Google Research Harness²** self-evolution within the agent workspace.

## 1. When to Trigger
- **Gate Failure**: When `GATE_STATUS.md` records `REQUEST_CHANGES` caused by outdated CLI syntax, wrong flags, or invalid workflows in a skill.
- **Runtime Error**: When an agent reports a command failure that directly followed instructions in a `SKILL.md`.
- **Session Consolidation**: At the end of a successful task, to capture non-obvious workspace quirks or verified commands.

## 2. The 6-Step Self-Healing Pipeline

```text
[Failure / Gate Defect]
          │
          ▼
1. Trajectory Divergence (t*) ──► Pinpoint exact step where agent diverged
          │
          ▼
2. Interactive Sandbox Probe ──► Empirically test candidate action in sandbox
          │
          ▼
3. Negative Rejection Buffer ──► Verify candidate is NOT in rejected_edit_buffer
          │
          ▼
4. Bounded Diff Proposal ──────► Run validation gate (zero test regression)
          │
          ▼
5. Human Approval Gate ────────► PreToolUse hook intercepts mutation (decision: "ask")
          │
          ▼
6. Slow Meta-Update ───────────► Prune deprecation bloat & compress tokens
```

### Step 1: Trace the Defect & Divergence Step ($t^*$)
Use `scripts/harness-probe.py` to compare the failing trajectory with reference behavior:
```bash
python scripts/harness-probe.py --isolate-t-star
```

### Step 2: Interactive Sandbox Probe
Before proposing patches, probe the candidate action in an isolated sandbox subprocess to guarantee exit code 0:
```python
from scripts.harness_probe import InteractiveSandboxProbe
probe = InteractiveSandboxProbe(timeout_seconds=5.0)
success, out, code = probe.probe_candidate_action("your_candidate_command")
```

### Step 3: Check Negative Rejection Buffer
Confirm that the replacement candidate has not previously failed validation:
```python
from scripts.experience_memory import RejectedEditBuffer
buf = RejectedEditBuffer(workspace_root)
blocked, reason = buf.is_edit_prohibited(skill_name, target, replacement)
```

### Step 4: Propose Bounded Diff
Do **NOT** overwrite the entire file manually. Run the SkillOpt proposal gate:
```bash
python scripts/skillopt-engine.py propose \
  --skill skills/<skill_name>/SKILL.md \
  --target "<exact block of text to replace>" \
  --replacement "<corrected block of text>"
```

Confirm that the output returns `"validation_gate": "PASS"` and `"can_adopt": true`.

### Step 5: Adopt with Human Approval Gate
Execute adoption. The `PreToolUse` hook in `hooks.json` will intercept the write and prompt the developer for explicit confirmation before touching disk:
```bash
python scripts/skillopt-engine.py adopt \
  --skill skills/<skill_name>/SKILL.md \
  --target "<exact block of text to replace>" \
  --replacement "<corrected block of text>"
```

### Step 6: Slow Meta-Update & Token Compression
When a skill accumulates multiple incremental patches or exceeds token budgets (>1,200 tokens), run the epoch-level consolidator:
```bash
python scripts/experience-memory.py --slow-meta-update skills/<skill_name>/SKILL.md
```

### Step 7: Document in Handoff
Record the change in `.agents/teamwork/skill_optimizer/handoff.md` following the mandatory 5-Component Handoff standard.
