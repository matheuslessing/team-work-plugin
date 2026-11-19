#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatHookOutput, runProgramFunctions } from './core/hasp-runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, '..');
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
    error: stdinObj.error || stdinObj.toolError || ''
  };
}

async function main() {
  const args = process.argv.slice(2);
  const event = args[0] || 'PreToolUse';
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

  const action = parseAction(stdinObj, event);
  const bomPath = fs.existsSync(path.join(workdir, '.memory'))
    ? path.join(workdir, '.memory', '.cache', 'forge-bom.json')
    : null;

  const result = await runProgramFunctions({
    programsDir,
    event,
    state: { workdir },
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
  process.exit(out.exitCode);
}

main().catch((err) => {
  console.error(`[harness-forge hooks-engine] Error: ${err.message}`);
  console.log('{}');
  process.exit(0);
});
