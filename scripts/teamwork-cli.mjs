#!/usr/bin/env node
/**
 * Teamwork CLI Helper for Devin CLI Plugin
 * Supports:
 *   node scripts/teamwork-cli.mjs init [--workdir <dir>] [--mode <development|demo|benchmark>]
 *   node scripts/teamwork-cli.mjs spawn <agent_id> <archetype> [--milestone <m>] [--workdir <dir>]
 *   node scripts/teamwork-cli.mjs validate-handoff <path-to-handoff.md>
 *   node scripts/teamwork-cli.mjs scan-integrity [--workdir <dir>] [--testdir <dir>]
 *   node scripts/teamwork-cli.mjs check-gate [--workdir <dir>]
 *   node scripts/teamwork-cli.mjs status [--workdir <dir>]
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0] || 'status';

function getFlag(name, defaultValue = '') {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}

const workdir = path.resolve(getFlag('--workdir', process.env.DEVIN_PROJECT_DIR || process.cwd()));
const teamworkRoot = path.join(workdir, '.agents', 'teamwork');
const nowIso = new Date().toISOString();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

function cmdInit() {
  const mode = getFlag('--mode', 'development');
  ensureDir(teamworkRoot);
  ensureDir(path.join(teamworkRoot, 'sentinel'));
  ensureDir(path.join(teamworkRoot, 'orchestrator_1'));

  writeIfMissing(
    path.join(teamworkRoot, 'ORIGINAL_REQUEST.md'),
    `# Original User Request\n\n## Initial Request — ${nowIso}\n\n[Project description]\n\nWorking directory: ${workdir}\nIntegrity mode: ${mode}\n\n## Requirements\n\n### R1. [Requirement 1]\n\n## Acceptance Criteria\n\n### Core Criteria\n- [ ] [Objective, checkable condition]\n`
  );

  writeIfMissing(
    path.join(teamworkRoot, 'sentinel', 'BRIEFING.md'),
    `# BRIEFING — ${nowIso}\n\n## Mission\nSupervise end-to-end execution of the project via project orchestrator and mandatory victory auditor.\n\n## 🔒 My Identity\n- Archetype: sentinel\n- Working directory: ${path.join(teamworkRoot, 'sentinel')}\n- Orchestrator: orchestrator_1\n- Victory Auditor: to be spawned on victory claim\n\n## 🔒 Key Constraints\n- No technical decisions — relay only\n- Victory Audit is MANDATORY before reporting completion\n- Must not write production code\n\n## Victory Audit Status\n- **Triggered**: no\n- **Verdict**: pending\n- **Retry count**: 0\n`
  );

  writeIfMissing(
    path.join(teamworkRoot, 'orchestrator_1', 'BRIEFING.md'),
    `# BRIEFING — ${nowIso}\n\n## Mission\nOrchestrate the project ensuring 100% acceptance criteria pass.\n\n## 🔒 My Identity\n- Archetype: orchestrator\n- Roles: orchestrator, user_liaison, human_reporter, successor\n- Working directory: ${path.join(teamworkRoot, 'orchestrator_1')}\n- Original parent: Sentinel\n\n## 🔒 My Workflow\n- **Pattern**: Project Pattern (Dual Track: Implementation Track + E2E Testing Track)\n- **Scope document**: ${path.join(teamworkRoot, 'orchestrator_1', 'PROJECT.md')}\n- **Work items**:\n  1. Phase 0: Survey and Scope Mapping [in-progress]\n  2. E2E Testing Track Setup [pending]\n  3. Implementation Milestones [pending]\n  4. Final Milestone E2E, Adversarial Hardening & Forensic Audit [pending]\n\n## 🔒 Key Constraints\n- Dispatch-only orchestrator: NEVER write source code, delegate all investigation/code/testing.\n- Zero tolerance for cheating/integrity violations (Auditor has binary veto).\n- Never reuse a subagent after it has delivered its handoff — always spawn fresh.\n\n## Team Roster\n| Agent | Type | Work Item | Status |\n|-------|------|-----------|--------|\n`
  );

  writeIfMissing(
    path.join(teamworkRoot, 'orchestrator_1', 'DEAD_ENDS.md'),
    `# DEAD ENDS — Orchestrator 1\n\n| Iteration | Approach Tried | Why It Failed | Files Touched |\n|-----------|---------------|---------------|---------------|\n`
  );

  writeIfMissing(
    path.join(teamworkRoot, 'orchestrator_1', 'GATE_STATUS.md'),
    `# Gate Status — Verification & Final Acceptance\n\n## Gate — Iteration 1\n| Agent | Role | Verdict | Source |\n|-------|------|---------|--------|\n\nGate Result: **PENDING**\n`
  );

  console.log(`Initialized Teamwork workspace at: ${teamworkRoot}`);
}

function cmdSpawn() {
  const agentId = args[1];
  const archetype = args[2] || 'worker';
  const milestone = getFlag('--milestone', 'TBD');

  if (!agentId) {
    console.error('Usage: teamwork-cli.mjs spawn <agent_id> <archetype> [--milestone <m>]');
    process.exit(1);
  }

  const agentDir = path.join(teamworkRoot, agentId);
  ensureDir(agentDir);

  writeIfMissing(
    path.join(agentDir, 'DISPATCH.md'),
    `## ${nowIso}\nFrom: orchestrator_1\nPriority: MESSAGE_PRIORITY_HIGH\n\nYou are assigned as \`${agentId}\` (Archetype: \`${archetype}\`) for Milestone: ${milestone}.\nYour working directory is: ${agentDir}\nOriginal request: ${path.join(teamworkRoot, 'ORIGINAL_REQUEST.md')}\nProject architecture & contracts: ${path.join(teamworkRoot, 'orchestrator_1', 'PROJECT.md')}\n\n### Exclusive Write Ownership\n- ${agentDir}\n`
  );

  writeIfMissing(
    path.join(agentDir, 'BRIEFING.md'),
    `# BRIEFING — ${nowIso}\n\n## Mission\n[Define mission for ${agentId}]\n\n## 🔒 My Identity\n- Archetype: ${archetype}\n- Working directory: ${agentDir}\n- Original parent: orchestrator_1\n- Milestone: ${milestone}\n\n## 🔒 Key Constraints\n- Adhere strictly to write boundaries in DISPATCH.md\n- MANDATORY INTEGRITY MANDATE: Genuine logic only, no hardcoded test shortcuts, no facades\n\n## Key Decisions Made\n- [Pending]\n\n## Artifact Index\n- ${path.join(agentDir, 'DISPATCH.md')}\n- ${path.join(agentDir, 'BRIEFING.md')}\n- ${path.join(agentDir, 'progress.md')}\n- ${path.join(agentDir, 'handoff.md')}\n`
  );

  writeIfMissing(
    path.join(agentDir, 'progress.md'),
    `# Progress — ${agentId}\n\n- [${nowIso}] Initialized workspace for ${agentId} (${archetype}).\n`
  );

  console.log(`Spawned workspace for ${agentId} (${archetype}) at: ${agentDir}`);
}

function cmdValidateHandoff() {
  const target = args[1];
  if (!target) {
    console.error('Usage: teamwork-cli.mjs validate-handoff <path-to-handoff.md>');
    process.exit(1);
  }

  const handoffPath = path.resolve(workdir, target);
  if (!fs.existsSync(handoffPath)) {
    console.error(`FAIL: Handoff file not found at ${handoffPath}`);
    process.exit(2);
  }

  const content = fs.readFileSync(handoffPath, 'utf8');
  const requiredSections = [
    { name: '1. Observation', regex: /^##\s+(?:1\.\s*)?Observation/im },
    { name: '2. Logic Chain', regex: /^##\s+(?:2\.\s*)?Logic Chain/im },
    { name: '3. Caveats', regex: /^##\s+(?:3\.\s*)?Caveats/im },
    { name: '4. Conclusion', regex: /^##\s+(?:4\.\s*)?Conclusion/im },
    { name: '5. Verification Method', regex: /^##\s+(?:5\.\s*)?Verification Method/im }
  ];

  const missing = requiredSections.filter((s) => !s.regex.test(content)).map((s) => s.name);
  const hasInvalidation = /Invalidation Condition/i.test(content);

  if (missing.length > 0 || !hasInvalidation) {
    console.error(`FAIL: Handoff validation failed for ${handoffPath}`);
    if (missing.length > 0) console.error(`  Missing sections: ${missing.join(', ')}`);
    if (!hasInvalidation) console.error('  Missing explicit "Invalidation Conditions" in Section 5.');
    process.exit(2);
  }

  console.log(`PASS: 5-Component Handoff verified (${handoffPath})`);
}

function walkFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'build', 'Library', 'Temp'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, result);
    } else {
      result.push(full);
    }
  }
  return result;
}

function cmdScanIntegrity() {
  const testDirArg = getFlag('--testdir', '');
  const searchRoot = testDirArg ? path.resolve(workdir, testDirArg) : workdir;
  const allFiles = walkFiles(searchRoot);
  const testFiles = allFiles.filter((f) =>
    /(?:test|spec)/i.test(path.basename(f)) &&
    /\.(?:cs|ts|tsx|js|jsx|py|go|rs|java)$/i.test(f) &&
    !f.includes(path.join('.agents', 'teamwork'))
  );

  const findings = [];

  for (const file of testFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      if (/\b(?:class|struct)\s+Mock[A-Za-z0-9_]+/.test(line)) {
        findings.push({
          file,
          line: lineNum,
          type: 'LOCAL_MOCK_CLASS',
          snippet: line.trim()
        });
      }
      if (/\b(?:Assert\.True\(\s*true\s*\)|expect\(\s*true\s*\)\.toBe\(\s*true\s*\)|assert\s+True\b)/.test(line)) {
        findings.push({
          file,
          line: lineNum,
          type: 'TAUTOLOGICAL_ASSERTION',
          snippet: line.trim()
        });
      }
      if (/\b(?:GetMock[A-Za-z0-9_]+\s*\()/.test(line)) {
        findings.push({
          file,
          line: lineNum,
          type: 'HARDCODED_MOCK_HELPER',
          snippet: line.trim()
        });
      }
    });
  }

  console.log(`Scanned ${testFiles.length} test files in ${searchRoot}.`);
  if (findings.length > 0) {
    console.log(`🔴 POTENTIAL INTEGRITY VIOLATIONS FOUND (${findings.length}):`);
    for (const f of findings) {
      console.log(`  - [${f.type}] ${path.relative(workdir, f.file)}:${f.line} -> ${f.snippet}`);
    }
    process.exit(2);
  } else {
    console.log('🟢 Zero obvious static tautologies or Mock class bypasses detected.');
  }
}

function cmdCheckGate() {
  const gatePath = path.join(teamworkRoot, 'orchestrator_1', 'GATE_STATUS.md');
  if (!fs.existsSync(gatePath)) {
    console.error(`FAIL: GATE_STATUS.md not found at ${gatePath}`);
    process.exit(2);
  }
  const content = fs.readFileSync(gatePath, 'utf8');
  const hasViolation = /INTEGRITY VIOLATION/i.test(content.split(/^##\s+Gate/im).pop() || '');
  const hasRequestChanges = /REQUEST_CHANGES/i.test(content.split(/^##\s+Gate/im).pop() || '');
  const hasClean = /\bCLEAN\b/i.test(content.split(/^##\s+Gate/im).pop() || '');

  if (hasViolation || hasRequestChanges || !hasClean) {
    console.error('🔴 GATE STATUS: FAIL (Requires 0 REQUEST_CHANGES and a CLEAN Forensic Audit in latest iteration)');
    process.exit(2);
  }
  console.log('🟢 GATE STATUS: PASS (All Reviewers/Challengers APPROVE + Forensic Auditor CLEAN)');
}

function cmdStatus() {
  if (!fs.existsSync(teamworkRoot)) {
    console.log(`No active Teamwork workspace found at ${teamworkRoot}.`);
    console.log('Run `/teamwork:craft` or `node scripts/teamwork-cli.mjs init` to start.');
    return;
  }

  console.log('# Teamwork Mission Dashboard\n');
  const entries = fs.readdirSync(teamworkRoot, { withFileTypes: true }).filter((e) => e.isDirectory());

  console.log('| Agent Workspace | BRIEFING | DISPATCH | Progress | Handoff |');
  console.log('|-----------------|:--------:|:--------:|:--------:|:-------:|');
  for (const dir of entries) {
    const p = path.join(teamworkRoot, dir.name);
    const hasBriefing = fs.existsSync(path.join(p, 'BRIEFING.md')) ? '✅' : '—';
    const hasDispatch = fs.existsSync(path.join(p, 'DISPATCH.md')) ? '✅' : '—';
    const hasProgress = fs.existsSync(path.join(p, 'progress.md')) ? '✅' : '—';
    const hasHandoff = fs.existsSync(path.join(p, 'handoff.md')) ? '✅' : '—';
    console.log(`| \`${dir.name}\` | ${hasBriefing} | ${hasDispatch} | ${hasProgress} | ${hasHandoff} |`);
  }

  const gatePath = path.join(teamworkRoot, 'orchestrator_1', 'GATE_STATUS.md');
  if (fs.existsSync(gatePath)) {
    console.log('\n## Latest Gate Status\n');
    console.log(fs.readFileSync(gatePath, 'utf8').trim());
  }
}

switch (command) {
  case 'init':
    cmdInit();
    break;
  case 'spawn':
    cmdSpawn();
    break;
  case 'validate-handoff':
    cmdValidateHandoff();
    break;
  case 'scan-integrity':
    cmdScanIntegrity();
    break;
  case 'check-gate':
    cmdCheckGate();
    break;
  case 'status':
  default:
    cmdStatus();
    break;
}
