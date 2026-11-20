#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatHookOutput, runProgramFunctions } from './core/hasp-runner.mjs';
import { detectEnvironment, getWatchdogStatus, startWatchdogDaemon } from './lib/runtime.mjs';
import { getActiveOrchestrator, getTeamworkRoot, loadState } from './lib/state-machine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, '..');
const cliScriptPath = path.join(__dirname, 'teamwork-cli.mjs');
const programsDir = path.join(pluginRoot, 'programs');

function getFlag(args, name, def = '') {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : def;
}

function readStdinSafe() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseAction(stdinObj, event) {
  const tc = stdinObj.toolCall || stdinObj.tool_call || {};
  return {
    event,
    tool: tc.name || stdinObj.tool_name || stdinObj.tool || '',
    args: tc.args || stdinObj.tool_input || stdinObj.args || {},
    error: stdinObj.error || stdinObj.toolError || '',
    agentId: stdinObj.agentId || process.env.TEAMWORK_AGENT_ID || ''
  };
}

function buildCompactDigest(workdir) {
  const twRoot = getTeamworkRoot(workdir);
  if (!fs.existsSync(twRoot)) return '';
  const state = loadState(workdir);
  const activeOrch = getActiveOrchestrator(workdir);
  const parts = [
    `[TEAMWORK STATE DIGEST]`,
    `- Phase: ${state.phase} | Active Orchestrator: ${activeOrch.id} | Contract SHA: ${state.contract_sha256 ? state.contract_sha256.slice(0, 12) : 'unfrozen'}`,
    `- Budgets: spawns ${state.budgets?.spawns_used || 0}/${state.budgets?.max_spawns || 16}, remediations ${state.budgets?.remediations_used || 0}/${state.budgets?.max_remediations || 3}`
  ];

  const origPath = path.join(twRoot, 'ORIGINAL_REQUEST.md');
  if (fs.existsSync(origPath)) {
    parts.push(`- ORIGINAL_REQUEST: ${fs.readFileSync(origPath, 'utf8').slice(0, 450).replace(/\s+/g, ' ')}`);
  }

  const gatePath = path.join(twRoot, activeOrch.id, 'GATE_STATUS.md');
  if (fs.existsSync(gatePath)) {
    const latestGate = fs.readFileSync(gatePath, 'utf8').split(/^##\s+Gate/im).pop() || '';
    parts.push(`- Latest Gate: ${latestGate.slice(0, 450).replace(/\s+/g, ' ')}`);
  }

  const viewPath = path.join(twRoot, 'view.json');
  if (fs.existsSync(viewPath)) {
    try {
      const view = JSON.parse(fs.readFileSync(viewPath, 'utf8'));
      parts.push(`- Summary: ${view.running_summary || view.headline}`);
    } catch {
      // ignore
    }
  }

  return parts.join('\n').slice(0, 2000);
}

async function main() {
  const args = process.argv.slice(2);
  const event = args[0] || 'UserPromptSubmit';
  const adapter = getFlag(args, '--adapter', process.env.ANTIGRAVITY_CLI ? 'antigravity' : 'devin');
  const rawStdin = readStdinSafe();
  let stdinObj = {};
  if (rawStdin.trim()) {
    try {
      stdinObj = JSON.parse(rawStdin);
    } catch {
      stdinObj = {};
    }
  }

  const workdir = path.resolve(
    getFlag(args, '--workdir', '') ||
      stdinObj.cwd ||
      (Array.isArray(stdinObj.workspacePaths) ? stdinObj.workspacePaths[0] : '') ||
      process.env.DEVIN_PROJECT_DIR ||
      process.cwd()
  );

  if (event === 'SessionStart' || event === 'UserPromptSubmit') {
    const envInfo = detectEnvironment(workdir);
    const hasActiveMission = fs.existsSync(path.join(getTeamworkRoot(workdir), 'state.json'));
    if (envInfo.runtime === 'DEVIN_CLOUD' && hasActiveMission) {
      const wd = getWatchdogStatus(workdir);
      if (!wd.running) {
        startWatchdogDaemon(workdir, cliScriptPath, 30, 10, true);
      }
    }
    const msg =
      envInfo.runtime === 'DEVIN_CLOUD'
        ? hasActiveMission
          ? `[TEAMWORK RUNTIME: DEVIN_CLOUD | 30m WATCH_DOG ACTIVE] Execute .agents/teamwork/workflow.py (--mode full|quick|survey|gate) or Managed Devins + devin_schedule_manage (*/20 * * * *).`
          : `[TEAMWORK RUNTIME: DEVIN_CLOUD | STANDBY (run teamwork-cli.mjs init to activate 30m WATCH_DOG)] Use /team-craft or /team-run to start a mission.`
        : `[TEAMWORK RUNTIME: ${adapter === 'antigravity' ? 'ANTIGRAVITY' : 'DEVIN_CLI_LOCAL'}] Active orchestrator: ${getActiveOrchestrator(workdir).id}. HASP guardrails & Skill-BOM active.`;

    const out = formatHookOutput({
      adapter,
      event,
      result: { decision: 'ALLOW', additionalContext: msg }
    });
    console.log(JSON.stringify(out.json));
    process.exit(out.exitCode);
  }

  if (event === 'PostCompaction') {
    const digest = buildCompactDigest(workdir);
    const out = formatHookOutput({
      adapter,
      event,
      result: { decision: 'ALLOW', additionalContext: digest }
    });
    console.log(JSON.stringify(out.json));
    process.exit(out.exitCode);
  }

  const teamworkState = loadState(workdir);
  const action = parseAction(stdinObj, event);
  const activeAgentId = action.agentId || '';
  let activeScope = activeAgentId ? teamworkState.active_agent_scopes?.[activeAgentId] || null : null;

  if (!activeScope && process.env.TEAMWORK_AUTHORITY_PROFILE) {
    activeScope = {
      role: process.env.TEAMWORK_ROLE || 'agent',
      authority_profile: process.env.TEAMWORK_AUTHORITY_PROFILE,
      allowed_write_globs: (process.env.TEAMWORK_ALLOWED_GLOBS || '').split(',').filter(Boolean),
      status: 'active'
    };
  }

  const bomPath = fs.existsSync(getTeamworkRoot(workdir))
    ? path.join(getTeamworkRoot(workdir), 'skill-bom.json')
    : null;

  const result = await runProgramFunctions({
    programsDir,
    event,
    state: {
      workdir,
      activeAgentId,
      activeScope,
      teamworkState,
      activeOrchestrator: getActiveOrchestrator(workdir)
    },
    action,
    bomPath
  });

  const out = formatHookOutput({
    adapter,
    event,
    result,
    continuationActive: Boolean(stdinObj.continuationActive)
  });
  console.log(JSON.stringify(out.json));
  if (out.exitCode === 2) {
    const errMsg = out.json?.reason || result?.reason || 'Blocked by HASP guardrail.';
    process.stderr.write(`${errMsg}\n`);
  }
  process.exit(out.exitCode);
}

main().catch((err) => {
  console.error(`[teamwork hooks-engine] Error: ${err.message}`);
  console.log('{}');
  process.exit(0);
});
