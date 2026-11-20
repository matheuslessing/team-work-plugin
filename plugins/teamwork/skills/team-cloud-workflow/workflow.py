"""
Teamwork v2 Deterministic Dynamic Workflows for Devin Cloud & Antigravity
Includes:
  - Dynamic active orchestrator resolution (`orchestrator_1..N`) via `state.json`
  - Built-in 30-Minute Orchestrator VM Watchdog (`watch_dog`)
  - Deterministic `GATE_STATUS.md` generation from structured verdicts
  - Gate-failure safety barrier (never runs Victory Audit when Gate fails)
  - Harness² Task-Level Recursion (`propose_probe_compose` with k=2 parallel candidates)
  - Model tiering (`AGENT_MODES`) and multi-turn Reviewer continuity

Supports 4 workflow modes via `--mode <full|quick|survey|gate>` or `TEAMWORK_WORKFLOW_MODE`.
"""

import asyncio
import datetime
import json
import os
import re
import subprocess
import sys

WATCHDOG_WINDOW_MINUTES = 30
WATCHDOG_PULSE_SECONDS = 600

VALID_AGENT_MODES = {"normal", "fast", "lite", "ultra", "fusion"}

AGENT_MODES = {
    "survey": "lite",
    "test_writer": "normal",
    "worker": "normal",
    "propose": "fast",
    "reviewer": "ultra",
    "challenger": "normal",
    "forensic_auditor": "ultra",
    "victory_auditor": "ultra",
}

WORKFLOW_MODES = {
    "full": {
        "name": "teamwork-full-pipeline-v2",
        "description": "Teamwork v2 Dual-Track pipeline with Contract Freeze, Worktree isolation, Gate safety, and Harness² Propose-Probe-Compose",
        "phases": [
            {"title": "survey", "detail": "Phase 0: Memory-first Explorer survey, PROJECT.md synthesis & contract freeze"},
            {"title": "dual_track", "detail": "Phase 1: Parallel E2E Test Track (Tiers 1-4) and Milestone Workers"},
            {"title": "gate_verification", "detail": "Phase 2: Multi-turn Reviewer, Empirical Challenger & Binary Forensic Auditor"},
            {"title": "remediation", "detail": "Phase 3: Remediation + Harness² Propose-Probe-Compose (k=2)"},
            {"title": "victory_audit", "detail": "Phase 4: Final independent Sentinel Victory Audit"},
        ],
    },
    "quick": {
        "name": "teamwork-quick-pipeline-v2",
        "description": "Compact Teamwork loop: 1 Worker -> Parallel Reviewer & Forensic Auditor with strict Gate barrier",
        "phases": [
            {"title": "implementation", "detail": "Step 1: Focused Worker implementation with genuine tests"},
            {"title": "gate_verification", "detail": "Step 2: Parallel Reviewer and Binary Forensic Auditor"},
            {"title": "remediation", "detail": "Step 3: Automated remediation loop until APPROVE + CLEAN"},
        ],
    },
    "survey": {
        "name": "teamwork-survey-pipeline-v2",
        "description": "Phase 0 Parallel Read-Only Explorer survey and PROJECT.md synthesis",
        "phases": [
            {"title": "survey", "detail": "Parallel Explorer survey and PROJECT.md contract synthesis"},
        ],
    },
    "gate": {
        "name": "teamwork-gate-pipeline-v2",
        "description": "3-Agent Teamwork Verification Gate (Reviewer + Challenger + Forensic Auditor -> GATE_STATUS.md)",
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

PROBE_CANDIDATE_SCHEMA = {
    "type": "object",
    "properties": {
        "candidate_id": {"type": "string"},
        "hypothesis": {"type": "string"},
        "branch": {"type": "string"},
        "probe_passed": {"type": "boolean"},
        "probe_output": {"type": "string"},
        "diff_summary": {"type": "string"},
    },
    "required": ["candidate_id", "hypothesis", "probe_passed", "probe_output", "diff_summary"],
}


def resolve_mode() -> str:
    if "--mode" in sys.argv:
        idx = sys.argv.index("--mode")
        if idx + 1 < len(sys.argv) and sys.argv[idx + 1] in WORKFLOW_MODES:
            return sys.argv[idx + 1]
    env_mode = os.environ.get("TEAMWORK_WORKFLOW_MODE", "full").strip().lower()
    return env_mode if env_mode in WORKFLOW_MODES else "full"


def get_active_orchestrator_dir(base_dir: str = None) -> str:
    root = base_dir or os.getcwd()
    tw_dir = os.path.join(root, ".agents", "teamwork")
    state_path = os.path.join(tw_dir, "state.json")
    if os.path.exists(state_path):
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                st = json.load(f)
            active = st.get("active_orchestrator")
            if active and re.match(r"^orchestrator_\d+$", active):
                return os.path.join(tw_dir, active)
        except Exception:
            pass
    if os.path.exists(tw_dir):
        candidates = []
        for name in os.listdir(tw_dir):
            m = re.match(r"^orchestrator_(\d+)$", name)
            if m and os.path.isdir(os.path.join(tw_dir, name)):
                candidates.append((int(m.group(1)), name))
        if candidates:
            candidates.sort(reverse=True)
            return os.path.join(tw_dir, candidates[0][1])
    return os.path.join(tw_dir, "orchestrator_1")


def write_gate_status_md(iteration: int, verdicts: list, base_dir: str = None) -> tuple[bool, list]:
    orch_dir = get_active_orchestrator_dir(base_dir)
    os.makedirs(orch_dir, exist_ok=True)
    gate_path = os.path.join(orch_dir, "GATE_STATUS.md")

    all_defects = []
    passed = True
    rows = []
    for v in verdicts:
        agent_id = v.get("agent_id", "gate_agent")
        verdict = v.get("verdict", "REQUEST_CHANGES")
        defects = v.get("defects", []) or []
        handoff = v.get("handoff_path", f".agents/teamwork/{agent_id}/handoff.md")
        if verdict in ("REQUEST_CHANGES", "INTEGRITY_VIOLATION", "REJECT"):
            passed = False
            all_defects.extend(defects)
        rows.append(f"| `{agent_id}` | gate | **{verdict}** | `{handoff}` |")

    result_str = "**PASS**" if passed else "**FAIL**"
    section = [
        f"## Gate — Iteration {iteration}",
        "| Agent | Role | Verdict | Source |",
        "|-------|------|---------|--------|",
        *rows,
        "",
        f"Gate Result: {result_str}",
        "",
    ]
    if all_defects:
        section.append("### Defects")
        for d in all_defects:
            section.append(f"- {d}")
        section.append("")

    existing = ""
    if os.path.exists(gate_path):
        with open(gate_path, "r", encoding="utf-8") as f:
            existing = f.read().rstrip() + "\n\n"
    else:
        existing = "# Gate Status — Verification & Final Acceptance\n\n"

    tmp_path = f"{gate_path}.{os.getpid()}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(existing + "\n".join(section))
    os.replace(tmp_path, gate_path)
    return passed, all_defects


def _emit_log(msg: str):
    if "log" in globals():
        log(msg)
    else:
        print(msg)


async def orchestrator_vm_watchdog():
    root = os.getcwd()
    teamwork_dir = os.path.join(root, ".agents", "teamwork")
    os.makedirs(teamwork_dir, exist_ok=True)
    watchdog_log = os.path.join(teamwork_dir, "watchdog.log")
    pulse_count = 0

    while True:
        await asyncio.sleep(WATCHDOG_PULSE_SECONDS)
        pulse_count += 1
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            subprocess.run(["git", "status", "--short"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        except Exception:
            pass

        orch_dir = get_active_orchestrator_dir(root)
        progress_md = os.path.join(orch_dir, "progress.md")
        entry = (
            f"[{now_iso}] [WATCH_DOG {WATCHDOG_WINDOW_MINUTES}m KEEP-ALIVE] "
            f"{os.path.basename(orch_dir)} active (pulse #{pulse_count})\n"
        )
        try:
            with open(watchdog_log, "a", encoding="utf-8") as f:
                f.write(entry)
            if os.path.exists(progress_md):
                with open(progress_md, "a", encoding="utf-8") as pf:
                    pf.write(f"- {entry}")
        except Exception:
            pass
        _emit_log(f"[WATCH_DOG 30m KEEP-ALIVE] {os.path.basename(orch_dir)} active (pulse #{pulse_count})")


def _resolve_primitives(agent_fn=None, parallel_fn=None):
    ag = agent_fn or globals().get("agent")
    par = parallel_fn or globals().get("parallel")
    if ag is None or par is None:
        raise RuntimeError("Devin Dynamic Workflow primitives `agent` and `parallel` are not present.")
    return ag, par


async def run_survey_explorer(idx: int, focus: str, agent_fn=None):
    ag, _ = _resolve_primitives(agent_fn, lambda *a: None)
    return await ag(
        f"You are Teamwork Explorer `explorer_survey_{idx}` (READ-ONLY outside `.agents/teamwork/explorer_survey_{idx}/`).\n"
        f"First query `.memory/memory.rc.json` (if present) and check drift; then inspect the codebase for: {focus}.\n"
        f"Write `.agents/teamwork/explorer_survey_{idx}/analysis.md` and 5-Component `handoff.md`.",
        phase="survey",
        schema=SURVEY_SCHEMA,
        label=f"explorer-survey-{idx}",
        mode=AGENT_MODES["survey"],
    )


async def synthesize_project_md(surveys, agent_fn=None):
    ag, _ = _resolve_primitives(agent_fn, lambda *a: None)
    orch_rel = os.path.relpath(get_active_orchestrator_dir(), os.getcwd()).replace("\\", "/")
    survey_json = json.dumps(surveys, sort_keys=True)
    return await ag(
        f"You are the Teamwork Orchestrator.\n"
        f"Synthesize Explorer reports into `{orch_rel}/PROJECT.md` (Architecture, Feature Inventory, Milestones, "
        f"Interface Contracts, Code Layout) and freeze contracts.\nSurvey data:\n{survey_json}",
        phase="survey",
        schema=PROJECT_PLAN_SCHEMA,
        label="synthesize-project-md",
    )


async def run_test_writer(agent_fn=None):
    ag, _ = _resolve_primitives(agent_fn, lambda *a: None)
    return await ag(
        "You are Teamwork `test_writer_1` (Track A: E2E Testing Track).\n"
        "Own exclusively: `TEST_INFRA.md`, `TEST_READY.md`, test suite, and test runner.\n"
        "Implement 4-Tier E2E tests bound directly to real production modules (ZERO mock tautologies, ZERO facade runners).\n"
        "Write `.agents/teamwork/test_writer_1/handoff.md`.",
        phase="dual_track",
        schema=WORKER_HANDOFF_SCHEMA,
        label="test-writer-1",
        mode=AGENT_MODES["test_writer"],
    )


async def run_milestone_worker(milestone, agent_fn=None):
    ag, _ = _resolve_primitives(agent_fn, lambda *a: None)
    m_id = milestone["id"]
    m_files = json.dumps(milestone["owned_files"], sort_keys=True)
    return await ag(
        f"You are Teamwork Milestone Worker `worker_{m_id}`.\n"
        f"Scope: {milestone['scope']}\nOwn exclusively: {m_files}\n"
        "Implement genuine production logic matching `PROJECT.md § Interface Contracts` (verify 0 compile errors).\n"
        f"Write `.agents/teamwork/worker_{m_id}/handoff.md`.",
        phase="dual_track",
        schema=WORKER_HANDOFF_SCHEMA,
        label=f"worker-{m_id}",
        mode=AGENT_MODES["worker"],
    )


async def run_gate(iteration: int, include_challenger: bool = True, agent_fn=None, parallel_fn=None):
    ag, par = _resolve_primitives(agent_fn, parallel_fn)
    reviewer_call = lambda: ag(
        f"You are Teamwork Adversarial Reviewer `reviewer_{iteration}` (READ-ONLY).\n"
        "Inspect modified files against `ORIGINAL_REQUEST.md` and `PROJECT.md`.\n"
        f"Write `.agents/teamwork/reviewer_{iteration}/handoff.md` with verdict `APPROVE` or `REQUEST_CHANGES`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"reviewer-iter-{iteration}",
        mode=AGENT_MODES["reviewer"],
    )
    auditor_call = lambda: ag(
        f"You are Teamwork Forensic Integrity Auditor `auditor_{iteration}` (Binary Veto: `CLEAN` vs `INTEGRITY_VIOLATION`).\n"
        "Audit production files, tests, and runners for mock tautologies, skipped tests, stubs, or facade runners.\n"
        f"Write `.agents/teamwork/auditor_{iteration}/audit_report.md` and `handoff.md`.",
        phase="gate_verification",
        schema=GATE_VERDICT_SCHEMA,
        label=f"forensic-auditor-iter-{iteration}",
        mode=AGENT_MODES["forensic_auditor"],
    )
    if not include_challenger:
        verdicts = await par([reviewer_call, auditor_call])
    else:
        challenger_call = lambda: ag(
            f"You are Teamwork Empirical Challenger `challenger_{iteration}` (READ-ONLY).\n"
            "Empirically stress-test boundary conditions and edge cases.\n"
            f"Write `.agents/teamwork/challenger_{iteration}/handoff.md` with verdict `APPROVE` or `REQUEST_CHANGES`.",
            phase="gate_verification",
            schema=GATE_VERDICT_SCHEMA,
            label=f"challenger-iter-{iteration}",
            mode=AGENT_MODES["challenger"],
        )
        verdicts = await par([reviewer_call, challenger_call, auditor_call])

    write_gate_status_md(iteration, verdicts)
    return verdicts


async def propose_probe_compose(iteration: int, defects: list, k: int = 2, agent_fn=None, parallel_fn=None):
    """
    Harness² Task-Level Recursion (Propose -> Probe -> Compose):
    Spawns `k` parallel remediation hypotheses in isolated worktrees/branches,
    empirically probes each against the real test runner, and contrastively composes
    the strongest fix without requiring a pre-built ground-truth oracle.
    """
    ag, par = _resolve_primitives(agent_fn, parallel_fn)
    defects_json = json.dumps(defects, sort_keys=True)
    candidate_calls = [
        (lambda idx=c_idx: ag(
            f"Harness² PROPOSE+PROBE Candidate `candidate_{iteration}_{idx}` (isolated branch).\n"
            f"Formulate distinct root-cause hypothesis #{idx} for defects:\n{defects_json}\n"
            "Implement candidate fix in an isolated worktree, execute the live test runner as empirical probe, "
            "and return raw probe_output + diff_summary.",
            phase="remediation",
            schema=PROBE_CANDIDATE_SCHEMA,
            label=f"harness2-probe-{iteration}-{idx}",
            mode=AGENT_MODES["propose"],
        ))
        for c_idx in range(1, k + 1)
    ]
    candidates = await par(candidate_calls)
    candidates_json = json.dumps(candidates, sort_keys=True)
    return await ag(
        f"Harness² COMPOSE `worker_remediation_{iteration}`.\n"
        f"Contrastively analyze the {k} candidate probes below, synthesize the winning fix (zero stubs/mocks), "
        "log dead ends in `DEAD_ENDS.md`, run the full E2E test suite, and write 5-Component `handoff.md`.\n"
        f"Candidates:\n{candidates_json}",
        phase="remediation",
        schema=WORKER_HANDOFF_SCHEMA,
        label=f"harness2-compose-{iteration}",
    )


async def execute_survey_workflow(agent_fn=None, parallel_fn=None):
    ag, par = _resolve_primitives(agent_fn, parallel_fn)
    surveys = await par([
        lambda: run_survey_explorer(1, "Core architecture, entry points, and state management", ag),
        lambda: run_survey_explorer(2, "Domain logic, algorithms, packages, and performance", ag),
        lambda: run_survey_explorer(3, "Data models, persistence, memory, and test infrastructure", ag),
    ])
    plan = await synthesize_project_md(surveys, ag)
    _emit_log(f"Phase 0 complete: {len(plan['milestones'])} milestones synthesized in PROJECT.md")
    return plan


async def execute_quick_workflow(agent_fn=None, parallel_fn=None):
    ag, par = _resolve_primitives(agent_fn, parallel_fn)
    await ag(
        "You are Teamwork Quick Worker `worker_quick_1`.\n"
        "Implement the required fix/feature with genuine production logic and real tests; write `handoff.md`.",
        phase="implementation",
        schema=WORKER_HANDOFF_SCHEMA,
        label="worker-quick-1",
    )
    last_defects = []
    for iteration in range(1, 4):
        verdicts = await run_gate(iteration, include_challenger=False, agent_fn=ag, parallel_fn=par)
        passed = all(v.get("verdict") in ("APPROVE", "CLEAN") for v in verdicts)
        last_defects = [d for v in verdicts if v.get("verdict") in ("REQUEST_CHANGES", "INTEGRITY_VIOLATION") for d in (v.get("defects") or [])]
        if passed:
            _emit_log(f"Quick Gate Iteration {iteration} PASSED (APPROVE + CLEAN)!")
            return {"status": "PASSED", "iteration": iteration, "verdicts": verdicts}
        if iteration < 3:
            defects_json = json.dumps(last_defects, sort_keys=True)
            await ag(
                f"You are Teamwork Remediation Worker `worker_quick_remediation_{iteration}`.\n"
                f"Fix all defects:\n{defects_json}\nWrite 5-Component `handoff.md` and verify 100% pass rate.",
                phase="remediation",
                schema=WORKER_HANDOFF_SCHEMA,
                label=f"worker-quick-remediation-{iteration}",
            )
    _emit_log("Quick Gate FAILED after max remediation iterations.")
    return {"status": "FAILED", "iterations": 3, "defects": last_defects}


async def execute_full_workflow(agent_fn=None, parallel_fn=None):
    ag, par = _resolve_primitives(agent_fn, parallel_fn)
    plan = await execute_survey_workflow(agent_fn=ag, parallel_fn=par)

    track_tasks = [lambda: run_test_writer(ag)] + [
        (lambda m=m: run_milestone_worker(m, ag)) for m in plan["milestones"]
    ]
    await par(track_tasks)
    _emit_log("Phase 1 Dual-Track complete. Entering Verification Gate.")

    gate_passed = False
    all_defects = []
    max_iters = 3

    for iteration in range(1, max_iters + 1):
        verdicts = await run_gate(iteration, include_challenger=True, agent_fn=ag, parallel_fn=par)
        all_defects = [
            d
            for v in verdicts
            if v.get("verdict") in ("REQUEST_CHANGES", "INTEGRITY_VIOLATION", "REJECT")
            for d in (v.get("defects") or [])
        ]
        gate_passed = all(v.get("verdict") in ("APPROVE", "CLEAN") for v in verdicts)

        if gate_passed:
            _emit_log(f"Gate Iteration {iteration} PASSED (All APPROVE + CLEAN)!")
            break

        if iteration == max_iters:
            _emit_log(f"Gate Iteration {iteration} FAILED. Remediation budget exhausted; refusing Victory Audit.")
            return {
                "status": "GATE_FAILED_EXHAUSTED",
                "iterations": iteration,
                "defects": all_defects,
            }

        _emit_log(f"Gate Iteration {iteration} FAILED ({len(all_defects)} defects). Running remediation.")
        if iteration >= 2:
            await propose_probe_compose(iteration, all_defects, k=2, agent_fn=ag, parallel_fn=par)
        else:
            defects_json = json.dumps(all_defects, sort_keys=True)
            await ag(
                f"You are Teamwork Remediation Worker `worker_remediation_{iteration}`.\n"
                "Log failed approaches in active `DEAD_ENDS.md` and fix every defect:\n"
                f"{defects_json}\nVerify 100% E2E pass rate with 0 compile errors and write 5-Component `handoff.md`.",
                phase="remediation",
                schema=WORKER_HANDOFF_SCHEMA,
                label=f"worker-remediation-{iteration}",
            )

    if not gate_passed:
        return {"status": "GATE_FAILED_EXHAUSTED", "iterations": max_iters, "defects": all_defects}

    victory = await ag(
        "You are Teamwork `victory_auditor` spawned by Sentinel.\n"
        "Verify every checkbox in `ORIGINAL_REQUEST.md`, active `GATE_STATUS.md`, and run live E2E tests.\n"
        "Write `.agents/teamwork/victory_auditor/handoff.md` and `.agents/teamwork/sentinel/handoff.md`.",
        phase="victory_audit",
        schema=GATE_VERDICT_SCHEMA,
        label="victory-auditor",
        mode=AGENT_MODES["victory_auditor"],
    )
    _emit_log(f"Victory Audit Verdict: {victory.get('verdict')}")
    return {"status": "COMPLETED", "victory": victory}


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
        invalid_modes = {k: v for k, v in AGENT_MODES.items() if v not in VALID_AGENT_MODES}
        if invalid_modes:
            raise SystemExit(f"Invalid Devin Cloud agent modes: {invalid_modes}")
        has_globals = "register_workflow" in globals()
        print(json.dumps({
            "workflow_file": os.path.abspath(__file__),
            "supported_modes": list(WORKFLOW_MODES.keys()),
            "selected_mode": resolve_mode(),
            "watchdog_window_minutes": WATCHDOG_WINDOW_MINUTES,
            "watchdog_pulse_seconds": WATCHDOG_PULSE_SECONDS,
            "runner_injected_globals": has_globals,
            "supports_propose_probe_compose": True,
            "agent_modes": AGENT_MODES,
        }))
        sys.exit(0)
    asyncio.run(main())
