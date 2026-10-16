---
name: team-run
description: "[Teamwork Full Pipeline] Launch the autonomous multi-agent system (Sentinel -> Orchestrator -> Parallel Explorers -> Dual-Track E2E Tests & Milestone Workers -> Adversarial & Forensic Gate -> Victory Audit)."
argument-hint: "[project prompt or path to ORIGINAL_REQUEST.md]"
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

# Teamwork Autonomous Multi-Agent Pipeline (`/team-run`)

Execute the complete **Teamwork Project Pattern** with Dual-Track execution and Binary Forensic Gate enforcement.

## Step 1: Record Ground Truth (`ORIGINAL_REQUEST.md`)
1. If `.agents/teamwork/ORIGINAL_REQUEST.md` does not yet exist, create it from the user's request (or from `.agents/teamwork/prompt_draft.md` if present).
2. Ensure `.agents/teamwork/ORIGINAL_REQUEST.md` clearly defines:
   - Project overview & Working directory
   - `Integrity mode: development | demo | benchmark`
   - Numbered Requirements (`### R1.`, `### R2.`, ...)
   - Checkable Acceptance Criteria (`- [ ] ...`)

## Step 2: Initialize Sentinel & Orchestrator Workspaces
Create the directory tree under `.agents/teamwork/`:
- `.agents/teamwork/sentinel/BRIEFING.md`
- `.agents/teamwork/orchestrator_1/DISPATCH.md`

## Step 3: Execute Dual-Track Orchestration (Devin CLI & Devin Cloud)
Spawn `teamwork:sentinel` / `teamwork:orchestrator` (in **Devin CLI** via custom subagent profiles; in **Devin Cloud** via Managed Devins `devin_session_create` + `devin_session_gather` or Cloud subagents reading `.agents/teamwork/<id>/DISPATCH.md`) to run all 4 phases:

1. **Phase 0 — Parallel Codebase Survey (`explorer`)**:
   - Spawn 2–3 `teamwork:explorer` subagents in parallel to inspect the codebase, packages, assets, and root causes.
   - Each explorer produces `.agents/teamwork/explorer_survey_N/analysis.md` and 5-component `handoff.md`.
   - Synthesize findings into `.agents/teamwork/orchestrator_1/PROJECT.md` (Architecture, 100% Feature Inventory `F1..Fn`, Milestones `TestTrack` + `M1..Mn`, exact Interface Contracts, and Code Layout).

2. **Phase 1 — Dual-Track Execution (Parallel)**:
   - **Track A (`test-writer`)**: Build `TEST_INFRA.md`, 4-tier E2E test suites (`Tier 1: Feature >=5`, `Tier 2: Boundary >=5`, `Tier 3: Combinatorial`, `Tier 4: Real-World Scenarios`), an authentic CLI test runner, and `TEST_READY.md`.
   - **Track B (`worker` Milestones `M1..Mn`)**: Dispatch parallel milestone workers with strict, non-overlapping file write ownership (`Own exclusively: [...]`) coding against `PROJECT.md § Interface Contracts`.

3. **Phase 2 — Verification Gate (`GATE_STATUS.md`)**:
   - Spawn in parallel:
     - `teamwork:reviewer` (Adversarial code & requirements review -> `APPROVE` | `REQUEST_CHANGES`)
     - `teamwork:challenger` (Empirical stress & boundary testing -> `APPROVE` | `REQUEST_CHANGES`)
     - `teamwork:forensic-auditor` (Anti-cheating audit checking for mock tautologies, facade runners, and stubs -> `🟢 CLEAN` | `🔴 INTEGRITY VIOLATION`)
   - Record all verdicts in `.agents/teamwork/orchestrator_1/GATE_STATUS.md`.

4. **Phase 3 — Remediation Loop (If Gate Fails)**:
   - If ANY Reviewer/Challenger returns `REQUEST_CHANGES` or the Forensic Auditor returns `🔴 INTEGRITY VIOLATION`:
     - Log the failure in `.agents/teamwork/orchestrator_1/DEAD_ENDS.md`.
     - Spawn remediation explorers/workers (`worker_remediation`) to fix all defects and replace any mock tests with authentic production-bound tests.
     - Re-run the next Gate Iteration (`Gate — Iteration K`) until 100% `APPROVE` + `🟢 CLEAN`.

## Step 4: Mandatory Victory Audit (`victory-auditor`)
Before reporting completion to the user, spawn `teamwork:victory-auditor` to verify every checkbox in `ORIGINAL_REQUEST.md` and confirm live test execution passes at 100%.
