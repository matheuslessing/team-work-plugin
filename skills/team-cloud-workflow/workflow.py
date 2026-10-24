"""
Teamwork Deterministic Dynamic Workflows for Devin Cloud
Includes built-in 30-Minute Orchestrator VM Watchdog (`watch_dog`) to prevent the primary
Orchestrator VM from dropping due to idle timeouts while waiting for parallel child sessions.

Supports 4 workflow modes via `--mode <full|quick|survey|gate>` or `TEAMWORK_WORKFLOW_MODE`:
  - `full`   (/team-run, /team-craft): Phase 0 Survey -> Phase 1 Dual-Track -> Phase 2 Gate -> Phase 3 Remediation -> Phase 4 Victory Audit
  - `quick`  (/team-quick): 1 Worker -> Parallel Adversarial Reviewer + Binary Forensic Auditor loop
  - `survey` (/team-survey): Parallel Read-Only Explorers -> PROJECT.md synthesis
  - `gate`   (/team-gate, /team-audit): Parallel Adversarial Reviewer + Empirical Challenger + Binary Forensic Auditor -> GATE_STATUS.md
"""

import asyncio
import datetime
import json
import os
import subprocess
import sys

# 30-Minute Orchestrator VM Watchdog Configuration
WATCHDOG_WINDOW_MINUTES = 30
WATCHDOG_PULSE_SECONDS = 600  # Pulses every 10 min (3x per 30-min idle window)

WORKFLOW_MODES = {
    "full": {
        "name": "teamwork-full-pipeline",
        "description": "Autonomous Teamwork Dual-Track pipeline with 30m VM watch_dog, 4-tier E2E testing, adversarial challenge, and binary forensic integrity audit",
        "phases": [
            {"title": "survey", "detail": "Phase 0: Parallel Explorer survey and PROJECT.md contract synthesis"},
            {"title": "dual_track", "detail": "Phase 1: Parallel E2E Test Track (Tiers 1-4) and Milestone Workers"},
            {"title": "gate_verification", "detail": "Phase 2: Adversarial Review, Empirical Challenge, and Forensic Integrity Audit"},
            {"title": "remediation", "detail": "Phase 3: Automated defect and test-authenticity remediation loop"},
            {"title": "victory_audit", "detail": "Phase 4: Final independent Sentinel Victory Audit"},
        ],
    },
    "quick": {
        "name": "teamwork-quick-pipeline",
        "description": "Compact Teamwork loop with 30m VM watch_dog: 1 Worker + Parallel Adversarial Reviewer & Binary Forensic Auditor",
        "phases": [
            {"title": "implementation", "detail": "Step 1: Focused Worker implementation with genuine tests"},
            {"title": "gate_verification", "detail": "Step 2: Parallel Adversarial Reviewer and Binary Forensic Auditor"},
            {"title": "remediation", "detail": "Step 3: Automated remediation loop until APPROVE + CLEAN"},
        ],
    },
    "survey": {
        "name": "teamwork-survey-pipeline",
        "description": "Phase 0 Parallel Read-Only Explorer codebase survey and PROJECT.md synthesis",
        "phases": [
            {"title": "survey", "detail": "Parallel Explorer survey and PROJECT.md contract synthesis"},
        ],
    },
    "gate": {
        "name": "teamwork-gate-pipeline",
        "description": "3-Agent Teamwork Verification Gate (Adversarial Reviewer + Empirical Challenger + Binary Forensic Auditor)",
        "phases": [
            {"title": "gate_verification", "detail": "Parallel Adversarial Review, Empirical Challenge, and Forensic Integrity Audit"},
        ],
    },
}

SURVEY_SCHEMA = {
    "type": "object",
    "properties": {
        "domain": {"type": "string"},
        "root_causes": {"type": "array", "items": {"type": "string"}},
        "interface_contracts": {"type": "array", "items": {"type": "string"}},
        "owned_files": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["domain", "root_causes", "interface_contracts", "owned_files"],
}

PROJECT_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "project_md_written": {"type": "boolean"},
        "milestones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "scope": {"type": "string"},
                    "owned_files": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["id", "scope", "owned_files"],
            },
        },
    },
    "required": ["project_md_written", "milestones"],
}

WORKER_HANDOFF_SCHEMA = {
    "type": "object",
    "properties": {
        "agent_id": {"type": "string"},
        "handoff_path": {"type": "string"},
        "compile_errors": {"type": "integer"},
        "summary": {"type": "string"},
    },
    "required": ["agent_id", "handoff_path", "compile_errors", "summary"],
}

GATE_VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "agent_id": {"type": "string"},
        "verdict": {"type": "string", "enum": ["APPROVE", "REQUEST_CHANGES", "CLEAN", "INTEGRITY_VIOLATION"]},
        "defects": {"type": "array", "items": {"type": "string"}},
        "handoff_path": {"type": "string"},
    },
    "required": ["agent_id", "verdict", "defects", "handoff_path"],
}


def resolve_mode() -> str:
    if "--mode" in sys.argv:
        idx = sys.argv.index("--mode")
        if idx + 1 < len(sys.argv) and sys.argv[idx + 1] in WORKFLOW_MODES:
            return sys.argv[idx + 1]
    env_mode = os.environ.get("TEAMWORK_WORKFLOW_MODE", "full").strip().lower()
    return env_mode if env_mode in WORKFLOW_MODES else "full"


async def orchestrator_vm_watchdog():
    """
    Background 30-minute watch_dog loop running inside the primary Orchestrator VM.
    Emits a disk + process + workflow log heartbeat every 10 minutes (3x per 30m window)
    so the primary Orchestrator VM never gets suspended for inactivity while awaiting child VMs.
    """
    teamwork_dir = os.path.join(os.getcwd(), ".agents", "teamwork")
    os.makedirs(teamwork_dir, exist_ok=True)
    watchdog_log = os.path.join(teamwork_dir, "watchdog.log")
    progress_md = os.path.join(teamwork_dir, "orchestrator_1", "progress.md")
    pulse_count = 0

    while True:
        await asyncio.sleep(WATCHDOG_PULSE_SECONDS)
        pulse_count += 1
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            subprocess.run(["git", "status", "--short"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        except Exception:
            pass

        entry = (
            f"[{now_iso}] [WATCH_DOG {WATCHDOG_WINDOW_MINUTES}m KEEP-ALIVE] "
            f"Primary Orchestrator VM active (pulse #{pulse_count}, interval={WATCHDOG_PULSE_SECONDS}s)\n"
        )
        try:
            with open(watchdog_log, "a", encoding="utf-8") as f:
                f.write(entry)
            if os.path.exists(progress_md):
                with open(progress_md, "a", encoding="utf-8") as pf:
                    pf.write(f"- {entry}")
        except Exception:
            pass

        if "log" in globals():
            log(f"[WATCH_DOG 30m KEEP-ALIVE] Orchestrator VM active (pulse #{pulse_count})")


async def run_survey_explorer(idx: int, focus: str):
    return await agent(
        f"You are Teamwork Explorer `explorer_survey_{idx}` (strictly READ-ONLY outside `.agents/teamwork/explorer_survey_{idx}/`).\n"
        f"Read `.agents/teamwork/ORIGINAL_REQUEST.md` and survey the codebase for: {focus}.\n"
        f"Write `.agents/teamwork/explorer_survey_{idx}/BRIEFING.md`, `analysis.md`, and 5-Component `handoff.md`.\n"
        "Return exact root causes, proposed interface contracts, and file boundaries.",
        phase="survey",
        schema=SURVEY_SCHEMA,
        label=f"explorer-survey-{idx}",
    )


async def synthesize_project_md(surveys):
    survey_json = json.dumps(surveys, sort_keys=True)
    return await agent(
        "You are the Teamwork Orchestrator (`orchestrator_1`).\n"
        "Synthesize the Explorer survey results below and `.agents/teamwork/ORIGINAL_REQUEST.md` into "
        "`.agents/teamwork/orchestrator_1/PROJECT.md` (Architecture, 100% Feature Inventory, Milestones, "
        "Interface Contracts, and non-overlapping file write boundaries).\n"
        f"Survey data:\n{survey_json}",
        phase="survey",
        schema=PROJECT_PLAN_SCHEMA,
        label="synthesize-project-md",
    )


async def run_test_writer():
    return await agent(
        "You are Teamwork `test_writer_1` (Track A: E2E Testing Track).\n"
        "Read `.agents/teamwork/ORIGINAL_REQUEST.md` and `.agents/teamwork/orchestrator_1/PROJECT.md`.\n"
        "Own exclusively: `TEST_INFRA.md`, `TEST_READY.md`, test suite directory, and test runner scripts.\n"
        "Implement the 4-Tier E2E test suite (Tier 1 Feature >=5, Tier 2 Boundary >=5, Tier 3 Combinatorial, Tier 4 Scenarios) "
        "bound directly to real production classes (ZERO local mock tautologies, ZERO facade runners).\n"
        "Write `.agents/teamwork/test_writer_1/handoff.md` (5-Component format).",
        phase="dual_track",
        schema=WORKER_HANDOFF_SCHEMA,
        label="test-writer-1",
    )


async def run_skill_optimizer(defects):
    return await agent(
        "You are Teamwork Skill Optimizer `teamwork:skill-optimizer`.\n"
        "A Gate verification failure or command error was detected:\n" + json.dumps(defects, sort_keys=True) + "\n"
        "1. Run `python scripts/harness-probe.py` to extract behavioral contrast (failed vs working command).\n"
        "2. Run `python scripts/skillopt-engine.py propose` with bounded diffs and check validation gate.\n"
        "3. Run `python scripts/skillopt-engine.py adopt` to atomically update the defective skill in `skills/`.\n"
        "Write 5-Component handoff report in `.agents/teamwork/skill_optimizer/handoff.md`.",
        phase="self_evolution",
        schema=WORKER_HANDOFF_SCHEMA,
        label="skill-optimizer",
    )


async def run_milestone_worker(milestone):
    m_id = milestone["id"]
    m_scope = milestone["scope"]
    m_files = json.dumps(milestone["owned_files"], sort_keys=True)
    return await agent(
        f"You are Teamwork Milestone Worker `worker_{m_id}`.\n"
        f"Scope: {m_scope}\n"
        f"Own exclusively: {m_files}\n"
        "Implement genuine production logic adhering strictly to `.agents/teamwork/orchestrator_1/PROJECT.md § Interface Contracts`.\n"
        "Verify 0 compilation errors and write `.agents/teamwork/worker_" + m_id + "/handoff.md` (5-Component format).",
        phase="dual_track",
        schema=WORKER_HANDOFF_SCHEMA,
        label=f"worker-{m_id}",
    )


async def run_gate(iteration: int, include_challenger: bool = True):
    reviewer_call = lambda: agent(
        f"You are Teamwork Adversarial Reviewer `reviewer_{iteration}` (READ-ONLY on project source).\n"
        "Inspect all modified files against `.agents/teamwork/ORIGINAL_REQUEST.md` and `PROJECT.md`.\n"
        f"Write `.agents/teamwork/reviewer_{iteration}/handoff.md` and output verdict `APPROVE` or `REQUEST_CHANGES`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"reviewer-iter-{iteration}",
    )
    auditor_call = lambda: agent(
        f"You are Teamwork Forensic Integrity Auditor `auditor_{iteration}` (Binary Veto: `CLEAN` vs `INTEGRITY_VIOLATION`).\n"
        "Audit all production files, test suites, and test runners. Flag any self-certifying test tautologies, local mock lambdas, "
        "facade test runners, or production stubs.\n"
        f"Write `.agents/teamwork/auditor_{iteration}/audit_report.md` and `handoff.md`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"forensic-auditor-iter-{iteration}",
    )
    if not include_challenger:
        return await parallel([reviewer_call, auditor_call])

    challenger_call = lambda: agent(
        f"You are Teamwork Empirical Challenger `challenger_{iteration}` (READ-ONLY on project source).\n"
        "Empirically stress-test boundary conditions, rapid state transitions, and edge cases.\n"
        f"Write `.agents/teamwork/challenger_{iteration}/handoff.md` and output verdict `APPROVE` or `REQUEST_CHANGES`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"challenger-iter-{iteration}",
    )
    return await parallel([reviewer_call, challenger_call, auditor_call])


async def execute_survey_workflow():
    surveys = await parallel([
        lambda: run_survey_explorer(1, "Core architecture, input/entry points, and state management"),
        lambda: run_survey_explorer(2, "Domain logic, algorithms, external packages, and performance"),
        lambda: run_survey_explorer(3, "Data models, persistence, assets, and existing test infrastructure"),
    ])
    plan = await synthesize_project_md(surveys)
    log(f"Phase 0 complete: {len(plan['milestones'])} milestones synthesized in PROJECT.md")
    return plan


async def execute_quick_workflow():
    await agent(
        "You are Teamwork Quick Worker `worker_quick_1`.\n"
        "Read `.agents/teamwork/ORIGINAL_REQUEST.md`, implement the required fix/feature with genuine production logic "
        "and real unit/E2E tests, verify 0 compilation errors, and write `.agents/teamwork/worker_quick_1/handoff.md` (5-Component format).",
        phase="implementation",
        schema=WORKER_HANDOFF_SCHEMA,
        label="worker-quick-1",
    )
    for iteration in range(1, 4):
        verdicts = await run_gate(iteration, include_challenger=False)
        defects = []
        passed = True
        for v in verdicts:
            if v["verdict"] in ("REQUEST_CHANGES", "INTEGRITY_VIOLATION"):
                passed = False
                defects.extend(v["defects"])
        if passed:
            log(f"Quick Gate Iteration {iteration} PASSED (APPROVE + CLEAN)!")
            return verdicts
        defects_json = json.dumps(defects, sort_keys=True)
        await agent(
            f"You are Teamwork Remediation Worker `worker_quick_remediation_{iteration}`.\n"
            f"Fix all defects reported by Reviewer and Forensic Auditor:\n{defects_json}\n"
            "Write 5-Component `handoff.md` and verify 100% test pass rate.",
            phase="remediation",
            schema=WORKER_HANDOFF_SCHEMA,
            label=f"worker-quick-remediation-{iteration}",
        )


async def execute_full_workflow():
    plan = await execute_survey_workflow()

    track_tasks = [run_test_writer] + [
        (lambda m=m: run_milestone_worker(m)) for m in plan["milestones"]
    ]
    await parallel(track_tasks)
    log("Phase 1 Dual-Track complete. Entering Verification Gate.")

    for iteration in range(1, 4):
        verdicts = await run_gate(iteration, include_challenger=True)
        all_defects = []
        gate_passed = True
        for v in verdicts:
            if v["verdict"] in ("REQUEST_CHANGES", "INTEGRITY_VIOLATION"):
                gate_passed = False
                all_defects.extend(v["defects"])

        if gate_passed:
            log(f"Gate Iteration {iteration} PASSED (All APPROVE + Forensic Auditor CLEAN)!")
            break

        log(f"Gate Iteration {iteration} FAILED with {len(all_defects)} defects. Launching remediation worker.")
        if any("skill" in str(d).lower() or "command" in str(d).lower() for d in all_defects):
            await run_skill_optimizer(all_defects)
        defects_json = json.dumps(all_defects, sort_keys=True)
        await agent(
            f"You are Teamwork Remediation Worker `worker_remediation_{iteration}`.\n"
            "Log failed approaches in `.agents/teamwork/orchestrator_1/DEAD_ENDS.md`, update `GATE_STATUS.md`, "
            f"and fix every defect below with genuine production/test code:\n{defects_json}\n"
            "Run the full E2E test suite and verify 100% pass rate with 0 compilation errors.",
            phase="remediation",
            schema=WORKER_HANDOFF_SCHEMA,
            label=f"worker-remediation-{iteration}",
        )

    victory = await agent(
        "You are Teamwork `victory_auditor` spawned by Sentinel.\n"
        "Independently verify every checkbox in `.agents/teamwork/ORIGINAL_REQUEST.md`, verify `GATE_STATUS.md`, "
        "and run the live E2E test runner to confirm 100% pass rate.\n"
        "Write `.agents/teamwork/victory_auditor/handoff.md` and `.agents/teamwork/sentinel/handoff.md`.",
        phase="victory_audit",
        schema=GATE_VERDICT_SCHEMA,
        label="victory-auditor",
    )
    log(f"Victory Audit Verdict: {victory['verdict']}")


async def main():
    mode = resolve_mode()
    meta = WORKFLOW_MODES[mode]
    await register_workflow(meta)

    watchdog_task = asyncio.create_task(orchestrator_vm_watchdog())
    try:
        if mode == "survey":
            await execute_survey_workflow()
        elif mode == "quick":
            await execute_quick_workflow()
        elif mode == "gate":
            await run_gate(1, include_challenger=True)
        else:
            await execute_full_workflow()
    finally:
        watchdog_task.cancel()


if __name__ == "__main__":
    if "--check" in sys.argv:
        has_globals = "register_workflow" in globals()
        print(json.dumps({
            "workflow_file": os.path.abspath(__file__),
            "supported_modes": list(WORKFLOW_MODES.keys()),
            "selected_mode": resolve_mode(),
            "watchdog_window_minutes": WATCHDOG_WINDOW_MINUTES,
            "watchdog_pulse_seconds": WATCHDOG_PULSE_SECONDS,
            "runner_injected_globals": has_globals,
        }))
        sys.exit(0)
    asyncio.run(main())
