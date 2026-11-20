---
name: team-test-track
description: "[Teamwork Track A QA] Launch independent Test Writer to build 4-tier E2E test suites bound to frozen contracts, dynamic CLI test runner, TEST_INFRA.md, and TEST_READY.md."
argument-hint: "[target modules or PROJECT.md path]"
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

# Teamwork Track A — 4-Tier E2E Testing Track (`/team-test-track`)

Build an independent, opaque-box test suite bound directly to real production modules under frozen contracts.

## Steps
1. Read `ORIGINAL_REQUEST.md` and `<active_orchestrator>/PROJECT.md` (`§ Feature Inventory` & `§ Interface Contracts`).
2. Spawn `teamwork:test-writer` (`teamwork-cli.mjs spawn test_writer_1 test-writer --own "TEST_INFRA.md,TEST_READY.md,tests/**,run_tests.*"`).
3. Author `TEST_INFRA.md` and tests across Tiers 1–4 (`>= 5` Feature tests/feature, `>= 5` Boundary tests/feature, Combinatorial, Real-World Scenarios).
4. Create dynamic CLI test runner (`run_tests.*` exiting non-zero on failure). HASP `PostToolUse` (`pf-anti-cheat-test`, `pf-facade-runner`) checks every saved test/runner file.
5. Verify test runner compiles/executes, publish `TEST_READY.md`, and write 5-Component `handoff.md`.
