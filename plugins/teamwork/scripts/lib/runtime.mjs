import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getActiveOrchestrator, getTeamworkRoot } from './state-machine.mjs';

export function isPidAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export function getWatchdogPaths(workdir) {
  const twRoot = getTeamworkRoot(workdir);
  return {
    twRoot,
    pidPath: path.join(twRoot, 'watchdog.pid'),
    jsonPath: path.join(twRoot, 'watchdog.json'),
    logPath: path.join(twRoot, 'watchdog.log')
  };
}

export function getWatchdogStatus(workdir) {
  const { pidPath, jsonPath } = getWatchdogPaths(workdir);
  if (!fs.existsSync(pidPath)) {
    return { running: false, pid: null, config: null };
  }
  const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
  const alive = isPidAlive(pid);
  let config = null;
  if (fs.existsSync(jsonPath)) {
    try {
      config = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {
      // ignore invalid json
    }
  }
  return { running: alive, pid: alive ? pid : null, config };
}

export function runWatchdogPulse(workdir, windowMin = 30, intervalMin = 10) {
  const { twRoot, jsonPath, logPath } = getWatchdogPaths(workdir);
  fs.mkdirSync(twRoot, { recursive: true });
  const ts = new Date().toISOString();
  let sysSummary = `load=${os.loadavg().map((n) => n.toFixed(2)).join(',')} uptime=${Math.round(os.uptime())}s`;
  try {
    const gitOut = execSync('git status --short', { cwd: workdir, stdio: 'pipe', timeout: 4000 })
      .toString()
      .trim();
    const changedCount = gitOut ? gitOut.split(/\r?\n/).length : 0;
    sysSummary += ` changed_files=${changedCount}`;
  } catch {
    // ignore if not a git repo
  }

  const activeOrch = getActiveOrchestrator(workdir);
  const logLine = `[${ts}] [WATCH_DOG 30m KEEP-ALIVE] ${activeOrch.id} active (window=${windowMin}m, pulse=${intervalMin}m, pid=${process.pid}) | ${sysSummary}\n`;
  fs.appendFileSync(logPath, logLine, 'utf8');

  const orchProgress = path.join(twRoot, activeOrch.id, 'progress.md');
  if (fs.existsSync(orchProgress)) {
    fs.appendFileSync(
      orchProgress,
      `- [${ts}] [WATCH_DOG ${windowMin}m] ${activeOrch.id} VM keep-alive heartbeat (${sysSummary}).\n`,
      'utf8'
    );
  }

  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      data.lastPulseAt = ts;
      data.pulseCount = (data.pulseCount || 0) + 1;
      data.activeOrchestrator = activeOrch.id;
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }
}

export function startWatchdogDaemon(workdir, cliScriptPath, windowMin = 30, intervalMin = 10, quiet = false) {
  const { twRoot, pidPath, jsonPath } = getWatchdogPaths(workdir);
  fs.mkdirSync(twRoot, { recursive: true });
  const current = getWatchdogStatus(workdir);
  if (current.running) {
    if (!quiet) {
      console.log(`[WATCH_DOG] Already running (PID ${current.pid}, window=${windowMin}m, pulse=${intervalMin}m).`);
    }
    return current;
  }

  const child = spawn(
    process.execPath,
    [
      cliScriptPath,
      'watchdog',
      'daemon',
      '--workdir',
      workdir,
      '--window-min',
      String(windowMin),
      '--interval-min',
      String(intervalMin)
    ],
    {
      cwd: workdir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }
  );
  if (!child.pid) {
    return { running: false, pid: null, config: null };
  }
  child.unref();

  const meta = {
    pid: child.pid,
    windowMinutes: windowMin,
    intervalMinutes: intervalMin,
    startedAt: new Date().toISOString(),
    lastPulseAt: new Date().toISOString(),
    pulseCount: 0,
    workdir
  };
  fs.writeFileSync(pidPath, String(child.pid), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2), 'utf8');
  runWatchdogPulse(workdir, windowMin, intervalMin);
  try {
    Object.assign(meta, JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
  } catch {
    meta.pulseCount = 1;
  }

  if (!quiet) {
    console.log(`[WATCH_DOG] Started 30-min Orchestrator VM keep-alive daemon (PID ${child.pid}, window=${windowMin}m, pulse=${intervalMin}m).`);
  }
  return { running: true, pid: child.pid, config: meta };
}

export function stopWatchdogDaemon(workdir, quiet = false) {
  const { pidPath } = getWatchdogPaths(workdir);
  const current = getWatchdogStatus(workdir);
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
  if (current.running && current.pid && current.pid !== process.pid) {
    try {
      process.kill(current.pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
  if (!quiet) {
    console.log('[WATCH_DOG] Stopped Orchestrator VM keep-alive daemon.');
  }
}

export function detectEnvironment(workdir, { explicitFlag = '' } = {}) {
  const twRoot = getTeamworkRoot(workdir);
  const runtimeJsonPath = path.join(twRoot, 'RUNTIME_ENV.json');
  const flag = String(explicitFlag || '').toLowerCase();
  const envOverride = (process.env.TEAMWORK_RUNTIME || '').toLowerCase();

  const signals = [];
  let pinnedRuntime = '';

  if (!flag && fs.existsSync(runtimeJsonPath)) {
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

  for (const key of ['DEVIN_CLOUD', 'DEVIN_SESSION_ID', 'DEVIN_VM', 'DEVIN_ORG_ID', 'DEVIN_WORKFLOW', 'DEVIN_ENVIRONMENT']) {
    if (process.env[key]) signals.push(`env:${key}`);
  }
  const hasDevinEnv = signals.some((s) => s.startsWith('env:DEVIN_'));

  if (process.env.ANTIGRAVITY_CLI || process.env.ANTIGRAVITY_SESSION_ID) {
    signals.push('env:ANTIGRAVITY');
  }

  const hasOptDevin = process.platform === 'linux' && fs.existsSync('/opt/.devin');
  if (hasOptDevin) {
    signals.push('linux_opt_devin(/opt/.devin)');
  }

  const hasExplicitResolution = Boolean(
    flag === 'cloud' ||
      flag === 'devin_cloud' ||
      flag === 'local' ||
      flag === 'cli' ||
      flag === 'devin_cli_local' ||
      flag === 'antigravity' ||
      envOverride === 'cloud' ||
      envOverride === 'devin_cloud' ||
      envOverride === 'local' ||
      envOverride === 'cli' ||
      envOverride === 'devin_cli_local' ||
      envOverride === 'antigravity' ||
      pinnedRuntime
  );

  let hasDevinPythonSdk = false;
  if (!hasExplicitResolution && !hasDevinEnv && !hasOptDevin) {
    try {
      execSync('python3 -c "import devin"', { stdio: 'pipe', timeout: 2000 });
      hasDevinPythonSdk = true;
      signals.push('python3_import_devin');
    } catch {
      // not installed
    }
  }

  if (
    process.platform === 'linux' &&
    (fs.existsSync('/home/ubuntu') || process.env.USER === 'ubuntu' || process.env.USER === 'devin') &&
    (hasOptDevin || hasDevinEnv || hasDevinPythonSdk)
  ) {
    signals.push('linux_cloud_vm(/home/ubuntu)');
  }

  const hasCloudSignals = signals.some(
    (s) => s.startsWith('env:DEVIN_') || s.startsWith('linux_') || s === 'python3_import_devin'
  );
  const hasAgySignals = signals.includes('env:ANTIGRAVITY');

  let runtime = 'DEVIN_CLI_LOCAL';
  let pinned = false;

  if (flag === 'cloud' || flag === 'devin_cloud') {
    runtime = 'DEVIN_CLOUD';
    pinned = true;
    signals.push('flag:--env=cloud');
  } else if (flag === 'local' || flag === 'cli' || flag === 'devin_cli_local') {
    runtime = 'DEVIN_CLI_LOCAL';
    pinned = true;
    signals.push('flag:--env=local');
  } else if (flag === 'antigravity') {
    runtime = 'ANTIGRAVITY';
    pinned = true;
    signals.push('flag:--env=antigravity');
  } else if (envOverride === 'cloud' || envOverride === 'devin_cloud') {
    runtime = 'DEVIN_CLOUD';
    signals.push('env:TEAMWORK_RUNTIME=cloud');
  } else if (envOverride === 'local' || envOverride === 'cli' || envOverride === 'devin_cli_local') {
    runtime = 'DEVIN_CLI_LOCAL';
    signals.push('env:TEAMWORK_RUNTIME=local');
  } else if (envOverride === 'antigravity') {
    runtime = 'ANTIGRAVITY';
    signals.push('env:TEAMWORK_RUNTIME=antigravity');
  } else if (pinnedRuntime) {
    runtime = pinnedRuntime;
    pinned = true;
  } else if (hasCloudSignals) {
    runtime = 'DEVIN_CLOUD';
  } else if (hasAgySignals) {
    runtime = 'ANTIGRAVITY';
  } else {
    signals.push(`platform:${process.platform}_local_cli`);
  }

  const workflowTarget = path.join(twRoot, 'workflow.py');
  const isCloud = runtime === 'DEVIN_CLOUD';
  const primaryEngine = isCloud
    ? 'Devin Dynamic Workflow (.agents/teamwork/workflow.py -> full | quick | survey | gate)'
    : runtime === 'ANTIGRAVITY'
      ? 'Antigravity Native Subagents & Swarm Board (.agents/teamwork/board.jsonl)'
      : 'Devin CLI Custom Subagents + Local Git Worktrees';

  return {
    runtime,
    pinned,
    signals,
    hasDevinPythonSdk,
    workflowPath: workflowTarget,
    watchdogWindowMinutes: 30,
    watchdogPulseMinutes: 10,
    primaryEngine,
    fallbackEngine: isCloud
      ? 'Managed Devins / Devin MCP (devin_session_create + devin_session_gather + devin_schedule_manage)'
      : 'Antigravity / Swarm Board (.agents/teamwork/board.jsonl)'
  };
}

export function persistRuntimeAndProvisionWorkflow(workdir, pluginRoot, cliScriptPath, envInfo, { persistFiles = true, copyRootWorkflow = false, forceProvision = false, forceWatchdog = false } = {}) {
  if (!persistFiles) return;
  const twRoot = getTeamworkRoot(workdir);
  const sourceWorkflow = path.join(pluginRoot, 'skills', 'team-cloud-workflow', 'workflow.py');
  fs.mkdirSync(twRoot, { recursive: true });

  if ((envInfo.runtime === 'DEVIN_CLOUD' || forceProvision) && fs.existsSync(sourceWorkflow)) {
    fs.copyFileSync(sourceWorkflow, envInfo.workflowPath);
    if (copyRootWorkflow) {
      fs.copyFileSync(sourceWorkflow, path.join(workdir, 'workflow.py'));
    }
  }

  if (envInfo.runtime === 'DEVIN_CLOUD' || forceWatchdog) {
    startWatchdogDaemon(workdir, cliScriptPath, envInfo.watchdogWindowMinutes, envInfo.watchdogPulseMinutes, true);
  }

  const wdStatus = getWatchdogStatus(workdir);
  const nowIso = new Date().toISOString();

  fs.writeFileSync(
    path.join(twRoot, 'RUNTIME_ENV.json'),
    JSON.stringify({ ...envInfo, watchdog: wdStatus, updatedAt: nowIso }, null, 2),
    'utf8'
  );

  const runtimeMd = `# Teamwork Runtime Environment — ${nowIso}

- **Detected Runtime**: \`${envInfo.runtime}\`${envInfo.pinned ? ' (pinned)' : ''}
- **Signals**: ${envInfo.signals.map((s) => `\`${s}\``).join(', ')}
- **Primary Engine**: ${envInfo.primaryEngine}
- **Fallback Engine**: ${envInfo.fallbackEngine}
- **Cloud Workflow**: \`${fs.existsSync(envInfo.workflowPath) ? envInfo.workflowPath : 'standby'}\`
- **30-Min Watchdog**: ${wdStatus.running ? `ACTIVE (PID ${wdStatus.pid})` : 'Standby'}
`;
  fs.writeFileSync(path.join(twRoot, 'RUNTIME_ENV.md'), runtimeMd, 'utf8');
}
