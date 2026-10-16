---
name: cloud-workflow
description: Execute the Teamwork Dual-Track pipeline in Devin Cloud using a deterministic Devin Dynamic Workflow (workflow.py) or Managed Devins with parallel VMs, reactive wakeup, and scheduled crons.
argument-hint: "[project requirements or path to ORIGINAL_REQUEST.md]"
triggers:
  - user
  - model
---

# Teamwork Cloud Dynamic Workflow & Managed Devins (`/teamwork:cloud-workflow`)

In **Devin Cloud** (or when connected to the **Devin MCP Server** `https://mcp.devin.ai/mcp`), Teamwork achieves **100% parity** with Antigravity's native runtime by combining **Devin Dynamic Workflows (`workflow.py`)** and **Managed Devins**.

## How the "Missing 10%" Works Natively in Devin Cloud

| Capability | Devin Cloud / Devin MCP Mechanism |
| :--- | :--- |
| **1. Async P2P Messaging & Reactive Wakeup** (`send_message`) | **`devin_session_create` + `devin_session_interact` + `devin_session_gather`**: The Coordinator spawns child Devin sessions, sends live follow-up messages to running sessions, and sleeps until automatically woken when children finish or request input. |
| **2. Cron Timers & Heartbeats** (`schedule`) | **`devin_schedule_manage` & Self-Reminders**: The Sentinel/Coordinator sets recurring cron schedules (`*/8 * * * *`) or self-reminder messages to monitor long-running child sessions. |
| **3. Isolated Workspaces / Branches** (`Workspace: branch/share`) | **Separate VM vs. Shared VM**: Each child session runs either on its own isolated Cloud VM (pushing its milestone branch `teamwork/worker-m1`) or on a Shared VM sharing `.agents/teamwork/`. |
| **4. Deterministic Resumable Pipeline** | **[`workflow.py`](./workflow.py)**: Orchestrates `Survey -> Dual-Track -> Gate -> Remediation Loop -> Victory Audit` as a deterministic, replayable Python workflow script. |

---

## Execution Modes in Devin Cloud

### Mode A: Deterministic Dynamic Workflow (`workflow.py`)
Use the bundled [`workflow.py`](./workflow.py) template as the basis for your Dynamic Workflow run:
1. Read `.agents/teamwork/ORIGINAL_REQUEST.md`.
2. Customize `REPO` and `MILESTONES` in `workflow.py` (or run `workflow.py` directly in the Devin Cloud workflow runner).
3. The workflow executes:
   - **Phase 0 (`survey`)**: Parallel `agent()` calls for 3 Explorers $\to$ synthesizes `PROJECT.md` and interface contracts.
   - **Phase 1 (`dual_track`)**: `parallel()` execution of Track A (`test_writer` building Tiers 1–4 E2E tests) + Track B (`worker` sessions implementing each Milestone).
   - **Phase 2 (`gate_verification`)**: `parallel()` execution of `reviewer`, `challenger`, and `forensic_auditor` returning structured JSON verdicts (`APPROVE`/`REQUEST_CHANGES` and `CLEAN`/`INTEGRITY_VIOLATION`).
   - **Phase 3 (`remediation`)**: Deterministic `while` loop (up to `MAX_GATE_ITERATIONS`) that automatically spawns a remediation worker and re-runs the Gate if ANY check fails.
   - **Phase 4 (`victory_audit`)**: Final independent `victory_auditor` check before completing.

### Mode B: Managed Devins Coordinator (`devin_session_*`)
When orchestrating interactively via Managed Devins:
1. Act as **Sentinel / Coordinator**.
2. Call `devin_session_create` to launch parallel child sessions for Explorers, Test Writer, and Milestone Workers, passing the role rules from `agents/<role>.md` in each session's prompt.
3. Schedule a liveness check using `devin_schedule_manage` (or self-scheduled reminder).
4. Call `devin_session_gather` to await completion without polling.
5. Use `devin_session_interact` to send mid-flight clarifications or remediation instructions.
