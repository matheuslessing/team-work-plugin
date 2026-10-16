---
name: test-track
description: Execute Track A (E2E Testing Track) using the test-writer subagent to build a 4-tier E2E test suite, automated CLI runner, TEST_INFRA.md, and TEST_READY.md.
argument-hint: "[path to PROJECT.md or target modules]"
agent: test-writer
triggers:
  - user
  - model
---

# Teamwork Track A — 4-Tier E2E Testing Track (`/teamwork:test-track`)

Design and implement the project's independent, requirement-driven 4-Tier E2E Test Suite.

1. Read `.agents/teamwork/ORIGINAL_REQUEST.md` and `.agents/teamwork/orchestrator_1/PROJECT.md` (especially `§ Feature Inventory` and `§ Interface Contracts`).
2. Initialize `.agents/teamwork/test_writer_1/BRIEFING.md` and `progress.md`.
3. Author `TEST_INFRA.md` at the project root mapping every feature (`F1..Fn`) to the 4 tiers:
   - **Tier 1 (Feature Coverage)**: `>= 5` functional tests per feature.
   - **Tier 2 (Boundary & Corner Cases)**: `>= 5` boundary/edge tests per feature.
   - **Tier 3 (Cross-Feature Combinations)**: Pairwise multi-feature interaction tests.
   - **Tier 4 (Real-World Scenarios)**: Full end-to-end user/system lifecycle scenarios.
4. Implement all test suites bound directly to the real production classes/functions (zero local mock tautologies).
5. Create an authentic, automated CLI test runner (`run_tests.py`, `run_tests.sh`, or `run_tests.ps1`) that dynamically executes the test harness and exits non-zero on failure.
6. Publish `TEST_READY.md` and write your 5-Component `handoff.md` in `.agents/teamwork/test_writer_1/handoff.md`.
