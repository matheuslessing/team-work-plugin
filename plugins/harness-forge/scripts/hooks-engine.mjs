#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractCommand,
  extractTargetPath,
  formatHookOutput,
  resolveEffectiveWorkdir,
  runProgramFunctions
} from './core/hasp-runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, '..');
const programsDir = path.join(pluginRoot, 'programs');

function getFlag(args, name, def = '') {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
  }
  return def;
}

async function readStdinAsync() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseArgsObject(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawArgs === 'object' ? rawArgs : {};
}

function parseAction(stdinObj, event) {
  const tc = stdinObj.toolCall || stdinObj.tool_call || {};
  return {
    event,
    tool: tc.name || stdinObj.tool_name || stdinObj.tool || '',
    args: parseArgsObject(tc.args || stdinObj.tool_input || stdinObj.args),
    error: stdinObj.error || stdinObj.toolError || ''
  };
}

async function main() {
  const args = process.argv.slice(2);
  const event = args[0] || 'PreToolUse';
  const adapter = getFlag(args, '--adapter', process.env.ANTIGRAVITY_CLI ? 'antigravity' : 'devin');
  const rawStdin = await readStdinAsync();
  let stdinObj = {};
  if (rawStdin.trim()) {
    try {
      stdinObj = JSON.parse(rawStdin);
    } catch {
      stdinObj = {};
    }
  }

  const action = parseAction(stdinObj, event);
  const { workdir, baseCwd } = resolveEffectiveWorkdir({
    cliWorkdir: getFlag(args, '--workdir', ''),
    stdinObj,
    action,
    targetPath: extractTargetPath(action),
    command: extractCommand(action)
  });

  const bomPath = fs.existsSync(path.join(workdir, '.memory'))
    ? path.join(workdir, '.memory', '.cache', 'forge-bom.json')
    : null;

  const result = await runProgramFunctions({
    programsDir,
    event,
    state: { workdir, execCwd: baseCwd, baseCwd },
    action,
    bomPath
  });

  const out = formatHookOutput({
    adapter,
    event,
    result,
    continuationActive: Boolean(stdinObj.continuationActive || stdinObj.stop_hook_active)
  });
  console.log(JSON.stringify(out.json));
  if (out.exitCode === 2) {
    const errMsg = out.json?.reason || result?.reason || 'Blocked by HASP guardrail.';
    process.stderr.write(`${errMsg}\n`);
  }
  process.exit(out.exitCode);
}

main().catch((err) => {
  console.error(`[harness-forge hooks-engine] Error: ${err.message}`);
  console.log('{}');
  process.exit(0);
});
