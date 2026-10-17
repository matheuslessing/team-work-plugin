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

## Step 0: Automatic Runtime Detection & 30-Minute `watch_dog` (No User Reminder Needed)
Run environment detection, 30-minute Orchestrator VM watchdog initialization, and workspace setup immediately:
```bash
node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" init --workdir .
```
Check the detected runtime (`.agents/teamwork/RUNTIME_ENV.md` or output of `init`):
- **If `DEVIN_CLOUD` is detected (DO NOT wait for the user to remind you to use workflows)**:
  0. **30-Minute Orchestrator VM Watchdog (`watch_dog`)**: `init` automatically starts the detached background daemon (`watchdog start --window-min 30 --interval-min 10`) pulsing `.agents/teamwork/watchdog.log` and `progress.md` every 10 minutes so the primary Orchestrator VM never drops due to 30-minute idle timeouts. Also register a session-level `watch_dog` cron via `devin_schedule_manage` (`*/20 * * * *`) if available.
  1. **Primary Cloud Engine — Dynamic Workflow (`.agents/teamwork/workflow.py`)**: Execute `.agents/teamwork/workflow.py --mode full` (which also runs `orchestrator_vm_watchdog()` asynchronously). Copy `.agents/teamwork/workflow.py` to `./workflow.py` only if the active workflow runner requires root placement.
  2. **Automatic Fallback — Managed Devins (`devin_session_create`)**: If the Dynamic Workflow runner is not active in the current session, immediately orchestrate all 4 phases below by spawning parallel child Devin sessions via `devin_session_create` + `devin_session_gather` with the 30-minute `watch_dog` cron (`*/20 * * * *`) active.
- **If `DEVIN_CLI_LOCAL` is detected**:
  - Dispatch the custom subagent profiles (`teamwork:sentinel`, `teamwork:orchestrator`, `teamwork:explorer`, `teamwork:test-writer`, `teamwork:worker`, `teamwork:reviewer`, `teamwork:challenger`, `teamwork:forensic-auditor`, `teamwork:victory-auditor`).

## Step 1: Record Ground Truth (`ORIGINAL_REQUEST.md`)
1. If `.agents/teamwork/ORIGINAL_REQUEST.md` does not yet exist, create it from the user's request (or from `.agents/teamwork/prompt_draft.md` if present).
2. Ensure `.agents/teamwork/ORIGINAL_REQUEST.md` clearly defines:
   - Project overview & Working directory
   - `Runtime environment: DEVIN_CLOUD | DEVIN_CLI_LOCAL`
   - `Integrity mode: development | demo | benchmark`
   - Numbered Requirements (`### R1.`, `### R2.`, ...)
   - Checkable Acceptance Criteria (`- [ ] ...`)

## Step 2: Initialize Sentinel & Orchestrator Workspaces
Ensure the directory tree exists under `.agents/teamwork/`:
- `.agents/teamwork/RUNTIME_ENV.md` (and `.agents/teamwork/workflow.py` when in Cloud)
- `.agents/teamwork/sentinel/BRIEFING.md`
- `.agents/teamwork/orchestrator_1/DISPATCH.md`

## Step 3: Execute Dual-Track Orchestration (Devin Cloud & Devin CLI)
Execute all 4 phases using the detected runtime engine from Step 0:

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
