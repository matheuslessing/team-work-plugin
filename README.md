# Teamwork Plugin for Devin CLI

Autonomous multi-agent engineering system for **Devin CLI** featuring interactive 9-step prompt crafting, hierarchical multi-agent orchestration (`Sentinel -> Orchestrator -> Explorers, Test Writer, Milestone Workers`), Dual-Track 4-tier E2E testing, adversarial stress challengers, and binary forensic integrity auditing.

---

## Architecture Overview

```mermaid
flowchart TD
    User["User Request"] --> Craft["/team-craft (9-Step Prompt Crafting)"]
    Craft --> Sentinel["teamwork:sentinel (Root Supervisor)"]
    Sentinel --> Orch["teamwork:orchestrator (Dispatch-Only Orchestrator)"]

    subgraph Phase0["Phase 0: Codebase Survey"]
        Orch --> Exp1["teamwork:explorer 1"]
        Orch --> Exp2["teamwork:explorer 2"]
        Orch --> Exp3["teamwork:explorer 3"]
        Exp1 & Exp2 & Exp3 --> ProjectDoc["PROJECT.md (Contracts & Feature Inventory)"]
    end

    subgraph Phase1["Phase 1: Dual-Track Execution"]
        ProjectDoc --> TestWriter["Track A: teamwork:test-writer (4-Tier E2E Tests)"]
        ProjectDoc --> Workers["Track B: teamwork:worker (M1..Mn with Strict Write Boundaries)"]
    end

    subgraph Phase2["Phase 2: Adversarial & Forensic Gate"]
        Workers --> Reviewer["teamwork:reviewer (Requirements & Code Critic)"]
        Workers --> Challenger["teamwork:challenger (Empirical Stress & Boundary Tester)"]
        TestWriter & Workers --> Auditor["teamwork:forensic-auditor (Binary Anti-Cheat Veto)"]
    end

    Auditor -- "🔴 INTEGRITY VIOLATION / REQUEST_CHANGES" --> Remediate["Remediation Loop (DEAD_ENDS.md -> worker_remediation)"]
    Remediate --> Auditor
    Auditor -- "🟢 CLEAN + All APPROVE" --> Victory["teamwork:victory-auditor (Final Sentinel Gate)"]
```

---

## Installation in Devin CLI & Devin Cloud

### Install Directly from GitHub
```bash
devin plugins install matheuslessing/team-work-plugin
```
*(Plugins installed from GitHub or added on the Devin Web Customize page automatically sync your `skills/`, `rules/`, `AGENTS.md`, and `hooks.json` across both Devin CLI and Devin Cloud).*

### Install from a Local Clone (Live Editing)
```bash
git clone https://github.com/matheuslessing/team-work-plugin.git
devin plugins install --local ./team-work-plugin
```

### Verify Installation
```bash
devin plugins list
devin plugins info teamwork
```

---

## Slash Commands (`skills/team-*`)

All skills are prefixed with `team-` so they group cleanly in the `/` autocomplete menu with descriptive tags:

| Command | Description |
| :--- | :--- |
| `/team-craft` | **`[Teamwork Prompt Crafting]`** Interactive 9-step prompt engineering interview (`prompt_draft.md` $\to$ `ORIGINAL_REQUEST.md`) with automatic delegation. |
| `/team-run` | **`[Teamwork Full Autonomous Pipeline]`** Launch the full Dual-Track multi-agent pipeline (`Sentinel -> Orchestrator -> Survey -> Dual-Track -> Gate -> Victory Audit`). |
| `/team-quick` | **`[Teamwork Quick Focused Team]`** Run a compact team (`1 Worker + Adversarial Reviewer & Forensic Auditor loop`) for self-contained bug fixes or features. |
| `/team-survey` | **`[Teamwork Phase 0 Survey]`** Dispatch parallel read-only `teamwork:explorer` subagents to map architecture and generate `PROJECT.md`. |
| `/team-test-track` | **`[Teamwork Track A QA]`** Launch `teamwork:test-writer` to build a 4-tier E2E test suite, CLI test runner, `TEST_INFRA.md`, and `TEST_READY.md`. |
| `/team-gate` | **`[Teamwork Verification Gate]`** Execute the full 3-agent Gate (`reviewer` + `challenger` + `forensic-auditor`) and record verdicts in `GATE_STATUS.md`. |
| `/team-audit` | **`[Teamwork Forensic Audit]`** Run a zero-tolerance Binary Forensic Integrity Audit (`🟢 CLEAN` vs `🔴 INTEGRITY VIOLATION`) to catch mock tests, tautologies, and facades. |
| `/team-status` | **`[Teamwork Mission Dashboard]`** Show live status of `.agents/teamwork/`, including active subagents, milestone progress, and Gate verdicts. |
| `/team-cloud-workflow` | **`[Teamwork Devin Cloud 100%]`** Run the deterministic Devin Dynamic Workflow (`workflow.py`) or Managed Devins in Devin Cloud with parallel VMs, reactive P2P wakeup, and cron schedules. |

---

## Custom Subagent Profiles (`agents/`)

| Profile | Role & Capabilities | Nesting | Write Scope |
| :--- | :--- | :---: | :--- |
| `teamwork:sentinel` | Root supervisor; manages `ORIGINAL_REQUEST.md` and enforces the mandatory Victory Audit. | `max-nesting: 3` | `.agents/teamwork/sentinel/` |
| `teamwork:orchestrator` | Dispatch-only coordinator; authors `PROJECT.md`, `GATE_STATUS.md`, `DEAD_ENDS.md`. Never edits production code. | `max-nesting: 2` | `.agents/teamwork/orchestrator_1/` |
| `teamwork:explorer` | Read-only codebase surveyor and root-cause investigator. | Leaf | `.agents/teamwork/<explorer_id>/` |
| `teamwork:test-writer` | Track A QA engineer; builds 4-tier opaque-box E2E tests and CLI test runners. | Leaf | `Tests/`, `TEST_INFRA.md`, `TEST_READY.md` |
| `teamwork:worker` | Track B Milestone engineer; implements features within exclusive file write boundaries. | Leaf | Owned milestone files in `BRIEFING.md` |
| `teamwork:reviewer` | Adversarial code and requirements critic (`APPROVE` vs `REQUEST_CHANGES`). | Leaf | `.agents/teamwork/<reviewer_id>/` |
| `teamwork:challenger` | Empirical stress and boundary tester (`APPROVE` vs `REQUEST_CHANGES`). | Leaf | `.agents/teamwork/<challenger_id>/` |
| `teamwork:forensic-auditor` | Binary integrity auditor (`🟢 CLEAN` vs `🔴 INTEGRITY VIOLATION`). Hunts for fake tests, mocks, and facades. | Leaf | `.agents/teamwork/<auditor_id>/` |
| `teamwork:victory-auditor` | Final independent pre-delivery auditor spawned by Sentinel before reporting completion. | Leaf | `.agents/teamwork/victory_auditor/` |

---

## Automatic Runtime Detection & 30-Minute Orchestrator VM Watchdog (`watch_dog`)

You never have to remind Devin Cloud that it can use `workflow.py` or Managed Devins, and the primary Orchestrator VM is protected against 30-minute inactivity drops:
1. **30-Minute Orchestrator VM Watchdog (`watch_dog`)**:
   - In **Devin Cloud**, when the primary Orchestrator VM waits for parallel child sessions (`devin_session_gather` or long-running VMs), it can be suspended if idle for 30 minutes.
   - To prevent this, Teamwork automatically starts a **3-layer `watch_dog`** configured for a **30-minute protection window** (pulsing every **10 minutes** — 3x per 30-minute window):
     - **Layer A (OS/VM Background Daemon)**: `teamwork-cli.mjs init`, `detect-env`, and `hooks.json` (`UserPromptSubmit`) automatically spawn a detached background daemon (`node scripts/teamwork-cli.mjs watchdog start --window-min 30 --interval-min 10`) that writes heartbeats to `.agents/teamwork/watchdog.log` and `.agents/teamwork/orchestrator_1/progress.md` and executes lightweight git/OS checks so the hypervisor sees continuous activity. Automatically stops when `sentinel/handoff.md` + `Gate Result: PASS` complete.
     - **Layer B (`workflow.py` Async Task)**: `orchestrator_vm_watchdog()` runs concurrently inside `.agents/teamwork/workflow.py` (`WATCHDOG_WINDOW_MINUTES = 30`, `WATCHDOG_PULSE_SECONDS = 600`) across all `parallel()` and `agent()` calls.
     - **Layer C (Session Cron Schedule)**: `devin_schedule_manage` (`*/20 * * * *`) wakes the parent Orchestrator session inside the 30-minute window while awaiting child sessions.
2. **`UserPromptSubmit` Hook (`hooks.json`)**: On every prompt, detects `DEVIN_CLOUD` vs `DEVIN_CLI_LOCAL`, ensures the 30-minute `watch_dog` is running in Cloud, and injects the active runtime directive directly into the model's context.
3. **Always-On Rule (`rules/runtime-detection.md`)**: Loaded into the system prompt of every session, instructing Devin Cloud to prioritize `.agents/teamwork/workflow.py` (`--mode full|quick|survey|gate`) and automatically fall back to **Managed Devins** (`devin_session_create` + `devin_session_gather` + `devin_schedule_manage`).
4. **CLI Detector & Watchdog Controller (`scripts/teamwork-cli.mjs`)**: Supports automatic detection, manual pinning (`--env cloud|local`), and direct `watchdog` control, displaying active status in `/team-status`.

---

## Lifecycle Hooks & CLI Utility

- **`UserPromptSubmit` Hook (`hooks.json`)**: Automatically detects `DEVIN_CLOUD` vs `DEVIN_CLI_LOCAL`, auto-starts the 30-minute `watch_dog` daemon in Cloud, and injects orchestration instructions.
- **`PostCompaction` Hook (`hooks.json`)**: Automatically re-injects `RUNTIME_ENV.md`, `ORIGINAL_REQUEST.md`, `BRIEFING.md`, `PROJECT.md`, and `GATE_STATUS.md` into the agent's context whenever context compaction occurs.
- **`Stop` Hook (`hooks.json`)**: Warns if an orchestrator attempts to stop while `GATE_STATUS.md` still reports `FAIL` on an in-progress mission.
- **`scripts/teamwork-cli.mjs`**: Zero-dependency Node.js helper for runtime auto-detection, 30-minute `watch_dog` daemon management, `.agents/teamwork/workflow.py` provisioning, workspace initialization, isolated git worktree creation, 5-Component `handoff.md` validation, static forensic integrity scanning, and status reporting:
  ```bash
  node scripts/teamwork-cli.mjs detect-env [--env cloud|local]
  node scripts/teamwork-cli.mjs init [--env cloud|local]
  node scripts/teamwork-cli.mjs watchdog <start|stop|status|pulse> [--window-min 30] [--interval-min 10]
  node scripts/teamwork-cli.mjs spawn worker_m1 implementer --milestone M1 --worktree
  node scripts/teamwork-cli.mjs validate-handoff .agents/teamwork/worker_m1/handoff.md
  node scripts/teamwork-cli.mjs scan-integrity
  node scripts/teamwork-cli.mjs check-gate
  node scripts/teamwork-cli.mjs status
  ```

---

## License

MIT
