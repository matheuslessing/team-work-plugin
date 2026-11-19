---
name: team-craft
description: "[Teamwork Phase 1] Interactive 9-step prompt crafting with Complexity Router (Solo / Quick / Full Dual-Track) producing ORIGINAL_REQUEST.md and delegating cleanly."
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

# Teamwork Prompt Crafting & Complexity Router (`/team-craft`)

Craft an objective requirement specification in `.agents/teamwork/prompt_draft.md`, lock it into `.agents/teamwork/ORIGINAL_REQUEST.md`, and route to the optimal execution tier.

## Core Rules
- **Specify What, Not How**: Define requirements (`R1..Rn`), explicit **Out-of-Scope** exclusions, and checkable criteria; avoid dictating code structure unless requested.
- **Grill-Me Decision Tree**: Walk through ambiguities **one logical branch at a time** (resolving dependencies sequentially rather than dumping all questions at once), and record domain terms in `.memory/contracts/glossary.md` when `.memory/` exists.
- **Complexity Router** (from *The Agent Loop*):
  - **Tier S (Single-file trivial edit)**: Handle directly with standard tests (avoid multi-agent overhead).
  - **Tier M (Contained bug fix / 1-module feature)**: Route to `/team-quick`.
  - **Tier L (Multi-module / cross-cutting architecture)**: Route to `/team-run` (Full Dual-Track).

## Steps 1–9
1. **Elicit Idea & Audience**: Capture purpose (`demo` | `production` | `eval` | `exploration`) in `prompt_draft.md`.
2. **Resolve Ambiguities & Pick Complexity Tier**: Present concrete scope options (`Tier S` vs `Tier M /team-quick` vs `Tier L /team-run`).
3. **Integrity Mode**: Select `development` | `demo` | `benchmark` (restrictions on external libs, open-source reuse, or test peeking).
4. **Requirements (`R1..Rn`)**: Draft 2–5 numbered requirement blocks.
5. **Verification Strategy**: Define programmatic E2E checks or objective rubrics.
6. **Acceptance Criteria (`- [ ]`)**: Convert checks into falsifiable checkboxes.
7. **Infrastructure Constraints**: Note external APIs, MCPs, or DB boundaries if any.
8. **Working Directory**: Confirm target repository root.
9. **Validate & Request Approval**: Confirm no unrequested hints, objective criteria only, and request user go-ahead.

## On User Approval
1. Copy `prompt_draft.md` -> `.agents/teamwork/ORIGINAL_REQUEST.md`.
2. Initialize harness: `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" init --workdir .`
3. Dispatch the chosen tier (`teamwork:sentinel`, `/team-run`, or `/team-quick` — in `DEVIN_CLOUD`, runtime hook routes automatically to `.agents/teamwork/workflow.py`).
