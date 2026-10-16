---
description: Always-on automatic runtime detection (Devin Cloud vs. Devin CLI Local) so Devin Cloud automatically uses Dynamic Workflows (workflow.py) or Managed Devins without waiting for user reminders.
---

# Mandatory Automatic Runtime Detection (`DEVIN_CLOUD` vs `DEVIN_CLI_LOCAL`)

You MUST automatically detect whether you are running in **Devin Cloud** or **Devin CLI Local** at the start of any `/team-*` command or multi-agent Teamwork task. **NEVER wait for the user to remind you that you can use `workflow.py` or Managed Devins in Devin Cloud.**

## 1. How to Identify Your Runtime Immediately

Check these signals (or run `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" detect-env --workdir .`):

- **You are in `DEVIN_CLOUD` if ANY of the following is true**:
  1. `.agents/teamwork/RUNTIME_ENV.json` has `"runtime": "DEVIN_CLOUD"`, or `TEAMWORK_RUNTIME=cloud`.
  2. Any Devin Cloud environment variable is set (`DEVIN_CLOUD`, `DEVIN_SESSION_ID`, `DEVIN_VM`, `DEVIN_ORG_ID`, `DEVIN_WORKFLOW`).
  3. You are running on a Linux Cloud VM (`/home/ubuntu` exists or `USER=ubuntu` / `USER=devin`).
  4. Python `import devin` (Dynamic Workflow SDK) is available, OR `devin_session_create` / `devin_session_gather` (Managed Devins MCP tools) are available in your toolset.

- **You are in `DEVIN_CLI_LOCAL` if**:
  - You are on a local developer machine (Windows `win32`, macOS `darwin`, or local Linux desktop without Cloud VM markers) or ` --env local` / `TEAMWORK_RUNTIME=local` is set.

---

## 2. Automatic Execution Strategy When in `DEVIN_CLOUD`

When `DEVIN_CLOUD` is detected, **automatically** execute multi-agent Teamwork tasks in this exact priority order without asking the user:

1. **Primary Engine — Devin Dynamic Workflow (`.agents/teamwork/workflow.py`)**:
   - `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" init` (or `detect-env`) automatically provisions `.agents/teamwork/workflow.py`.
   - Select the mode matching the user's command:
     - `/team-run` or `/team-craft` (on approval) $\to$ `--mode full` (`teamwork-full-pipeline`)
     - `/team-quick` $\to$ `--mode quick` (`teamwork-quick-pipeline`)
     - `/team-survey` $\to$ `--mode survey` (`teamwork-survey-pipeline`)
     - `/team-gate` or `/team-audit` $\to$ `--mode gate` (`teamwork-gate-pipeline`)
   - Copy `.agents/teamwork/workflow.py` to `./workflow.py` at the repository root ONLY if the active Dynamic Workflow runner requires root placement.
2. **Automatic Fallback Engine — Managed Devins (`devin_session_create`)**:
   - If the Dynamic Workflow runner (`register_workflow` / `agent` / `parallel`) is not active in the current session, **immediately and automatically fall back** to **Managed Devins / Devin MCP**:
     - Use `devin_session_create` to spawn parallel child Devin sessions for Explorers, `test_writer_1`, `worker_m1..mN`, `reviewer`, `challenger`, `forensic_auditor`, and `victory_auditor`.
     - Use `devin_session_interact` for live P2P follow-up messages and `devin_session_gather` for reactive wakeup when child sessions complete.
     - Use `devin_schedule_manage` (`*/8 * * * *`) to maintain liveness heartbeats during long runs.

---

## 3. Automatic Execution Strategy When in `DEVIN_CLI_LOCAL`

When `DEVIN_CLI_LOCAL` is detected:
1. **Primary Engine — Custom CLI Subagent Profiles (`agents/*.md`)**:
   - Dispatch subagents using `teamwork:sentinel`, `teamwork:orchestrator`, `teamwork:explorer`, `teamwork:test-writer`, `teamwork:worker`, `teamwork:reviewer`, `teamwork:challenger`, `teamwork:forensic-auditor`, and `teamwork:victory-auditor`.
2. **Companion Isolation — Local Git Worktrees**:
   - Use `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" spawn <agent_id> <archetype> --milestone <M> --worktree` when isolated git branches (`teamwork/<agent_id>`) are needed.
