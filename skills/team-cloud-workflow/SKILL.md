---
name: team-cloud-workflow
description: "[Teamwork Devin Cloud 100%] Run the deterministic Devin Dynamic Workflow (workflow.py) or Managed Devins in Devin Cloud with parallel VMs, reactive P2P wakeup, and cron schedules."
argument-hint: "[project requirements or path to ORIGINAL_REQUEST.md]"
triggers:
  - user
  - model
---

# Teamwork Cloud Dynamic Workflow & Managed Devins (`/team-cloud-workflow`)

In **Devin Cloud** (or when connected to the **Devin MCP Server** `https://mcp.devin.ai/mcp`), Teamwork achieves **100% parity** with Antigravity's native runtime by combining **Devin Dynamic Workflows (`workflow.py`)** and **Managed Devins**.

## How the "Missing 10%" Works Natively in Devin Cloud

| Capability | Devin Cloud / Devin MCP Mechanism |
| :--- | :--- |
| **1. Async P2P Messaging & Reactive Wakeup** (`send_message`) | **`devin_session_create` + `devin_session_interact` + `devin_session_gather`**: The Coordinator spawns child Devin sessions, sends live follow-up messages to running sessions, and sleeps until automatically woken when children finish or request input. |
| **2. 30-Min Orchestrator VM Watchdog (`watch_dog`) & Crons** (`schedule`) | **3-Layer Anti-Idle Watchdog (30m Window / 10m Pulse)**: Prevents the primary Orchestrator VM from dropping due to inactivity while waiting on child VMs via: (a) background daemon `teamwork-cli.mjs watchdog start --window-min 30 --interval-min 10`, (b) async `orchestrator_vm_watchdog()` inside `workflow.py`, and (c) `devin_schedule_manage` (`*/20 * * * *`). |
| **3. Isolated Workspaces / Branches** (`Workspace: branch/share`) | **Separate VM vs. Shared VM**: Each child session runs either on its own isolated Cloud VM (pushing its milestone branch `teamwork/worker-m1`) or on a Shared VM sharing `.agents/teamwork/`. |
| **4. Deterministic Resumable Pipeline** | **[`workflow.py`](./workflow.py)**: Orchestrates `Survey -> Dual-Track -> Gate -> Remediation Loop -> Victory Audit` as a deterministic, replayable Python workflow script. |

---

## Execution Modes in Devin Cloud (Automatic Priority Order)

### 1. Primary Engine: Deterministic Dynamic Workflow (`.agents/teamwork/workflow.py`)
`node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" init` (or `detect-env`) automatically provisions `.agents/teamwork/workflow.py` and starts the 30-minute `watch_dog` daemon so the project root stays clean and the primary VM never times out.

It supports all 4 Teamwork workflow modes via `--mode <full|quick|survey|gate>` (or `TEAMWORK_WORKFLOW_MODE`):
- **`--mode full`** (`/team-run`, `/team-craft`):
  - **Phase 0 (`survey`)**: Parallel `agent()` calls for 3 Explorers $\to$ synthesizes `PROJECT.md` and interface contracts.
  - **Phase 1 (`dual_track`)**: `parallel()` execution of Track A (`test_writer` building Tiers 1–4 E2E tests) + Track B (`worker` sessions implementing each Milestone).
  - **Phase 2 (`gate_verification`)**: `parallel()` execution of `reviewer`, `challenger`, and `forensic_auditor` returning structured JSON verdicts (`APPROVE`/`REQUEST_CHANGES` and `CLEAN`/`INTEGRITY_VIOLATION`).
  - **Phase 3 (`remediation`)**: Deterministic loop (up to 3 iterations) that automatically spawns a remediation worker and re-runs the Gate if ANY check fails.
  - **Phase 4 (`victory_audit`)**: Final independent `victory_auditor` check before completing.
- **`--mode quick`** (`/team-quick`): `1 Worker -> Parallel Reviewer + Forensic Auditor loop`.
- **`--mode survey`** (`/team-survey`): `3 Parallel Explorers -> Orchestrator PROJECT.md synthesis`.
- **`--mode gate`** (`/team-gate`, `/team-audit`): `Parallel Reviewer + Challenger + Forensic Auditor -> GATE_STATUS.md`.

### 2. Automatic Fallback Engine: Managed Devins Coordinator (`devin_session_*`)
If the Dynamic Workflow SDK/runner is not active in the current session, automatically fall back to **Managed Devins** without asking the user:
1. Act as **Sentinel / Coordinator** and verify the 30-minute VM watchdog is running (`node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" watchdog start --window-min 30 --interval-min 10`).
2. Call `devin_session_create` to launch parallel child sessions for Explorers, Test Writer, and Milestone Workers, passing the role rules from `agents/<role>.md` in each session's prompt.
3. Register a session-level `watch_dog` schedule using `devin_schedule_manage` (`*/20 * * * *` — inside the 30-minute idle timeout window) to wake up the Orchestrator session, run `teamwork-cli.mjs watchdog pulse`, and keep the primary VM alive.
4. Call `devin_session_gather` to await completion reactively without polling.
5. Use `devin_session_interact` to send mid-flight clarifications or remediation instructions.
