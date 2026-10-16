---
name: team-audit
description: "[Teamwork Forensic Audit] Run a zero-tolerance Binary Forensic Integrity Audit (CLEAN vs INTEGRITY VIOLATION) to catch mock tests, tautologies, facade runners, and stubs."
argument-hint: "[directory or milestone to audit]"
allowed-tools:
  - read
  - grep
  - glob
  - exec
triggers:
  - user
  - model
---

# Teamwork Forensic Integrity Audit (`/team-audit`)

Perform an exhaustive, zero-trust Forensic Integrity Audit of the project's production code, configurations, test suites, and test runners (spawn `teamwork:forensic-auditor` in Devin CLI, a Managed Devin session in Devin Cloud, or execute the 4-phase audit directly):

1. Initialize `.agents/teamwork/auditor_1/BRIEFING.md` and `progress.md`.
2. Run the automated integrity scanner helper if available:
   `node "${PLUGIN_ROOT}/scripts/teamwork-cli.mjs" scan-integrity --workdir .`
3. Execute all 4 Forensic Audit Phases:
   - **Phase 1**: Production code authenticity (no stubs, no hardcoded test lookup tables).
   - **Phase 2**: Configuration, asset, and dependency wiring verification.
   - **Phase 3**: Line-by-line test suite inspection (flag any test asserting on local mock variables, local lambdas, or local dummy classes instead of production code).
   - **Phase 4**: Live test runner verification (confirm runner executes real tests rather than echoing cached report files).
4. Write `.agents/teamwork/auditor_1/audit_report.md` and your 5-Component `.agents/teamwork/auditor_1/handoff.md` with binary verdict `🟢 CLEAN` or `🔴 INTEGRITY VIOLATION`.
