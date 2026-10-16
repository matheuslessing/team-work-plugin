---
trigger: glob
globs:
  - ".agents/teamwork/**"
  - "**/*test*"
  - "**/*Test*"
  - "**/*spec*"
description: Enforces the Teamwork Forensic Integrity Mandate and 4-Tier Testing Rules whenever working inside .agents/teamwork/ or test files.
---

# Forensic Integrity Mandate (Development, Demo & Benchmark Modes)

All agents operating under the Teamwork protocol are subject to an independent **Forensic Integrity Audit** (`teamwork:forensic-auditor`) with binary veto power (`🟢 CLEAN` vs `🔴 INTEGRITY VIOLATION`).

## Strictly Prohibited Anti-Patterns (Automatic Gate Failure)

1. **Self-Certifying / Tautological Tests**:
   - NEVER declare local mock variables, dummy structs/classes, or inline lambdas inside a test file and assert against them instead of calling the actual production module.
   - *Example of Violation*:
     ```csharp
     // VIOLATION: Asserts on local string variable instead of calling InputController
     string context = "InVehicle";
     bool fireAction = (context == "OnFoot");
     Assert.False(fireAction);
     ```
   - *Required Authentic Pattern*: Instantiate or invoke the real production class/function under test and assert on its actual return value or state transition.

2. **Facade Test Runners**:
   - NEVER write a test runner script (`run_tests.py`, `run_tests.sh`, etc.) that merely echoes a pre-existing static report file (`TestReport.txt`) or prints hardcoded `"PASSED"` strings without executing the compiler/runtime test harness.

3. **Production Stubs & Hardcoded Bypasses**:
   - NEVER hardcode input-to-output lookup tables calibrated only to pass specific test inputs.
   - NEVER leave empty `TODO` methods or no-op facades where real algorithmic, physics, or state logic is required by `ORIGINAL_REQUEST.md`.

4. **Test Tampering by Implementation Workers**:
   - Milestone workers (`teamwork:worker`) are strictly forbidden from deleting, skipping (`[Ignore]`, `xit`, `pytest.mark.skip`), or weakening assertions in the test suite to make a build pass. If a test has a genuine bug or assembly visibility issue, escalate it in `handoff.md` so the Orchestrator can dispatch a targeted remediation.
