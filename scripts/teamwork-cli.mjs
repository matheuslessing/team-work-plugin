#!/usr/bin/env node
/**
 * Teamwork CLI Helper for Devin CLI & Devin Cloud Plugin
 * Supports:
 *   node scripts/teamwork-cli.mjs detect-env [--env <cloud|local>] [--workdir <dir>] [--copy-root-workflow]
 *   node scripts/teamwork-cli.mjs init [--workdir <dir>] [--mode <development|demo|benchmark>] [--env <cloud|local>]
 *   node scripts/teamwork-cli.mjs spawn <agent_id> <archetype> [--milestone <m>] [--workdir <dir>] [--worktree]
 *   node scripts/teamwork-cli.mjs validate-handoff <path-to-handoff.md>
 *   node scripts/teamwork-cli.mjs scan-integrity [--workdir <dir>] [--testdir <dir>]
 *   node scripts/teamwork-cli.mjs check-gate [--workdir <dir>]
 *   node scripts/teamwork-cli.mjs status [--workdir <dir>]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const command = args[0] || 'status';

function getFlag(name, defaultValue = '') {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}

function hasFlag(name) {
  return args.includes(name);
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

function detectEnvironment() {
  const explicitFlag = getFlag('--env', '').toLowerCase();
  const envOverride = (process.env.TEAMWORK_RUNTIME || '').toLowerCase();
  const runtimeJsonPath = path.join(teamworkRoot, 'RUNTIME_ENV.json');

  const signals = [];
  let pinnedRuntime = '';

  if (!explicitFlag && fs.existsSync(runtimeJsonPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(runtimeJsonPath, 'utf8'));
      if (saved.pinned && saved.runtime) {
        pinnedRuntime = saved.runtime;
        signals.push(`pinned_in_RUNTIME_ENV.json(${saved.runtime})`);
      }
    } catch {
      // ignore invalid JSON
    }
  }

  let hasDevinPythonSdk = false;
  try {
    execSync('python3 -c "import devin"', { stdio: 'pipe', timeout: 2500 });
    hasDevinPythonSdk = true;
    signals.push('python3_import_devin');
  } catch {
    // devin python package not installed in global python3
  }

  const cloudEnvVars = [
    'DEVIN_CLOUD',
    'DEVIN_SESSION_ID',
    'DEVIN_VM',
    'DEVIN_ORG_ID',
    'DEVIN_WORKFLOW',
    'DEVIN_ENVIRONMENT'
  ];
  for (const key of cloudEnvVars) {
    if (process.env[key]) {
      signals.push(`env:${key}`);
    }
  }

  const isLinuxUbuntuVm =
    process.platform === 'linux' &&
    (fs.existsSync('/home/ubuntu') || process.env.USER === 'ubuntu' || process.env.USER === 'devin');
  if (isLinuxUbuntuVm) {
    signals.push('linux_cloud_vm(/home/ubuntu)');
  }

  let runtime = 'DEVIN_CLI_LOCAL';
  let pinned = false;

  if (explicitFlag === 'cloud' || explicitFlag === 'devin_cloud') {
    runtime = 'DEVIN_CLOUD';
    pinned = true;
    signals.push('flag:--env=cloud');
  } else if (explicitFlag === 'local' || explicitFlag === 'cli' || explicitFlag === 'devin_cli_local') {
    runtime = 'DEVIN_CLI_LOCAL';
    pinned = true;
    signals.push('flag:--env=local');
  } else if (envOverride === 'cloud' || envOverride === 'devin_cloud') {
    runtime = 'DEVIN_CLOUD';
    signals.push('env:TEAMWORK_RUNTIME=cloud');
  } else if (envOverride === 'local' || envOverride === 'cli') {
    runtime = 'DEVIN_CLI_LOCAL';
    signals.push('env:TEAMWORK_RUNTIME=local');
  } else if (pinnedRuntime) {
    runtime = pinnedRuntime;
  } else if (signals.length > 0) {
    runtime = 'DEVIN_CLOUD';
  } else {
    signals.push(`platform:${process.platform}_local_cli`);
  }

  const workflowTarget = path.join(teamworkRoot, 'workflow.py');
  const isCloud = runtime === 'DEVIN_CLOUD';

  return {
    runtime,
    pinned,
    signals,
    hasDevinPythonSdk,
    workflowPath: workflowTarget,
    primaryEngine: isCloud
      ? 'Devin Dynamic Workflow (.agents/teamwork/workflow.py -> full | quick | survey | gate)'
      : 'Devin CLI Custom Subagents (teamwork:sentinel, teamwork:orchestrator, teamwork:explorer, teamwork:test-writer, teamwork:worker, teamwork:reviewer, teamwork:challenger, teamwork:forensic-auditor, teamwork:victory-auditor)',
    fallbackEngine: isCloud
      ? 'Managed Devins / Devin MCP (devin_session_create + devin_session_interact + devin_session_gather + devin_schedule_manage)'
      : 'Local Git Worktrees (node scripts/teamwork-cli.mjs spawn <id> <role> --worktree)'
  };
}

function persistRuntimeAndProvisionWorkflow(envInfo, persistFiles = true) {
  const sourceWorkflow = path.join(pluginRoot, 'skills', 'team-cloud-workflow', 'workflow.py');

  if (persistFiles) {
    ensureDir(teamworkRoot);

    if ((envInfo.runtime === 'DEVIN_CLOUD' || hasFlag('--provision-workflow')) && fs.existsSync(sourceWorkflow)) {
      fs.copyFileSync(sourceWorkflow, envInfo.workflowPath);
      if (hasFlag('--copy-root-workflow')) {
        fs.copyFileSync(sourceWorkflow, path.join(workdir, 'workflow.py'));
      }
    }

    fs.writeFileSync(
      path.join(teamworkRoot, 'RUNTIME_ENV.json'),
      JSON.stringify({ ...envInfo, updatedAt: nowIso }, null, 2),
      'utf8'
    );

    const runtimeMd = `# Teamwork Runtime Environment — ${nowIso}

- **Detected Runtime**: \`${envInfo.runtime}\`${envInfo.pinned ? ' (pinned override)' : ''}
- **Detection Signals**: ${envInfo.signals.map((s) => `\`${s}\``).join(', ')}
- **Primary Orchestration Engine**: ${envInfo.primaryEngine}
- **Fallback / Companion Engine**: ${envInfo.fallbackEngine}
- **Provisioned Cloud Workflow**: \`${fs.existsSync(envInfo.workflowPath) ? envInfo.workflowPath : 'not provisioned (CLI local)'}\`

## Mandatory Execution Directive
${
  envInfo.runtime === 'DEVIN_CLOUD'
    ? `1. **DO NOT wait for the user to remind you to use workflow.py or Managed Devins.**
2. **Primary Path (Dynamic Workflow)**: Execute \`.agents/teamwork/workflow.py\` using \`--mode full\` (for \`/team-run\`, \`/team-craft\`), \`--mode quick\` (for \`/team-quick\`), \`--mode survey\` (for \`/team-survey\`), or \`--mode gate\` (for \`/team-gate\`, \`/team-audit\`). Copy \`.agents/teamwork/workflow.py\` to \`./workflow.py\` only if the workflow runner requires root placement.
3. **Automatic Fallback (Managed Devins)**: If the Dynamic Workflow runner is not active in this session, immediately dispatch parallel child Devin sessions via \`devin_session_create\` + \`devin_session_gather\` (and set a cron heartbeat via \`devin_schedule_manage\`).`
    : `1. **Local CLI Mode Active**: Dispatch subagents using the custom profiles in \`agents/*.md\` (\`teamwork:sentinel\`, \`teamwork:orchestrator\`, \`teamwork:explorer\`, \`teamwork:test-writer\`, \`teamwork:worker\`, \`teamwork:reviewer\`, \`teamwork:challenger\`, \`teamwork:forensic-auditor\`, \`teamwork:victory-auditor\`).
2. **Worktree Isolation**: Use \`node "${path.join(pluginRoot, 'scripts', 'teamwork-cli.mjs')}" spawn <agent_id> <archetype> --milestone <M> --worktree\` when branch isolation is desired.`
}
`;
    fs.writeFileSync(path.join(teamworkRoot, 'RUNTIME_ENV.md'), runtimeMd, 'utf8');
  }
}

function cmdDetectEnv() {
  const envInfo = detectEnvironment();
  const shouldPersist = !hasFlag('--no-write');
  persistRuntimeAndProvisionWorkflow(envInfo, shouldPersist);

  console.log(`[TEAMWORK RUNTIME AUTO-DETECTED: ${envInfo.runtime}]`);
  console.log(`- Signals: ${envInfo.signals.join(', ')}`);
  console.log(`- Primary Engine: ${envInfo.primaryEngine}`);
  console.log(`- Fallback Engine: ${envInfo.fallbackEngine}`);
  if (envInfo.runtime === 'DEVIN_CLOUD') {
    console.log(`- Provisioned Workflow: ${envInfo.workflowPath}`);
    console.log(
      `ACTION REQUIRED: Automatically run Dynamic Workflow (.agents/teamwork/workflow.py --mode <full|quick|survey|gate>) or fallback to Managed Devins (devin_session_create / devin_session_gather) WITHOUT asking the user.`
    );
  }
}

function cmdInit() {
  const mode = getFlag('--mode', 'development');
  const envInfo = detectEnvironment();
  ensureDir(teamworkRoot);
  ensureDir(path.join(teamworkRoot, 'sentinel'));
  ensureDir(path.join(teamworkRoot, 'orchestrator_1'));

  persistRuntimeAndProvisionWorkflow(envInfo, true);

  writeIfMissing(
    path.join(teamworkRoot, 'ORIGINAL_REQUEST.md'),
    `# Original User Request\n\n## Initial Request — ${nowIso}\n\n[Project description]\n\nWorking directory: ${workdir}\nRuntime environment: ${envInfo.runtime}\nIntegrity mode: ${mode}\n\n## Requirements\n\n### R1. [Requirement 1]\n\n## Acceptance Criteria\n\n### Core Criteria\n- [ ] [Objective, checkable condition]\n`
  );

  writeIfMissing(
    path.join(teamworkRoot, 'sentinel', 'BRIEFING.md'),
    `# BRIEFING — ${nowIso}\n\n## Mission\nSupervise end-to-end execution of the project via project orchestrator and mandatory victory auditor.\n\n## 🔒 My Identity\n- Archetype: sentinel\n- Runtime environment: ${envInfo.runtime}\n- Primary Engine: ${envInfo.primaryEngine}\n- Working directory: ${path.join(teamworkRoot, 'sentinel')}\n- Orchestrator: orchestrator_1\n- Victory Auditor: to be spawned on victory claim\n\n## 🔒 Key Constraints\n- No technical decisions — relay only\n- Victory Audit is MANDATORY before reporting completion\n- Must not write production code\n\n## Victory Audit Status\n- **Triggered**: no\n- **Verdict**: pending\n- **Retry count**: 0\n`
  );

  writeIfMissing(
    path.join(teamworkRoot, 'orchestrator_1', 'BRIEFING.md'),
    `# BRIEFING — ${nowIso}\n\n## Mission\nOrchestrate the project ensuring 100% acceptance criteria pass.\n\n## 🔒 My Identity\n- Archetype: orchestrator\n- Runtime environment: ${envInfo.runtime}\n- Primary Engine: ${envInfo.primaryEngine}\n- Fallback Engine: ${envInfo.fallbackEngine}\n- Roles: orchestrator, user_liaison, human_reporter, successor\n- Working directory: ${path.join(teamworkRoot, 'orchestrator_1')}\n- Original parent: Sentinel\n\n## 🔒 My Workflow\n- **Pattern**: Project Pattern (Dual Track: Implementation Track + E2E Testing Track)\n- **Scope document**: ${path.join(teamworkRoot, 'orchestrator_1', 'PROJECT.md')}\n- **Cloud Workflow**: ${path.join(teamworkRoot, 'workflow.py')}\n- **Work items**:\n  1. Phase 0: Survey and Scope Mapping [in-progress]\n  2. E2E Testing Track Setup [pending]\n  3. Implementation Milestones [pending]\n  4. Final Milestone E2E, Adversarial Hardening & Forensic Audit [pending]\n\n## 🔒 Key Constraints\n- Dispatch-only orchestrator: NEVER write source code, delegate all investigation/code/testing.\n- Zero tolerance for cheating/integrity violations (Auditor has binary veto).\n- Never reuse a subagent after it has delivered its handoff — always spawn fresh.\n\n## Team Roster\n| Agent | Type | Work Item | Status |\n|-------|------|-----------|--------|\n`
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
  console.log(`Detected Runtime: ${envInfo.runtime} (${envInfo.primaryEngine})`);
  if (fs.existsSync(envInfo.workflowPath)) {
    console.log(`Provisioned Cloud Dynamic Workflow at: ${envInfo.workflowPath}`);
  }
}

function cmdSpawn() {
  const agentId = args[1];
  const archetype = args[2] || 'worker';
  const milestone = getFlag('--milestone', 'TBD');
  const useWorktree = hasFlag('--worktree');
  const envInfo = detectEnvironment();

  if (!agentId) {
    console.error('Usage: teamwork-cli.mjs spawn <agent_id> <archetype> [--milestone <m>] [--worktree]');
    process.exit(1);
  }

  const agentDir = path.join(teamworkRoot, agentId);
  ensureDir(agentDir);

  let worktreeInfo = '';
  if (useWorktree) {
    const wtDir = path.join(agentDir, 'worktree');
    const branchName = `teamwork/${agentId}`;
    try {
      if (!fs.existsSync(wtDir)) {
        execSync(`git worktree add "${wtDir}" -b "${branchName}"`, { cwd: workdir, stdio: 'pipe' });
      }
      worktreeInfo = `\n- Isolated Git Worktree: ${wtDir} (branch: \`${branchName}\`)`;
    } catch (err) {
      worktreeInfo = `\n- Worktree note: could not create git worktree (${err.message.split('\n')[0]})`;
    }
  }

  writeIfMissing(
    path.join(agentDir, 'DISPATCH.md'),
    `## ${nowIso}\nFrom: orchestrator_1\nPriority: MESSAGE_PRIORITY_HIGH\nRuntime: ${envInfo.runtime}\n\nYou are assigned as \`${agentId}\` (Archetype: \`${archetype}\`) for Milestone: ${milestone}.\nYour working directory is: ${agentDir}${worktreeInfo}\nOriginal request: ${path.join(teamworkRoot, 'ORIGINAL_REQUEST.md')}\nProject architecture & contracts: ${path.join(teamworkRoot, 'orchestrator_1', 'PROJECT.md')}\n\n### Exclusive Write Ownership\n- ${agentDir}\n`
  );

  writeIfMissing(
    path.join(agentDir, 'BRIEFING.md'),
    `# BRIEFING — ${nowIso}\n\n## Mission\n[Define mission for ${agentId}]\n\n## 🔒 My Identity\n- Archetype: ${archetype}\n- Runtime: ${envInfo.runtime}\n- Working directory: ${agentDir}${worktreeInfo}\n- Original parent: orchestrator_1\n- Milestone: ${milestone}\n\n## 🔒 Key Constraints\n- Adhere strictly to write boundaries in DISPATCH.md\n- MANDATORY INTEGRITY MANDATE: Genuine logic only, no hardcoded test shortcuts, no facades\n\n## Key Decisions Made\n- [Pending]\n\n## Artifact Index\n- ${path.join(agentDir, 'DISPATCH.md')}\n- ${path.join(agentDir, 'BRIEFING.md')}\n- ${path.join(agentDir, 'progress.md')}\n- ${path.join(agentDir, 'handoff.md')}\n`
  );

  writeIfMissing(
    path.join(agentDir, 'progress.md'),
    `# Progress — ${agentId}\n\n- [${nowIso}] Initialized workspace for ${agentId} (${archetype}) under ${envInfo.runtime}.\n`
  );

  console.log(`Spawned workspace for ${agentId} (${archetype}) [${envInfo.runtime}] at: ${agentDir}${worktreeInfo}`);
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
  const envInfo = detectEnvironment();
  console.log('# Teamwork Mission Dashboard\n');
  console.log(`- **Active Runtime**: \`${envInfo.runtime}\` (${envInfo.signals.join(', ')})`);
  console.log(`- **Primary Engine**: ${envInfo.primaryEngine}`);
  console.log(`- **Fallback Engine**: ${envInfo.fallbackEngine}`);
  console.log(
    `- **Cloud Workflow (\`.agents/teamwork/workflow.py\`)**: ${
      fs.existsSync(envInfo.workflowPath) ? '✅ Provisioned' : '— Not provisioned'
    }\n`
  );

  if (!fs.existsSync(teamworkRoot)) {
    console.log(`No active Teamwork workspace found at ${teamworkRoot}.`);
    console.log('Run `/team-craft` or `node scripts/teamwork-cli.mjs init` to start.');
    return;
  }

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
  case 'detect-env':
    cmdDetectEnv();
    break;
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
