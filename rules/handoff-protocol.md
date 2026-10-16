---
trigger: glob
globs:
  - ".agents/teamwork/**/BRIEFING.md"
  - ".agents/teamwork/**/handoff.md"
  - ".agents/teamwork/**/PROJECT.md"
  - ".agents/teamwork/**/GATE_STATUS.md"
description: Enforces exact schema for BRIEFING.md, PROJECT.md, GATE_STATUS.md, and 5-Component handoff.md artifacts.
---

# Teamwork Artifact Schemas

When creating or updating files inside `.agents/teamwork/`, strictly adhere to these schemas:

## 1. `BRIEFING.md` Schema
Every agent must initialize and maintain `<working_dir>/BRIEFING.md` before starting its core task:
- `## Mission`: 1-2 sentence mission statement.
- `## 🔒 My Identity`: Archetype, Roles, Working directory, Parent ID, Milestone.
- `## 🔒 Key Constraints`: Exclusive file ownership (for workers) or read-only/dispatch-only rules.
- `## Task Summary` / `## Review Scope` / `## Audit Scope`: What to build/verify, interface contracts (`PROJECT.md`), and acceptance criteria.
- `## Key Decisions Made`: Running log of architectural and implementation decisions.
- `## Artifact Index`: Paths to `DISPATCH.md`, `BRIEFING.md`, `progress.md`, `analysis.md`/`changes.md`, and `handoff.md`.

## 2. `PROJECT.md` Schema (Orchestrator)
Created after Phase 0 Survey (`explorer` handoffs) and before Phase 1 Dual-Track dispatch:
- `## Architecture`: numbered breakdown of all subsystems.
- `## Feature Inventory`: Markdown table (`# | Feature | Description | Milestone | Source`) mapping 100% of requirements from `ORIGINAL_REQUEST.md`.
- `## Milestones`: Markdown table (`# | Name | Scope | Dependencies | Status`) including `TestTrack` and `M1..Mn`.
- `## Interface Contracts`: Exact class, method, signature, and data contract definitions between milestones so parallel workers and the test writer code against identical interfaces.
- `## Code Layout`: Directory structure of production modules and test suites.

## 3. `handoff.md` Schema (5-Component Report)
Every subagent handoff MUST include:
1. `## 1. Observation` (Concrete file paths, line numbers, compiler/test outputs)
2. `## 2. Logic Chain` (How Observations satisfy each Requirement & Acceptance Criterion)
3. `## 3. Caveats` (Any caveats, or `No caveats.`)
4. `## 4. Conclusion` (Summary + Verdict: `APPROVE` / `REQUEST_CHANGES` / `🟢 CLEAN` / `🔴 INTEGRITY VIOLATION`)
5. `## 5. Verification Method` (Reproducible commands + explicit `Invalidation Conditions`)
