---
trigger: glob
globs:
  - "**/*test*"
  - "**/*spec*"
  - "**/run_tests*"
description: Enforces the Teamwork Forensic Integrity Mandate on tests and runners (backed by HASP PostToolUse checks).
---

# Forensic Integrity Mandate

All code and tests are guarded in real time by HASP (`pf-anti-cheat-test`, `pf-facade-runner`) and audited by `teamwork:forensic-auditor`:
1. **No Tautological Tests**: Every test must import or invoke real production modules/binaries — zero local `Mock*` classes, local lambdas simulating the target system, or constant assertions.
2. **No Skipped Assertions**: Never add `skip`, `xit`, `xdescribe`, `[Ignore]`, or `@pytest.mark.skip` to force green builds.
3. **No Facade Runners**: Runners must execute the real test harness and exit non-zero on failures (no `|| true`, no static `TestReport.txt` echoes).
4. **No Production Stubs**: No `TODO` throws or `NotImplementedError` placeholders in completed milestones.
