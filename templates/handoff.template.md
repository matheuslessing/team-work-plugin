# Handoff Report: <Agent ID> (<Milestone / Scope>)

**Agent:** `<agent_id>`  
**Archetype:** `<explorer | test_writer | implementer | reviewer_critic | critic | forensic_auditor | victory_auditor>`  
**Working Directory:** `.agents/teamwork/<agent_id>`  
**Verdict (if Gate Agent):** `<APPROVE | REQUEST_CHANGES | 🟢 CLEAN | 🔴 INTEGRITY VIOLATION>`

---

## 1. Observation
1. **Build / Test State**:
   - Command executed: `<exact command>`
   - Raw output / exit code: `<exact output>`
2. **Files Inspected or Modified**:
   - `<path/to/file.ext>` (lines `X–Y`): `<empirical observation of implementation or defect>`

---

## 2. Logic Chain
1. From Observation 1, `<logical deduction connecting empirical evidence to Requirement R1>`.
2. From Observation 2, `<logical deduction connecting empirical evidence to Acceptance Criterion R1.1>`.

---

## 3. Caveats
- `<List any environmental constraints, edge cases, or write "No caveats.">`

---

## 4. Conclusion
`<Clear statement of completion and formal Verdict if applicable.>`

---

## 5. Verification Method
1. **Reproducible Commands**:
   ```bash
   <exact command to verify build and tests>
   ```
2. **Invalidation Conditions**:
   - If `<specific falsifiable condition A occurs>`, this handoff is invalidated.
   - If `<specific falsifiable condition B occurs>`, this handoff is invalidated.
