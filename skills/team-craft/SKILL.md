---
name: team-craft
description: "[Teamwork Phase 1] Interactive 9-step prompt crafting interview (creates prompt_draft.md & ORIGINAL_REQUEST.md) and launches the Teamwork multi-agent system."
argument-hint: "[initial project idea or requirements]"
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

# Teamwork Two-Phase Prompt Crafting & Delegation (`/team-craft`)

Execute the two-phase Teamwork workflow:
1. **Phase 1**: Craft a rigorous, well-structured task prompt with the user through Steps 1–9, maintaining `.agents/teamwork/prompt_draft.md`.
2. **Phase 2**: Upon explicit user approval, save `.agents/teamwork/ORIGINAL_REQUEST.md` and delegate to the Teamwork multi-agent system (`teamwork:sentinel` or `teamwork:orchestrator`).

Both phases are required — crafting without delegation is incomplete.

---

## Artifact-Based Workflow

Immediately create `.agents/teamwork/prompt_draft.md` with this scaffold and update it after every step:

```markdown
# Teamwork Project Prompt — Draft

> Status: Step 1 — Eliciting project idea
> Goal: Craft prompt -> get user approval -> delegate to Teamwork
> Requested team: [none — Teamwork routes from the description]

[Project description — 1-2 sentences]

Working directory: [TBD]
Integrity mode: [development | demo | benchmark]

## Requirements

### R1. [TBD]

### R2. [TBD]

## Acceptance Criteria

### [TBD]
- [ ] [TBD]

---
*Next: when approved -> write ORIGINAL_REQUEST.md and delegate to teamwork:sentinel*
```

---

## Core Principles

| # | Principle | Rule |
|---|-----------|------|
| 1 | **Specify What, Not How** | Define requirements and acceptance criteria. Avoid prescribing implementation details (file names, algorithms, libraries) unless the user explicitly requests them. |
| 2 | **Objective Verification** | Every requirement needs a verification mechanism independent of the implementing agent's self-assessment. Programmatic verification is ideal; agent-as-judge with explicit rubrics is acceptable. |
| 3 | **Acceptance Criteria = Guardrails** | Set the bar based on the user's actual needs to prevent self-certification of half-baked work. |
| 4 | **Minimal Requirements** | Only specify what the user cares about. Let Teamwork infer the rest. |

---

## Interactive Steps 1–9

If the user provided a pre-existing prompt, scan it against Steps 1–9, skip what is already covered, and walk through only the missing gaps (especially Step 3 Integrity Mode, Step 5 Verification, and Step 6 Acceptance Criteria).

### Step 1: Elicit the Idea
Ask what the user wants to build, the purpose (`demo`, `production`, `eval`, `exploration`), and the audience. Capture in 1–2 sentences in `prompt_draft.md`.

### Step 2: Identify Ambiguity & Team Scale
Identify points with multiple reasonable interpretations that affect **scope** or **verification** and present concrete options:
- **Scope & Quality Bar**: Proof-of-concept vs polished production system.
- **Tech Constraints**: Hard constraints on language, engine, or dependencies.
- **Effort & Scale (Opt-in)**:
  - If the task is a **single self-contained change** (bug fix, small feature, contained refactor), ask whether to use the **Small Focused Team** (`/team-quick` — 1 implementer + adversarial review loop) or the **Full Dual-Track Team** (`/team-run`).

### Step 3: Determine Integrity Mode
Ask behavioral questions (multi-select) about acceptable shortcuts:
- Copying code from existing open-source projects for core logic
- Using pre-built libraries/frameworks for core functionality
- Running external scripts or delegating execution to other tools
- Reading test source code before implementing
- No restrictions — the team can use any approach that works

Map answers:
- "No restrictions" or nothing selected -> `Integrity mode: development`
- Some (but not all) restricted -> `Integrity mode: demo`
- All restricted -> `Integrity mode: benchmark`

### Step 4: Draft Requirements (`R1..Rn`)
Write 2–5 requirement blocks (`### R1.`, `### R2.`, ...). Focus on **what** is needed, not **how** to code it, unless the user explicitly constrains the architecture.

### Step 5: Design Verification
Verification is a **forcing function** that compels an iterative `build -> test -> debug` loop.
- Ask if the user has existing test suites, scripts, or reference benchmarks.
- Design programmatic tests (preferred) or explicit rubrics for every requirement.

### Step 6: Set Acceptance Criteria
Convert verification mechanisms into concrete, objectively checkable `- [ ]` criteria grouped by category.

### Step 7: Infrastructure Constraints
If the project touches remote storage, job launching, or external APIs, add a controlled infrastructure requirement. Skip if self-contained.

### Step 8: Choose Working Directory
Confirm the target project working directory (default: current repository root).

### Step 9: Assemble, Validate & Request Approval
Validate against this checklist:
- [ ] No unrequested implementation hints
- [ ] Every acceptance criterion is objectively checkable without human judgment
- [ ] An agent could NOT trivially self-certify a half-baked result

Present the final `prompt_draft.md` to the user and set status to `Ready for launch — awaiting user approval`.

---

## Delegation Protocol (On User Approval — Automatic Runtime Detection)

When the user approves (`"go"`, `"looks good"`, `"launch"`, `"pode rodar"`, `"aprovo"`):
1. Copy the approved prompt from `.agents/teamwork/prompt_draft.md` to `.agents/teamwork/ORIGINAL_REQUEST.md` with an ISO timestamp header.
2. Run the helper script to initialize the workspace folders, detect the runtime (`DEVIN_CLOUD` vs `DEVIN_CLI_LOCAL`), and auto-provision `.agents/teamwork/workflow.py` when in Cloud:
   ```bash
   node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" init --workdir .
   ```
3. **Launch Automatically Based on Detected Runtime (DO NOT wait for the user to remind you)**:
   - **If `DEVIN_CLOUD` is detected**:
     1. **Primary Cloud Engine**: Immediately execute `.agents/teamwork/workflow.py --mode full` (or `--mode quick` if the user chose the Small Focused Team). Copy `.agents/teamwork/workflow.py` to `./workflow.py` only if the runner requires root placement.
     2. **Automatic Fallback**: If the Dynamic Workflow runner is not active in the current session, immediately spawn parallel child Devin sessions via **Managed Devins** (`devin_session_create` + `devin_session_gather` + `devin_schedule_manage`).
   - **If `DEVIN_CLI_LOCAL` is detected**:
     - Spawn the **`teamwork:sentinel`** subagent (or invoke `/team-run` for full team, `/team-quick` for small team) passing the full text of `ORIGINAL_REQUEST.md`.
