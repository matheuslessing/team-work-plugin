---
trigger: glob
globs:
  - ".agents/teamwork/**/BRIEFING.md"
  - ".agents/teamwork/**/handoff.md"
  - ".agents/teamwork/**/PROJECT.md"
  - ".agents/teamwork/**/GATE_STATUS.md"
description: Enforces exact schemas for BRIEFING.md, PROJECT.md, GATE_STATUS.md, and 5-Component handoff.md artifacts.
---

# Teamwork Artifact Schemas

When writing inside `.agents/teamwork/`, strictly adhere to:
1. **`BRIEFING.md`**: `## Mission`, `## 🔒 My Identity`, `## 🔒 Key Constraints`, `## Key Decisions Made`, `## Artifact Index`.
2. **`PROJECT.md`**: `## Architecture`, `## Feature Inventory`, `## Milestones`, `## Interface Contracts` (frozen via `state freeze-contract` before Dual-Track), `## Code Layout`.
3. **`handoff.md` (5 Components)**: `## 1. Observation`, `## 2. Logic Chain`, `## 3. Caveats`, `## 4. Conclusion` (plus binary verdict for Gate agents), `## 5. Verification Method` (including `Invalidation Conditions`). Validate with `teamwork-cli.mjs validate-handoff`.
