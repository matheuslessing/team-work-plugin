# Teamwork Multi-Agent Engineering Protocol

This plugin equips Devin CLI with the **Teamwork** multi-agent system: a hierarchical, artifact-driven orchestration architecture with Dual-Track implementation/testing, strict write boundaries, adversarial verification gates, and binary forensic integrity auditing.

---

## 1. Core Principles

| # | Principle | Rule |
|---|-----------|------|
| 1 | **Specify What, Not How** | Define requirements (`R1..Rn`) and checkable acceptance criteria. Preserve the agent team's architectural solution space unless the user explicitly constrains it. |
| 2 | **Dual-Track Isolation** | Track A (`test-writer`) builds independent opaque-box 4-tier E2E tests while Track B (`worker` milestones) implements production logic. Implementers NEVER modify test suites to make them pass; Test Writers NEVER modify production code. |
| 3 | **Strict Role Separation** | Orchestrators (`sentinel`, `orchestrator`) are **dispatch-only** and NEVER write production code. Explorers, Reviewers, Challengers, and Forensic Auditors are **read/audit-only** (`edit` tool is disabled in their profiles) and NEVER modify production files. |
| 4 | **Exclusive Write Boundaries** | Every parallel `worker` milestone receives an explicit, non-overlapping list of files/directories it exclusively owns in its `BRIEFING.md`. |
| 5 | **Zero-Tolerance Forensic Integrity** | The `forensic-auditor` holds a **binary veto** (`CLEAN` vs `INTEGRITY VIOLATION`). Self-certifying tests, tautological assertions, local mock lambdas pretending to test production code, or facade test runners immediately fail the gate. |

---

## 2. Workspace & State Machine Layout (`.agents/teamwork/`)

When a Teamwork mission runs in a repository, all coordination state lives on disk under `.agents/teamwork/`:

```text
.agents/teamwork/
├── ORIGINAL_REQUEST.md          # Authoritative, immutable record of user requirements & criteria
├── sentinel/
│   ├── BRIEFING.md              # Sentinel identity, active orchestrator, and Victory Audit status
│   └── handoff.md               # Final verified status report
├── orchestrator_1/
│   ├── BRIEFING.md              # Orchestrator identity, workflow, team roster, and active phase
│   ├── DISPATCH.md              # Incoming parent instructions
│   ├── PROJECT.md               # Global architecture, 100% Feature Inventory, Milestones, Interface Contracts
│   ├── plan.md                  # Phased execution strategy
│   ├── progress.md              # Liveness & milestone heartbeat tracker
│   ├── GATE_STATUS.md           # Iteration-by-iteration verdicts from Reviewers, Challengers, and Auditor
│   ├── DEAD_ENDS.md             # Log of failed approaches and anti-patterns to avoid repeating
│   └── handoff.md               # Soft handoff (for succession) or Hard handoff (on completion)
└── <subagent_id>/               # e.g., explorer_survey_1, test_writer_1, worker_m1, reviewer_1, challenger_1, auditor_1
    ├── DISPATCH.md              # Exact assignment, write boundaries, and contracts from Orchestrator
    ├── BRIEFING.md              # Subagent working memory, identity, constraints, and decisions
    ├── progress.md              # Liveness heartbeat
    ├── analysis.md / changes.md # Detailed technical findings or file modifications
    └── handoff.md               # Mandatory 5-Component Handoff Report
```

---

## 3. Mandatory 5-Component Handoff Standard (`handoff.md`)

Every subagent (`explorer`, `test-writer`, `worker`, `reviewer`, `challenger`, `forensic-auditor`, `victory-auditor`) **MUST** conclude its work by writing `<working_dir>/handoff.md` containing all 5 sections:

1. **`## 1. Observation`**: Empirical facts only — exact file paths, line numbers, raw command/compiler outputs, and test counts. No speculation.
2. **`## 2. Logic Chain`**: Step-by-step deduction connecting the empirical observations in Section 1 to each assigned Requirement (`R1..Rn`) and Acceptance Criterion.
3. **`## 3. Caveats`**: Any known limitations, edge cases, or environmental constraints (or `No caveats` if none).
4. **`## 4. Conclusion`**: Clear completion summary and, for gate agents, an explicit formal verdict:
   - Reviewers & Challengers: `APPROVE` or `REQUEST_CHANGES`
   - Forensic & Victory Auditors: `🟢 CLEAN` or `🔴 INTEGRITY VIOLATION`
5. **`## 5. Verification Method`**: Exact commands/steps to independently reproduce the work, followed by explicit **`Invalidation Conditions`** (falsifiable conditions under which the handoff is invalidated).

---

## 4. Slash Commands & Subagent Profiles

### Slash Commands (Skills)
- `/team-craft` — `[Teamwork Prompt Crafting]` Interactive 9-step prompt crafting workflow (`prompt_draft.md` -> `.agents/teamwork/ORIGINAL_REQUEST.md`) with automatic delegation upon approval.
- `/team-run` — `[Teamwork Full Autonomous Pipeline]` Full Dual-Track execution (`Sentinel -> Orchestrator -> Survey -> Dual-Track -> Gate Verification -> Victory Audit`).
- `/team-quick` — `[Teamwork Quick Focused Team]` Small, focused team workflow (`1 Worker + Adversarial Reviewer/Auditor loop`) for self-contained bug fixes or features.
- `/team-survey` — `[Teamwork Phase 0 Survey]` Parallel codebase exploration (`teamwork:explorer`) to generate `.agents/teamwork/orchestrator_1/PROJECT.md`.
- `/team-test-track` — `[Teamwork Track A QA]` Independent 4-tier E2E test suite authoring (`teamwork:test-writer`) producing `TEST_INFRA.md` and `TEST_READY.md`.
- `/team-gate` — `[Teamwork Verification Gate]` Full 3-agent verification gate (`reviewer` + `challenger` + `forensic-auditor`) updating `GATE_STATUS.md`.
- `/team-audit` — `[Teamwork Forensic Audit]` Standalone Binary Forensic Integrity Audit (`teamwork:forensic-auditor`) scanning production code and test suites for shortcuts or mocks.
- `/team-status` — `[Teamwork Mission Dashboard]` Live status dashboard of the current `.agents/teamwork/` mission.
- `/team-cloud-workflow` — `[Teamwork Devin Cloud 100%]` Deterministic Devin Dynamic Workflow (`workflow.py`) and Managed Devins orchestration with parallel Cloud VMs, async P2P wakeup, and cron schedules.

### Custom Subagent Profiles (`agents/`)
- `teamwork:sentinel` — Top-level supervisor (`max-nesting: 3`). Relays user intent, launches orchestrator, enforces mandatory Victory Audit.
- `teamwork:orchestrator` — Project orchestrator (`max-nesting: 2`). Decomposes requirements, manages Dual-Track workers and Verification Gates.
- `teamwork:explorer` — Read-only codebase surveyor (`allowed-tools: [read, grep, glob, exec]`).
- `teamwork:test-writer` — QA & E2E test suite engineer (Tiers 1–4 coverage, `TEST_INFRA.md`, `TEST_READY.md`).
- `teamwork:worker` — Milestone implementation engineer operating within strict file write boundaries.
- `teamwork:reviewer` — Adversarial code and requirements reviewer (`allowed-tools: [read, grep, glob, exec]`).
- `teamwork:challenger` — Empirical stress tester and boundary/edge-case hunter (`allowed-tools: [read, grep, glob, exec]`).
- `teamwork:forensic-auditor` — Binary integrity auditor (`allowed-tools: [read, grep, glob, exec]`) hunting for tautological tests, mock bypasses, and facades.
- `teamwork:victory-auditor` — Final independent pre-delivery auditor spawned by Sentinel before reporting completion to the user.
