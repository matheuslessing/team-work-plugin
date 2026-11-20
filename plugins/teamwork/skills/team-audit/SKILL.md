---
name: team-audit
description: "[Teamwork Forensic Audit] Standalone Binary Forensic Integrity Audit (CLEAN vs INTEGRITY VIOLATION) catching tautological tests, local mocks, skipped tests, stubs, and facade runners."
argument-hint: "[directory or testdir to audit]"
allowed-tools:
  - read
  - grep
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Binary Forensic Integrity Audit (`/team-audit`)

Zero-tolerance forensic audit holding binary veto power (`🟢 CLEAN` vs `🔴 INTEGRITY VIOLATION`).

## Steps
1. Run deterministic static forensic scan:
   ```bash
   node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" scan-integrity --workdir . --strict --json
   ```
2. Spawn `teamwork:forensic-auditor` (`authority_profile: audit_only`) to verify:
   - **Production authenticity**: zero `TODO` throws / `NotImplementedError` stubs or test lookup tables.
   - **Test authenticity**: every test imports/invokes real production code (zero local mock classes/lambdas, zero skipped tests).
   - **Live test runner**: dynamically executes test suite and exits non-zero on failure.
3. Write `<working_dir>/audit_report.md` and 5-Component `handoff.md` (`teamwork-cli.mjs validate-handoff --require-verdict`).
