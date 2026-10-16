"""
Teamwork Deterministic Dynamic Workflow for Devin Cloud
Executes the full Dual-Track Teamwork Architecture:
  Phase 0: Parallel Codebase Survey (3 Explorers -> PROJECT.md synthesis)
  Phase 1: Parallel Dual-Track Execution (Track A: 4-Tier E2E Test Writer + Track B: Milestone Workers)
  Phase 2: Parallel Adversarial & Forensic Gate (Reviewer + Challenger + Forensic Auditor)
  Phase 3: Automated Remediation Loop (until Reviewer=APPROVE, Challenger=APPROVE, Auditor=CLEAN)
  Phase 4: Independent Victory Audit
"""

import asyncio
import json

META = {
    "name": "teamwork-dual-track-pipeline",
    "description": "Autonomous Teamwork Dual-Track pipeline with 4-tier E2E testing, adversarial challenge, and binary forensic integrity audit",
    "phases": [
        {"title": "survey", "detail": "Phase 0: Parallel Explorer survey and PROJECT.md contract synthesis"},
        {"title": "dual_track", "detail": "Phase 1: Parallel E2E Test Track (Tiers 1-4) and Milestone Workers"},
        {"title": "gate_verification", "detail": "Phase 2: Adversarial Review, Empirical Challenge, and Forensic Integrity Audit"},
        {"title": "remediation", "detail": "Phase 3: Automated defect and test-authenticity remediation loop"},
        {"title": "victory_audit", "detail": "Phase 4: Final independent Sentinel Victory Audit"},
    ],
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


async def run_survey_explorer(idx: int, focus: str):
    return await agent(
        f"You are Teamwork Explorer `explorer_survey_{idx}` ( strictly READ-ONLY outside `.agents/teamwork/explorer_survey_{idx}/`).\n"
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
        " Own exclusively: `TEST_INFRA.md`, `TEST_READY.md`, test suite directory, and test runner scripts.\n"
        "Implement the 4-Tier E2E test suite (Tier 1 Feature >=5, Tier 2 Boundary >=5, Tier 3 Combinatorial, Tier 4 Scenarios) "
        "bound directly to real production classes (ZERO local mock tautologies, ZERO facade runners).\n"
        "Write `.agents/teamwork/test_writer_1/handoff.md` (5-Component format).",
        phase="dual_track",
        schema=WORKER_HANDOFF_SCHEMA,
        label="test-writer-1",
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


async def run_gate(iteration: int):
    reviewer_call = agent(
        f"You are Teamwork Adversarial Reviewer `reviewer_{iteration}` (READ-ONLY on project source).\n"
        "Inspect all modified files against `.agents/teamwork/ORIGINAL_REQUEST.md` and `PROJECT.md`.\n"
        f"Write `.agents/teamwork/reviewer_{iteration}/handoff.md` and output verdict `APPROVE` or `REQUEST_CHANGES`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"reviewer-iter-{iteration}",
    )
    challenger_call = agent(
        f"You are Teamwork Empirical Challenger `challenger_{iteration}` (READ-ONLY on project source).\n"
        "Empirically stress-test boundary conditions, rapid state transitions, and edge cases.\n"
        f"Write `.agents/teamwork/challenger_{iteration}/handoff.md` and output verdict `APPROVE` or `REQUEST_CHANGES`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"challenger-iter-{iteration}",
    )
    auditor_call = agent(
        f"You are Teamwork Forensic Integrity Auditor `auditor_{iteration}` (Binary Veto: `CLEAN` vs `INTEGRITY_VIOLATION`).\n"
        "Audit all production files, test suites, and test runners. Flag any self-certifying test tautologies, local mock lambdas, "
        "facade test runners, or production stubs.\n"
        f"Write `.agents/teamwork/auditor_{iteration}/audit_report.md` and `handoff.md`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"forensic-auditor-iter-{iteration}",
    )
    return await parallel([reviewer_call, challenger_call, auditor_call])


async def main():
    await register_workflow(META)

    # Phase 0: Parallel Survey
    surveys = await parallel([
        lambda: run_survey_explorer(1, "Core architecture, input/entry points, and state management"),
        lambda: run_survey_explorer(2, "Domain logic, algorithms, external packages, and performance"),
        lambda: run_survey_explorer(3, "Data models, persistence, assets, and existing test infrastructure"),
    ])
    plan = await synthesize_project_md(surveys)
    log(f"Phase 0 complete: {len(plan['milestones'])} milestones synthesized in PROJECT.md")

    # Phase 1: Parallel Dual-Track Execution (Test Writer + Milestone Workers)
    track_tasks = [run_test_writer] + [
        (lambda m=m: run_milestone_worker(m)) for m in plan["milestones"]
    ]
    await parallel(track_tasks)
    log("Phase 1 Dual-Track complete. Entering Verification Gate.")

    # Phase 2 & 3: Verification Gate & Remediation Loop
    max_iterations = 3
    for iteration in range(1, max_iterations + 1):
        verdicts = await run_gate(iteration)
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

    # Phase 4: Mandatory Victory Audit
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


asyncio.run(main())
