"""
Teamwork Deterministic Dynamic Workflows for Devin Cloud (v2 Optimized)
Includes:
- Tier-Aware VM Sizing (Lite, Fusion, Frontier) based on agent responsibility
- Smart Gate Short-Circuiting to eliminate Phase 2 repetitive loops
- Built-in 30-Minute Orchestrator VM Watchdog (`watch_dog`)
- Autonomous SkillOpt & Harness² Self-Evolution for broken skills/blueprints

Supports 4 workflow modes via `--mode <full|quick|survey|gate>` or `TEAMWORK_WORKFLOW_MODE`:
  - `full`   (/team-run, /team-craft): Phase 0 Survey -> Phase 1 Dual-Track -> Phase 2 Smart Gate -> Phase 3 Remediation -> Phase 4 Victory Audit
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

# Tier-Aware Subagent Model Routing for Devin Cloud
SUBAGENT_MODEL_TIERS = {
    # Lightweight, fast exploration & syntax checks (Lite / low compute)
    "explorer": {"model": "lite", "effort": "low"},
    
    # Execution & code writing: Fusion mode (Frontier lead planner + fast sidekick worker)
    "worker": {"model": "fusion", "effort": "medium"},
    "test_writer": {"model": "fusion", "effort": "medium"},
    "remediation": {"model": "fusion", "effort": "high"},
    
    # Critical adversarial & forensic audits: Frontier reasoning
    "reviewer": {"model": "frontier", "effort": "medium"},
    "challenger": {"model": "frontier", "effort": "high"},
    "forensic_auditor": {"model": "frontier", "effort": "high"},
    "victory_auditor": {"model": "frontier", "effort": "high"},
    
    # Text-space skill optimizer & self-healer
    "skill_optimizer": {"model": "frontier", "effort": "medium"},
}

WORKFLOW_MODES = {
    "full": {
        "name": "teamwork-full-pipeline",
        "description": "Autonomous Teamwork Dual-Track pipeline with Tier-Aware VMs (Lite/Fusion/Frontier), Smart Gate short-circuiting, and Harness2/SkillOpt self-evolution",
        "phases": [
            {"title": "survey", "detail": "Phase 0: Parallel Lite Explorer survey and PROJECT.md contract synthesis"},
            {"title": "dual_track", "detail": "Phase 1: Parallel Fusion Dual-Track E2E Test Writer + Milestone Workers"},
            {"title": "gate_verification", "detail": "Phase 2: Parallel Adversarial Reviewer, Challenger, and Forensic Auditor"},
            {"title": "self_evolution", "detail": "Phase 2.5: Autonomous Harness2 and SkillOpt self-healing if skills/environment fail"},
            {"title": "remediation", "detail": "Phase 3: Targeted Remediation Worker loop (if Gate flags defects)"},
            {"title": "victory_audit", "detail": "Phase 4: Independent Pre-Delivery Victory Audit"},
        ],
    },
    "quick": {
        "name": "teamwork-quick-team",
        "description": "Fast 1-Worker + Parallel Reviewer/Forensic Auditor verification",
        "phases": [
            {"title": "implementation", "detail": "Fusion Worker implementation"},
            {"title": "gate_verification", "detail": "Parallel Reviewer + Binary Forensic Auditor gate"},
            {"title": "remediation", "detail": "Remediation loop if needed"},
        ],
    },
    "survey": {
        "name": "teamwork-survey-only",
        "description": "Fast parallel codebase survey with Lite Explorers to synthesize PROJECT.md",
        "phases": [
            {"title": "survey", "detail": "Parallel Lite Explorers mapping architecture, domain logic, data models"},
        ],
    },
    "gate": {
        "name": "teamwork-verification-gate-only",
        "description": "Standalone Phase 2 parallel Verification Gate",
        "phases": [
            {"title": "gate_verification", "detail": "Parallel Reviewer + Challenger + Forensic Auditor verification"},
        ],
    },
}

SURVEY_SCHEMA = {
    "type": "object",
    "properties": {
        "lens": {"type": "string"},
        "summary": {"type": "string"},
        "entry_points": {"type": "array", "items": {"type": "string"}},
        "key_files": {"type": "array", "items": {"type": "string"}},
        "gotchas": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["lens", "summary", "key_files"],
}

PROJECT_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "architecture_summary": {"type": "string"},
        "feature_inventory": {"type": "array", "items": {"type": "string"}},
        "milestones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "scope": {"type": "string"},
                    "owned_files": {"type": "array", "items": {"type": "string"}},
                    "acceptance_criteria": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["id", "scope", "owned_files", "acceptance_criteria"],
            },
        },
    },
    "required": ["architecture_summary", "feature_inventory", "milestones"],
}

WORKER_HANDOFF_SCHEMA = {
    "type": "object",
    "properties": {
        "milestone_id": {"type": "string"},
        "observation": {"type": "string"},
        "logic_chain": {"type": "string"},
        "caveats": {"type": "string"},
        "conclusion": {"type": "string"},
        "verification_method": {"type": "string"},
        "files_modified": {"type": "array", "items": {"type": "string"}},
        "tests_passed": {"type": "boolean"},
    },
    "required": ["milestone_id", "observation", "logic_chain", "conclusion", "verification_method", "files_modified", "tests_passed"],
}

REMEDIATION_ROUTER_SCHEMA = {
    "type": "object",
    "properties": {
        "engine": {"type": "string", "enum": ["CODE_ONLY", "HARNESS", "SKILLOPT", "HARNESS_PLUS_SKILLOPT"]},
        "reasoning": {"type": "string"},
        "target_file": {"type": "string"},
    },
    "required": ["engine", "reasoning"],
}


GATE_VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "agent": {"type": "string"},
        "verdict": {"type": "string", "enum": ["APPROVE", "REQUEST_CHANGES", "CLEAN", "INTEGRITY_VIOLATION"]},
        "summary": {"type": "string"},
        "defects": {"type": "array", "items": {"type": "string"}},
        "invalidation_conditions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["agent", "verdict", "summary", "defects"],
}


def resolve_mode() -> str:
    for idx, arg in enumerate(sys.argv):
        if arg == "--mode" and idx + 1 < len(sys.argv):
            m = sys.argv[idx + 1].lower()
            if m in WORKFLOW_MODES:
                return m
    env_m = os.environ.get("TEAMWORK_WORKFLOW_MODE", "").lower()
    if env_m in WORKFLOW_MODES:
        return env_m
    return "full"


def log(msg: str):
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(f"[{ts}] [teamwork-cloud] {msg}", flush=True)


async def orchestrator_vm_watchdog():
    """Keeps Orchestrator VM active during long parallel child session runs."""
    cycle = 0
    while True:
        try:
            await asyncio.sleep(WATCHDOG_PULSE_SECONDS)
            cycle += 1
            log(f"[WATCH_DOG PULSE #{cycle}] Primary Orchestrator VM keep-alive pulse (window: {WATCHDOG_WINDOW_MINUTES}m).")
            watchdog_log = os.path.join(".agents", "teamwork", "watchdog.log")
            os.makedirs(os.path.dirname(watchdog_log), exist_ok=True)
            with open(watchdog_log, "a", encoding="utf-8") as f:
                f.write(f"[{datetime.datetime.now(datetime.timezone.utc).isoformat()}] pulse #{cycle}\n")
        except asyncio.CancelledError:
            log("[WATCH_DOG STOPPED] Primary Orchestrator VM watchdog cleanly terminated.")
            break
        except Exception as e:
            log(f"[WATCH_DOG ERROR] {e}")


async def run_survey_explorer(idx: int, focus: str):
    cfg = SUBAGENT_MODEL_TIERS["explorer"]
    return await agent(
        f"You are Teamwork Codebase Surveyor `explorer_survey_{idx}`.\n"
        f"Lens: {focus}\n"
        "Explore the repository using read-only tools. Identify entry points, contracts, and key files.\n"
        "Write 5-Component `handoff.md` and return structured survey.",
        phase="survey",
        schema=SURVEY_SCHEMA,
        label=f"explorer-survey-{idx}",
        model=cfg["model"],
    )


async def synthesize_project_md(surveys):
    cfg = SUBAGENT_MODEL_TIERS["worker"]
    surveys_summary = json.dumps(surveys, indent=2, sort_keys=True)
    return await agent(
        "You are Teamwork Orchestrator synthesizing the Phase 0 Survey into `.agents/teamwork/orchestrator_1/PROJECT.md`.\n"
        "Define Global Architecture, 100% Feature Inventory, Milestones with non-overlapping write boundaries, and Interface Contracts.\n"
        f"Surveys:\n{surveys_summary}",
        phase="survey",
        schema=PROJECT_PLAN_SCHEMA,
        label="orchestrator-survey-synthesis",
        model=cfg["model"],
    )


async def run_test_writer():
    cfg = SUBAGENT_MODEL_TIERS["test_writer"]
    return await agent(
        "You are Track A QA Engineer `teamwork:test-writer`.\n"
        "Read `.agents/teamwork/orchestrator_1/PROJECT.md` and build an independent 4-tier E2E test suite.\n"
        "NEVER touch production implementation files. Write `TEST_INFRA.md` and `TEST_READY.md`.",
        phase="dual_track",
        schema=WORKER_HANDOFF_SCHEMA,
        label="test-writer-track-a",
        model=cfg["model"],
    )


async def route_remediation_strategy(defects):
    """
    Fast Triage Agent (Lite model): Decides instantaneously whether defects require:
    - CODE_ONLY: Normal implementation bug fix (Worker only)
    - HARNESS: Behavioral command contrast / execution discrepancy (harness-probe.py)
    - SKILLOPT: Flawed / obsolete instruction text in SKILL.md (skillopt-engine.py)
    - HARNESS_PLUS_SKILLOPT: Complex tool/environment breakdown requiring both
    """
    defects_str = json.dumps(defects, sort_keys=True)
    return await agent(
        "You are Remediation Router `teamwork:remediation-router`.\n"
        "Analyze the reported defects and choose the exact minimal remediation engine:\n"
        f"Defects:\n{defects_str}\n\n"
        "- CODE_ONLY: Pure logic bug, missing implementation, or failing unit test in production code.\n"
        "- HARNESS: Terminal command failed with exit code, command not found, or API syntax discrepancy.\n"
        "- SKILLOPT: Instruction in a SKILL.md is obsolete, malformed, or recommending bad patterns.\n"
        "- HARNESS_PLUS_SKILLOPT: Command failed due to obsolete instruction in SKILL.md requiring behavioral probe then diff.\n",
        phase="remediation",
        schema=REMEDIATION_ROUTER_SCHEMA,
        label="remediation-router",
        model=SUBAGENT_MODEL_TIERS["explorer"]["model"],  # Fast Lite model
    )


async def run_skill_optimizer(defects):
    cfg = SUBAGENT_MODEL_TIERS["skill_optimizer"]
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
        model=cfg["model"],
    )


async def run_milestone_worker(milestone):
    cfg = SUBAGENT_MODEL_TIERS["worker"]
    m_id = milestone["id"]
    m_scope = milestone["scope"]
    m_files = json.dumps(milestone["owned_files"], sort_keys=True)
    return await agent(
        f"You are Teamwork Milestone Worker `worker_{m_id}`.\n"
        f"Scope: {m_scope}\n"
        f"Own exclusively: {m_files}\n"
        "Implement genuine production logic adhering strictly to `.agents/teamwork/orchestrator_1/PROJECT.md — Interface Contracts`.\n"
        "Verify 0 compilation errors and write `.agents/teamwork/worker_" + m_id + "/handoff.md` (5-Component format).",
        phase="dual_track",
        schema=WORKER_HANDOFF_SCHEMA,
        label=f"worker-{m_id}",
        model=cfg["model"],
    )


async def run_gate(iteration: int, include_challenger: bool = True):
    """
    Phase 2: Two-Stage Short-Circuiting Verification Gate.
    Stage 2A (Functional & Empirical): Reviewer and Challenger run in parallel first.
    If either requests changes, Phase 2 fails IMMEDIATELY without wasting VM compute on Forensic Auditor.
    Stage 2B (Forensic Integrity): Runs ONLY after Reviewer and Challenger both APPROVE.
    """
    rev_cfg = SUBAGENT_MODEL_TIERS["reviewer"]
    aud_cfg = SUBAGENT_MODEL_TIERS["forensic_auditor"]
    cha_cfg = SUBAGENT_MODEL_TIERS["challenger"]

    reviewer_call = lambda: agent(
        f"You are Teamwork Adversarial Reviewer `reviewer_{iteration}` (READ-ONLY on project source).\n"
        "Inspect all modified files against `.agents/teamwork/ORIGINAL_REQUEST.md` and `PROJECT.md`.\n"
        f"Write `.agents/teamwork/reviewer_{iteration}/handoff.md` and output verdict `APPROVE` or `REQUEST_CHANGES`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"reviewer-iter-{iteration}",
        model=rev_cfg["model"],
    )

    stage_2a_calls = [reviewer_call]
    if include_challenger:
        challenger_call = lambda: agent(
            f"You are Teamwork Empirical Challenger `challenger_{iteration}` (READ-ONLY on project source).\n"
            "Empirically stress-test boundary conditions, rapid state transitions, and edge cases.\n"
            f"Write `.agents/teamwork/challenger_{iteration}/handoff.md` and output verdict `APPROVE` or `REQUEST_CHANGES`.",
            phase="gate_verification",
            schema=GATE_VERDICT_SCHEMA,
            label=f"challenger-iter-{iteration}",
            model=cha_cfg["model"],
        )
        stage_2a_calls.append(challenger_call)

    # Step 1: Run Stage 2A in parallel (Reviewer + Challenger)
    log(f"Phase 2A: Launching Reviewer {'+ Challenger' if include_challenger else ''} in parallel...")
    stage_2a_verdicts = await parallel(stage_2a_calls)

    # Check for early failure
    stage_2a_failed = any(v["verdict"] == "REQUEST_CHANGES" for v in stage_2a_verdicts)
    if stage_2a_failed:
        log(f"Phase 2A REJECTED by Reviewer/Challenger. Short-circuiting: Skipping Forensic Auditor to save VM time.")
        return stage_2a_verdicts

    # Step 2: Run Stage 2B only if Stage 2A passed (Forensic Auditor final veto)
    log(f"Phase 2A PASSED (All APPROVE). Launching Stage 2B: Forensic Integrity Auditor...")
    auditor_verdict = await agent(
        f"You are Teamwork Forensic Integrity Auditor `auditor_{iteration}` (Binary Veto: `CLEAN` vs `INTEGRITY_VIOLATION`).\n"
        "Reviewer and Challenger already APPROVED the functional requirements.\n"
        "Audit all production files, test suites, and test runners. Flag any self-certifying test tautologies, local mock lambdas, "
        "facade test runners, or production stubs.\n"
        f"Write `.agents/teamwork/auditor_{iteration}/audit_report.md` and `handoff.md`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"forensic-auditor-iter-{iteration}",
        model=aud_cfg["model"],
    )

    return stage_2a_verdicts + [auditor_verdict]


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
    cfg = SUBAGENT_MODEL_TIERS["worker"]
    await agent(
        "You are Teamwork Quick Worker `worker_quick_1`.\n"
        "Read `.agents/teamwork/ORIGINAL_REQUEST.md`, implement the required fix/feature with genuine production logic "
        "and real unit/E2E tests, verify 0 compilation errors, and write `.agents/teamwork/worker_quick_1/handoff.md` (5-Component format).",
        phase="implementation",
        schema=WORKER_HANDOFF_SCHEMA,
        label="worker-quick-1",
        model=cfg["model"],
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
        rem_cfg = SUBAGENT_MODEL_TIERS["remediation"]
        await agent(
            f"You are Teamwork Remediation Worker `worker_quick_remediation_{iteration}`.\n"
            f"Fix all defects reported by Reviewer and Forensic Auditor:\n{defects_json}\n"
            "Write 5-Component `handoff.md` and verify 100% test pass rate.",
            phase="remediation",
            schema=WORKER_HANDOFF_SCHEMA,
            label=f"worker-quick-remediation-{iteration}",
            model=rem_cfg["model"],
        )


async def execute_full_workflow():
    plan = await execute_survey_workflow()

    track_tasks = [run_test_writer] + [
        (lambda m=m: run_milestone_worker(m)) for m in plan["milestones"]
    ]
    # Phase 1: Dual-track fully parallel
    await parallel(track_tasks)
    log("Phase 1 Dual-Track complete. Entering Phase 2 Verification Gate.")

    # Phase 2: Smart Gate loop with short-circuiting
    seen_defect_signatures = set()
    for iteration in range(1, 4):
        # All 3 Gate agents run in parallel
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

        # Anti-Loop Short-Circuit: Detect repetitive identical defects
        defect_sig = tuple(sorted(all_defects))
        if defect_sig in seen_defect_signatures:
            log(f"[SMART GATE SHORT-CIRCUIT] Identical defects detected across iterations. Escalating directly to Skill Optimizer and targeted architectural fix to prevent infinite looping.")
            await run_skill_optimizer(all_defects)
        seen_defect_signatures.add(defect_sig)

        log(f"Gate Iteration {iteration} FAILED with {len(all_defects)} defects. Routing optimal remediation...")
        
        # Fast Decision Agent (Lite VM) instantly selects the minimal path
        route = await route_remediation_strategy(all_defects)
        engine_choice = route.get("engine", "CODE_ONLY")
        log(f"[REMEDIATION ROUTER] Strategy chosen: {engine_choice} | Reasoning: {route.get('reasoning')}")

        if engine_choice in ("HARNESS", "SKILLOPT", "HARNESS_PLUS_SKILLOPT"):
            log(f"Executing focused self-evolution ({engine_choice}) before code remediation...")
            await run_skill_optimizer(all_defects)

        # Targeted Worker runs focused only on what needs fixing
        defects_json = json.dumps(all_defects, sort_keys=True)
        rem_cfg = SUBAGENT_MODEL_TIERS["remediation"]
        await agent(
            f"You are Teamwork Remediation Worker `worker_remediation_{iteration}`.\n"
            f"Strategy: {engine_choice}\n"
            f"Defects to resolve:\n{defects_json}\n"
            "Apply targeted, minimal fixes without touching unaffected code. Verify 0 compilation errors.",
            phase="remediation",
            schema=WORKER_HANDOFF_SCHEMA,
            label=f"worker-remediation-{iteration}",
            model=rem_cfg["model"],
        )

    vic_cfg = SUBAGENT_MODEL_TIERS["victory_auditor"]
    victory = await agent(
        "You are Teamwork `victory_auditor` spawned by Sentinel.\n"
        "Independently verify every checkbox in `.agents/teamwork/ORIGINAL_REQUEST.md`, verify `GATE_STATUS.md`, "
        "and run the live E2E test runner to confirm 100% pass rate.\n"
        "Write `.agents/teamwork/victory_auditor/handoff.md` and `.agents/teamwork/sentinel/handoff.md`.",
        phase="victory_audit",
        schema=GATE_VERDICT_SCHEMA,
        label="victory-auditor",
        model=vic_cfg["model"],
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
            "subagent_model_tiers": SUBAGENT_MODEL_TIERS,
        }))
        sys.exit(0)
    asyncio.run(main())
