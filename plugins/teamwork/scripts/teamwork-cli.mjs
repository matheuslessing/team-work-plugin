#!/usr/bin/env node
/**
 * Teamwork CLI v2.0 — LTS Harness, HASP, Swarm Board, Stall Monitor, Worktrees & Forensic Scanner
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHandoff } from './core/validator.mjs';
import { createChannel, getBoardStatus, postMessage, readBoard, registerBoardMember } from './lib/board.mjs';
import { scanProjectIntegrity } from './lib/forensic-scanner.mjs';
import { buildAndWriteView } from './lib/narrator-view.mjs';
import {
  detectEnvironment,
  getWatchdogPaths,
  getWatchdogStatus,
  persistRuntimeAndProvisionWorkflow,
  runWatchdogPulse,
  startWatchdogDaemon,
  stopWatchdogDaemon
} from './lib/runtime.mjs';
import { detectStalls } from './lib/stall-monitor.mjs';
import {
  checkBudget,
  createInitialState,
  evaluateLatestGate,
  freezeContract,
  getActiveOrchestrator,
  getTeamworkRoot,
  loadState,
  recordGateIteration,
  registerAgentScope,
  saveState,
  setOrchestratorGeneration,
  transitionPhase
} from './lib/state-machine.mjs';
import { createWorktree, mergeWorktree, pruneWorktree, worktreeDiff, worktreeStatus } from './lib/worktree.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, '..');

const BOOLEAN_FLAGS = new Set([
  '--no-write',
  '--copy-root-workflow',
  '--provision-workflow',
  '--start-watchdog',
  '--worktree',
  '--force',
  '--require-verdict',
  '--check-files',
  '--tests-only',
  '--json',
  '--strict',
  '--skip-gate',
  '--delete-branch',
  '--help',
  '-h'
]);

function parseCli(argv) {
  const positionals = [];
  const flags = new Map();
  const seenBool = new Set();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') {
      seenBool.add('-h');
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const k = a.slice(0, eq);
        const v = a.slice(eq + 1);
        if (BOOLEAN_FLAGS.has(k)) {
          if (v !== 'false' && v !== '0') seenBool.add(k);
        } else {
          flags.set(k, v);
        }
      } else if (BOOLEAN_FLAGS.has(a)) {
        seenBool.add(a);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags.set(a, argv[i + 1]);
        i += 1;
      } else {
        seenBool.add(a);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags, seenBool };
}

const cli = parseCli(process.argv.slice(2));
const command = cli.positionals[0] || 'status';

function getFlag(name, defaultValue = '') {
  return cli.flags.has(name) ? cli.flags.get(name) : defaultValue;
}

function hasFlag(name) {
  return cli.seenBool.has(name);
}

const workdir = path.resolve(getFlag('--workdir', process.env.DEVIN_PROJECT_DIR || process.cwd()));
const teamworkRoot = getTeamworkRoot(workdir);
const nowIso = new Date().toISOString();

function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

function archetypeToAuthority(archetype) {
  switch (String(archetype || '').toLowerCase()) {
    case 'explorer':
    case 'reviewer':
    case 'challenger':
      return 'read_only';
    case 'forensic-auditor':
    case 'forensic_auditor':
    case 'victory-auditor':
    case 'victory_auditor':
      return 'audit_only';
    case 'sentinel':
    case 'orchestrator':
      return 'dispatch_only';
    case 'test-writer':
    case 'test_writer':
      return 'test_writer';
    default:
      return 'scoped_worker';
  }
}

function cmdDetectEnv() {
  const envInfo = detectEnvironment(workdir, { explicitFlag: getFlag('--env', '') });
  persistRuntimeAndProvisionWorkflow(workdir, pluginRoot, __filename, envInfo, {
    persistFiles: !hasFlag('--no-write'),
    copyRootWorkflow: hasFlag('--copy-root-workflow'),
    forceProvision: hasFlag('--provision-workflow'),
    forceWatchdog: hasFlag('--start-watchdog')
  });
  const wdStatus = getWatchdogStatus(workdir);
  console.log(`[TEAMWORK RUNTIME AUTO-DETECTED: ${envInfo.runtime}]`);
  console.log(`- Signals: ${envInfo.signals.join(', ')}`);
  console.log(`- Primary Engine: ${envInfo.primaryEngine}`);
  console.log(`- Fallback Engine: ${envInfo.fallbackEngine}`);
  if (envInfo.runtime === 'DEVIN_CLOUD') {
    console.log(`- Provisioned Workflow: ${envInfo.workflowPath}`);
    console.log(`- 30-Min Watchdog: ${wdStatus.running ? `ACTIVE (PID ${wdStatus.pid})` : 'STANDBY'}`);
  }
}

function cmdInit() {
  const mode = getFlag('--mode', 'development');
  const envInfo = detectEnvironment(workdir, { explicitFlag: getFlag('--env', '') });
  fs.mkdirSync(teamworkRoot, { recursive: true });
  fs.mkdirSync(path.join(teamworkRoot, 'sentinel'), { recursive: true });
  fs.mkdirSync(path.join(teamworkRoot, 'orchestrator_1'), { recursive: true });

  persistRuntimeAndProvisionWorkflow(workdir, pluginRoot, __filename, envInfo, {
    persistFiles: true,
    copyRootWorkflow: hasFlag('--copy-root-workflow')
  });

  if (!fs.existsSync(path.join(teamworkRoot, 'state.json'))) {
    saveState(workdir, createInitialState(workdir, { mode, runtime: envInfo.runtime }));
  }

  writeIfMissing(
    path.join(teamworkRoot, 'ORIGINAL_REQUEST.md'),
    `# Original User Request\n\n## Initial Request — ${nowIso}\n\n[Project description]\n\nWorking directory: ${workdir}\nRuntime environment: ${envInfo.runtime}\nIntegrity mode: ${mode}\n\n## Requirements\n\n### R1. [Requirement 1]\n\n## Acceptance Criteria\n\n### Core Criteria\n- [ ] [Objective, checkable condition]\n`
  );

  writeIfMissing(
    path.join(teamworkRoot, 'sentinel', 'BRIEFING.md'),
    `# BRIEFING — ${nowIso}\n\n## Mission\nSupervise end-to-end execution via active orchestrator and mandatory victory auditor.\n\n## 🔒 My Identity\n- Archetype: sentinel\n- Authority Profile: dispatch_only\n- Runtime: ${envInfo.runtime}\n- Active Orchestrator: orchestrator_1\n\n## Victory Audit Status\n- **Triggered**: no\n- **Verdict**: pending\n- **Retry count**: 0\n`
  );

  writeIfMissing(
    path.join(teamworkRoot, 'orchestrator_1', 'BRIEFING.md'),
    `# BRIEFING — ${nowIso}\n\n## Mission\nOrchestrate Dual-Track delivery with frozen contracts and binary forensic gates.\n\n## 🔒 My Identity\n- Archetype: orchestrator\n- Authority Profile: dispatch_only\n- Runtime: ${envInfo.runtime}\n\n## 🔒 My Workflow\n1. Phase 0: Survey & Contract Freeze [in-progress]\n2. Phase 1: Dual-Track Execution [pending]\n3. Phase 2: Verification Gate [pending]\n4. Phase 3: Victory Audit [pending]\n`
  );

  writeIfMissing(path.join(teamworkRoot, 'orchestrator_1', 'progress.md'), `# Progress — orchestrator_1\n\n- [${nowIso}] Initialized orchestrator_1 (${envInfo.runtime}).\n`);
  writeIfMissing(path.join(teamworkRoot, 'orchestrator_1', 'DEAD_ENDS.md'), `# DEAD ENDS\n\n| Iteration | Approach Tried | Why It Failed | Files Touched |\n|-----------|---------------|---------------|---------------|\n`);
  writeIfMissing(path.join(teamworkRoot, 'orchestrator_1', 'GATE_STATUS.md'), `# Gate Status — Verification & Final Acceptance\n\n## Gate — Iteration 1\n| Agent | Role | Verdict | Source |\n|-------|------|---------|--------|\n\nGate Result: **PENDING**\n`);

  buildAndWriteView(workdir);
  console.log(`Initialized Teamwork v2.0 workspace at: ${teamworkRoot} (runtime=${envInfo.runtime})`);
}

function cmdWatchdog() {
  const sub = cli.positionals[1] || 'status';
  const rawWindow = Number(getFlag('--window-min', '30'));
  const rawInterval = Number(getFlag('--interval-min', '10'));
  const windowMin = Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : 30;
  const intervalMin = Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : 10;

  if (sub === 'start') {
    startWatchdogDaemon(workdir, __filename, windowMin, intervalMin, false);
  } else if (sub === 'stop') {
    stopWatchdogDaemon(workdir, false);
  } else if (sub === 'pulse') {
    runWatchdogPulse(workdir, windowMin, intervalMin);
    const stall = detectStalls(workdir, { staleMinutes: 10 });
    console.log(`[WATCH_DOG] Pulse recorded. Stall check: ${stall.stalled ? stall.recommended_action : 'OK'}`);
  } else if (sub === 'daemon') {
    const { pidPath } = getWatchdogPaths(workdir);
    const intervalMs = Math.max(1, intervalMin) * 60 * 1000;
    const maxRuntimeMs = 12 * 60 * 60 * 1000;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > maxRuntimeMs || !fs.existsSync(pidPath)) {
        clearInterval(timer);
        process.exit(0);
      }
      const state = loadState(workdir);
      if (state.phase === 'DONE' || state.phase === 'FAILED') {
        runWatchdogPulse(workdir, windowMin, intervalMin);
        stopWatchdogDaemon(workdir, true);
        clearInterval(timer);
        process.exit(0);
      }
      const activeOrch = getActiveOrchestrator(workdir);
      const sentinelHandoff = path.join(teamworkRoot, 'sentinel', 'handoff.md');
      const gateStatus = path.join(teamworkRoot, activeOrch.id, 'GATE_STATUS.md');
      if (
        fs.existsSync(sentinelHandoff) &&
        fs.existsSync(gateStatus) &&
        evaluateLatestGate(fs.readFileSync(gateStatus, 'utf8')).passed
      ) {
        runWatchdogPulse(workdir, windowMin, intervalMin);
        stopWatchdogDaemon(workdir, true);
        clearInterval(timer);
        process.exit(0);
      }
      runWatchdogPulse(workdir, windowMin, intervalMin);
    }, intervalMs);
  } else {
    const st = getWatchdogStatus(workdir);
    console.log(st.running ? `🟢 WATCH_DOG ACTIVE (PID ${st.pid})` : '⚪ WATCH_DOG INACTIVE');
  }
}

function cmdSpawn() {
  const agentId = cli.positionals[1];
  const archetype = cli.positionals[2] || 'worker';
  const milestone = getFlag('--milestone', 'TBD');
  const useWorktree = hasFlag('--worktree');
  const ownRaw = getFlag('--own', '');
  let ownGlobs = ownRaw ? ownRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const envInfo = detectEnvironment(workdir);

  if (!agentId) {
    console.error('Usage: teamwork-cli.mjs spawn <agent_id> <archetype> [--milestone <m>] [--own glob1,glob2] [--worktree]');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    console.error(`FAIL: Invalid agent_id "${agentId}". Must match ^[a-zA-Z0-9_-]+$.`);
    process.exit(2);
  }

  const budget = checkBudget(workdir);
  if (!budget.spawns_ok && !hasFlag('--force')) {
    console.error(`FAIL: Spawn budget exhausted (${budget.budgets.spawns_used}/${budget.budgets.max_spawns}). Trigger orchestrator succession first.`);
    process.exit(2);
  }

  const agentDir = path.join(teamworkRoot, agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  const activeOrch = getActiveOrchestrator(workdir);

  let worktreePath = null;
  let worktreeNote = '';
  if (useWorktree) {
    const wt = createWorktree(workdir, agentId);
    worktreePath = wt.wtDir;
    worktreeNote = `\n- Isolated Git Worktree: ${wt.wtDir} (branch: \`${wt.branch}\`)`;
  }

  const authorityProfile = archetypeToAuthority(archetype);
  if (authorityProfile === 'test_writer' && ownGlobs.length === 0) {
    ownGlobs = ['TEST_INFRA.md', 'TEST_READY.md', 'tests/**', '*test*', 'run[-_]tests*'];
  }
  registerAgentScope(workdir, {
    agentId,
    role: archetype,
    authorityProfile,
    allowedWriteGlobs: ownGlobs,
    worktreePath,
    status: 'active'
  });
  registerBoardMember(workdir, agentId, { role: archetype, channels: ['main', `#${milestone.toLowerCase()}`] });

  writeIfMissing(
    path.join(agentDir, 'DISPATCH.md'),
    `## ${nowIso}\nFrom: ${activeOrch.id}\nPriority: MESSAGE_PRIORITY_HIGH\nRuntime: ${envInfo.runtime}\nAuthority Profile: ${authorityProfile}\n\nAssigned \`${agentId}\` (${archetype}) for Milestone: ${milestone}.${worktreeNote}\n\n### Exclusive Write Ownership\n${[`.agents/teamwork/${agentId}/**`, ...ownGlobs].map((g) => `- ${g}`).join('\n')}\n`
  );

  writeIfMissing(
    path.join(agentDir, 'BRIEFING.md'),
    `# BRIEFING — ${nowIso}\n\n## Mission\n[Mission for ${agentId}]\n\n## 🔒 My Identity\n- Archetype: ${archetype}\n- Authority Profile: ${authorityProfile}\n- Working directory: ${agentDir}${worktreeNote}\n- Parent: ${activeOrch.id}\n- Milestone: ${milestone}\n`
  );

  writeIfMissing(path.join(agentDir, 'progress.md'), `# Progress — ${agentId}\n\n- [${nowIso}] Spawned (${archetype}, ${authorityProfile}).\n`);
  buildAndWriteView(workdir);
  console.log(`Spawned ${agentId} (${archetype}, profile=${authorityProfile}) at ${agentDir}${worktreeNote}`);
}

function cmdValidateHandoff() {
  const target = cli.positionals[1];
  if (!target) {
    console.error('Usage: teamwork-cli.mjs validate-handoff <path> [--require-verdict] [--check-files]');
    process.exit(1);
  }
  const handoffPath = path.resolve(workdir, target);
  if (!fs.existsSync(handoffPath)) {
    console.error(`FAIL: Handoff file not found at ${handoffPath}`);
    process.exit(2);
  }
  const res = validateHandoff(handoffPath, fs.readFileSync(handoffPath, 'utf8'), {
    requireVerdict: hasFlag('--require-verdict'),
    checkFiles: hasFlag('--check-files'),
    workspaceRoot: workdir
  });
  if (!res.ok) {
    console.error(`FAIL: Handoff validation failed for ${handoffPath}\n  - ${res.errors.join('\n  - ')}`);
    process.exit(2);
  }
  console.log(`PASS: 5-Component Handoff verified (${handoffPath})${res.verdict ? ` [Verdict: ${res.verdict}]` : ''}`);
}

function cmdScanIntegrity() {
  const report = scanProjectIntegrity({
    workdir,
    testdir: getFlag('--testdir', ''),
    checkProductionStubs: !hasFlag('--tests-only')
  });
  if (hasFlag('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Scanned ${report.scannedTestFiles} test(s), ${report.scannedRunnerFiles} runner(s), ${report.scannedProductionFiles} prod file(s).`);
    if (report.findings.length > 0) {
      console.log(`🔴 INTEGRITY_VIOLATION (${report.findings.length}):`);
      for (const f of report.findings) {
        console.log(`  - [${f.type}] ${f.file}:${f.line} — ${f.message}`);
      }
    } else {
      console.log('🟢 CLEAN — Zero forensic integrity violations detected.');
    }
  }
  if (report.verdict !== 'CLEAN' && (hasFlag('--strict') || report.findings.length > 0)) {
    process.exit(2);
  }
}

function cmdCheckGate() {
  const activeOrch = getActiveOrchestrator(workdir);
  const gatePath = path.join(teamworkRoot, activeOrch.id, 'GATE_STATUS.md');
  if (!fs.existsSync(gatePath)) {
    console.error(`FAIL: GATE_STATUS.md not found at ${gatePath}`);
    process.exit(2);
  }
  const gateEval = evaluateLatestGate(fs.readFileSync(gatePath, 'utf8'));
  if (!gateEval.passed) {
    console.error(`🔴 GATE STATUS (${activeOrch.id}): FAIL`);
    process.exit(2);
  }
  console.log(`🟢 GATE STATUS (${activeOrch.id}): PASS`);
}

function cmdCheckHeartbeat() {
  fs.mkdirSync(teamworkRoot, { recursive: true });
  const activeOrch = getActiveOrchestrator(workdir);
  const sessionId = getFlag('--session', process.env.DEVIN_SESSION_ID || 'local-session');
  const progressPath = path.join(teamworkRoot, activeOrch.id, 'progress.md');
  const sentinelProgressPath = path.join(teamworkRoot, 'sentinel', 'progress.md');

  let iter = 1;
  if (fs.existsSync(sentinelProgressPath)) {
    const matches = fs.readFileSync(sentinelProgressPath, 'utf8').match(/Iteração\s+(\d+)/g);
    if (matches?.length) {
      const lastNum = Number(matches[matches.length - 1].replace(/\D+/g, ''));
      if (!Number.isNaN(lastNum)) iter = lastNum + 1;
    }
  }
  runWatchdogPulse(workdir, 30, 10);

  let latestLine = 'initializing';
  if (fs.existsSync(progressPath)) {
    const lines = fs.readFileSync(progressPath, 'utf8').split(/\r?\n/).filter((l) => l.trim().startsWith('-'));
    if (lines.length) latestLine = lines[lines.length - 1].trim();
  }

  const msg = `Heartbeat confirmado (Iteração ${iter}): ${activeOrch.id} (${sessionId}) ativo atualizando o progress.md. Aguardando o próximo relatório de progresso.`;
  fs.mkdirSync(path.join(teamworkRoot, 'sentinel'), { recursive: true });
  fs.appendFileSync(sentinelProgressPath, `- [${new Date().toISOString()}] ${msg} | Último pulso: ${latestLine}\n`, 'utf8');
  console.log(msg);
}

function cmdSucceedOrchestrator() {
  const current = getActiveOrchestrator(workdir);
  const nextGen = current.gen + 1;
  const nextId = `orchestrator_${nextGen}`;
  const prevDir = path.join(teamworkRoot, current.id);
  const nextDir = path.join(teamworkRoot, nextId);
  fs.mkdirSync(nextDir, { recursive: true });

  for (const sharedFile of ['PROJECT.md', 'GATE_STATUS.md', 'DEAD_ENDS.md']) {
    const src = path.join(prevDir, sharedFile);
    const dst = path.join(nextDir, sharedFile);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
    }
  }

  writeIfMissing(
    path.join(nextDir, 'DISPATCH.md'),
    `## ${nowIso}\nFrom: sentinel\nPriority: MESSAGE_PRIORITY_HIGH\n\nSuccession Handoff from \`${current.id}\` to \`${nextId}\`.\nRead \`${current.id}/handoff.md\`, \`${nextId}/PROJECT.md\`, and \`${nextId}/GATE_STATUS.md\`.\n`
  );
  writeIfMissing(path.join(nextDir, 'BRIEFING.md'), `# BRIEFING — ${nowIso}\n\n## Mission\nContinue orchestration as ${nextId} (Generation ${nextGen}).\n`);
  writeIfMissing(path.join(nextDir, 'progress.md'), `# Progress — ${nextId}\n\n- [${nowIso}] Succeeded ${current.id}.\n`);

  setOrchestratorGeneration(workdir, nextId);

  const sentinelBriefing = path.join(teamworkRoot, 'sentinel', 'BRIEFING.md');
  if (fs.existsSync(sentinelBriefing)) {
    const updated = fs
      .readFileSync(sentinelBriefing, 'utf8')
      .replace(/-\s*(?:Active\s+)?Orchestrator:\s*orchestrator_\d+/i, `- Active Orchestrator: ${nextId}`);
    fs.writeFileSync(sentinelBriefing, updated, 'utf8');
  }
  buildAndWriteView(workdir);
  console.log(`Succeeded ${current.id} -> ${nextId} at ${nextDir}`);
}

function cmdState() {
  const sub = cli.positionals[1] || 'show';
  if (sub === 'transition') {
    const to = cli.positionals[2];
    if (!to) {
      console.error('Usage: teamwork-cli.mjs state transition <PHASE> [--reason <text>] [--force]');
      process.exit(1);
    }
    const reason = getFlag('--reason', '');
    const st = transitionPhase(workdir, to, { reason, force: hasFlag('--force') });
    buildAndWriteView(workdir);
    console.log(JSON.stringify({ phase: st.phase, active_orchestrator: st.active_orchestrator }, null, 2));
  } else if (sub === 'freeze-contract') {
    const res = freezeContract(workdir);
    buildAndWriteView(workdir);
    console.log(JSON.stringify(res, null, 2));
  } else if (sub === 'gate-record') {
    const iteration = Number(getFlag('--iteration', cli.positionals[2] || ''));
    const result = String(getFlag('--result', cli.positionals[3] || '')).toUpperCase();
    if (!Number.isInteger(iteration) || iteration < 1 || (result !== 'PASS' && result !== 'FAIL')) {
      console.error('Usage: teamwork-cli.mjs state gate-record --iteration <n>=1.. --result PASS|FAIL');
      process.exit(1);
    }
    const st = recordGateIteration(workdir, { iteration, result });
    buildAndWriteView(workdir);
    console.log(JSON.stringify({ iteration, result, gate_iterations: st.gate_iterations }, null, 2));
  } else {
    console.log(JSON.stringify(loadState(workdir), null, 2));
  }
}

function cmdBoard() {
  const sub = cli.positionals[1] || 'read';
  if (sub === 'post') {
    const entry = postMessage(workdir, {
      from: getFlag('--from', 'coordinator'),
      channel: getFlag('--channel', 'main'),
      text: getFlag('--text', cli.positionals.slice(2).join(' '))
    });
    buildAndWriteView(workdir);
    console.log(JSON.stringify(entry, null, 2));
  } else if (sub === 'channel-create') {
    const ch = createChannel(workdir, cli.positionals[2], getFlag('--topic', ''));
    console.log(JSON.stringify(ch, null, 2));
  } else if (sub === 'status') {
    console.log(JSON.stringify(getBoardStatus(workdir), null, 2));
  } else {
    const rawSince = Number(getFlag('--since', '0'));
    const entries = readBoard(workdir, {
      since: Number.isFinite(rawSince) ? rawSince : 0,
      channel: getFlag('--channel', null) || null,
      reader: getFlag('--reader', '') || null
    });
    console.log(JSON.stringify(entries, null, 2));
  }
}

function cmdWorktree() {
  const sub = cli.positionals[1] || 'status';
  if (sub === 'create') {
    console.log(JSON.stringify(createWorktree(workdir, cli.positionals[2]), null, 2));
  } else if (sub === 'diff') {
    console.log(JSON.stringify(worktreeDiff(workdir, cli.positionals[2]), null, 2));
  } else if (sub === 'merge') {
    console.log(JSON.stringify(mergeWorktree(workdir, cli.positionals[2], { requireGate: !hasFlag('--skip-gate') }), null, 2));
  } else if (sub === 'prune') {
    console.log(JSON.stringify(pruneWorktree(workdir, cli.positionals[2], { deleteBranch: hasFlag('--delete-branch') }), null, 2));
  } else {
    console.log(JSON.stringify(worktreeStatus(workdir), null, 2));
  }
}

function cmdStatus() {
  const activeOrch = getActiveOrchestrator(workdir);
  if (!fs.existsSync(teamworkRoot)) {
    console.log(`No active Teamwork workspace at ${teamworkRoot}. Run teamwork-cli.mjs init.`);
    return;
  }
  const { view } = buildAndWriteView(workdir);
  if (hasFlag('--json')) {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  console.log(`# Teamwork Dashboard — ${view.goal.title}`);
  console.log(`- **Phase**: \`${view.phase.label}\` (${view.phase.index}/${view.phase.total}) | **Orchestrator**: \`${activeOrch.id}\``);
  console.log(`- **Summary**: ${view.running_summary}`);
  console.log(`\n| Stream | State | Note |\n|--------|-------|------|`);
  for (const w of view.workstreams) {
    console.log(`| \`${w.title}\` | ${w.state} | ${w.note} |`);
  }
  if (view.attention.length > 0) {
    console.log('\n## Attention Queue');
    for (const a of view.attention) console.log(`- [${a.kind.toUpperCase()}] ${a.title}`);
  }
}

try {
  switch (command) {
    case 'detect-env':
      cmdDetectEnv();
      break;
    case 'init':
      cmdInit();
      break;
    case 'watchdog':
      cmdWatchdog();
      break;
    case 'check-heartbeat':
      cmdCheckHeartbeat();
      break;
    case 'succeed-orchestrator':
      cmdSucceedOrchestrator();
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
    case 'state':
      cmdState();
      break;
    case 'board':
      cmdBoard();
      break;
    case 'stall-check': {
      const rawStale = Number(getFlag('--stale-min', '10'));
      const staleMinutes = Number.isFinite(rawStale) && rawStale >= 0 ? rawStale : 10;
      console.log(JSON.stringify(detectStalls(workdir, { staleMinutes }), null, 2));
      break;
    }
    case 'view':
      console.log(JSON.stringify(buildAndWriteView(workdir).view, null, 2));
      break;
    case 'worktree':
      cmdWorktree();
      break;
    case 'status':
      if (hasFlag('--help') || hasFlag('-h')) {
        console.log('Usage: teamwork-cli.mjs <detect-env|init|watchdog|check-heartbeat|succeed-orchestrator|spawn|validate-handoff|scan-integrity|check-gate|state|board|stall-check|view|worktree|status> [options]');
        break;
      }
      cmdStatus();
      break;
    case 'help':
      console.log('Usage: teamwork-cli.mjs <detect-env|init|watchdog|check-heartbeat|succeed-orchestrator|spawn|validate-handoff|scan-integrity|check-gate|state|board|stall-check|view|worktree|status> [options]');
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(2);
  }
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exit(2);
}
