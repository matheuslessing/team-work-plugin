# Teamwork v2 Multi-Agent Harness

Dual-Track orchestration harness (`Sentinel -> Orchestrator -> Explorers, Test Writer, Milestone Workers -> Adversarial & Forensic Gate -> Victory Audit`) built on LTS states, HASP Program Functions, SkillOps contracts, and Antigravity Swarm coordination.

## Core Rules
1. **Specify What, Not How**: Define requirements (`R1..Rn`) and objective criteria; freeze `PROJECT.md § Interface Contracts` via `teamwork-cli.mjs state freeze-contract` before Dual-Track starts.
2. **Authority Separation (Enforced by HASP `PreToolUse`)**:
   - `sentinel` / `orchestrator`: `dispatch_only` (`.agents/teamwork/**` only).
   - `explorer` / `reviewer` / `challenger`: `read_only` (`edit` disabled; write reports strictly under `.agents/teamwork/<agent_id>/`).
   - `forensic-auditor` / `victory-auditor`: `audit_only` (`edit` disabled; binary veto).
   - `worker` / `test-writer`: strictly scoped by `DISPATCH.md` + optional isolated Git Worktrees (`--worktree`).
3. **Zero-Tolerance Integrity (Enforced by `PostToolUse` + `forensic-auditor`)**: No mock tautologies, skipped tests, production stubs, or facade test runners.
4. **Dynamic Succession**: Resolve active orchestrator via `teamwork-cli.mjs state show` (supports `orchestrator_1..N`).
5. **5-Component Handoffs (Enforced on `Stop`)**: `Observation`, `Logic Chain`, `Caveats`, `Conclusion`, `Verification Method` + `Invalidation Conditions`.

## Quick CLI Reference
- `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" init|status|detect-env|watchdog|check-heartbeat|succeed-orchestrator`
- `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" spawn|state|board|stall-check|view|worktree|validate-handoff|scan-integrity|check-gate`
