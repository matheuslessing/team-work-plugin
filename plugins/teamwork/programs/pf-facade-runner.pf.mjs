import fs from 'node:fs';
import path from 'node:path';
import {
  EDIT_TOOLS,
  EXEC_TOOLS,
  SCRIPT_WRITE_RE,
  extractCommand,
  extractMutatorWriteTargets,
  extractPathsFromCommand,
  extractRedirectTargets,
  extractTargetPath,
  splitUnquoted,
  stripHeredocBodies,
  tokenizeArgs,
  unwrapCommandTokens
} from '../scripts/core/hasp-runner.mjs';
import { analyzeRunnerScript } from '../scripts/lib/forensic-scanner.mjs';

export const meta = {
  id: 'pf-facade-runner',
  version: '1.2.0',
  event: 'PostToolUse'
};

const INLINE_INTERP_RE = /^(?:node|python[\d.]*|ruby|php|pwsh|powershell|perl)(?:\.exe)?$/i;

function isRunnerFile(target) {
  return Boolean(target) && /^run[-_]tests?\.(?:py|sh|ps1|mjs|js|bat)$/i.test(path.basename(target));
}

function getTargetRunnerFiles(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const baseCwd = path.resolve(state.execCwd || state.baseCwd || workdir);
  const tool = action?.tool || '';
  const candidates = [];

  if (EDIT_TOOLS.has(tool)) {
    const target = extractTargetPath(action);
    if (isRunnerFile(target)) {
      const fullPath = path.resolve(baseCwd, target);
      if (fs.existsSync(fullPath)) candidates.push({ target, fullPath });
    }
    return candidates;
  }

  if (EXEC_TOOLS.has(tool)) {
    const stripped = stripHeredocBodies(extractCommand(action));
    if (!stripped.trim()) return [];
    let effectiveCwd = baseCwd;
    const seen = new Set();

    for (const seg of splitUnquoted(stripped, 'commands')) {
      const toks = tokenizeArgs(seg);
      if (toks[0] === 'cd' && toks[1] && !toks[1].startsWith('-')) {
        effectiveCwd = path.resolve(effectiveCwd, toks[1]);
        continue;
      }

      const targets = [...extractRedirectTargets(seg)];
      for (const stage of splitUnquoted(seg, 'pipes')) {
        targets.push(...extractMutatorWriteTargets(stage));
        const cmdToks = unwrapCommandTokens(tokenizeArgs(stage));
        const bin = cmdToks[0] ? path.basename(cmdToks[0]).toLowerCase().replace(/\.exe$/, '') : '';
        if (INLINE_INTERP_RE.test(bin) && SCRIPT_WRITE_RE.test(stage)) {
          targets.push(...extractPathsFromCommand(stage, /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]*run[-_]tests?\.(?:py|sh|ps1|mjs|js|bat)/gi));
        }
      }

      for (const target of targets) {
        if (!isRunnerFile(target)) continue;
        const fullPath = path.resolve(effectiveCwd, target);
        if (fs.existsSync(fullPath) && !seen.has(fullPath)) {
          seen.add(fullPath);
          candidates.push({ target, fullPath });
        }
      }
    }
  }
  return candidates;
}

export function should_activate(state, action) {
  return getTargetRunnerFiles(state, action).length > 0;
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const files = getTargetRunnerFiles(state, action);
  const violations = [];
  const affectedTargets = [];

  for (const { target, fullPath } of files) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const found = analyzeRunnerScript(fullPath, content, workdir);
    if (found.length > 0) {
      violations.push(...found);
      affectedTargets.push(target);
    }
  }
  if (violations.length === 0) return { type: 'NOOP' };

  return {
    type: 'INJECT_CONTEXT',
    reason: `Facade or suppressed exit detected in test runner ${affectedTargets.join(', ')}`,
    payload:
      `[HASP:pf-facade-runner] Detected ${violations.length} violation(s):\n` +
      violations.map((v) => `- [${v.type}] ${v.file}:${v.line} — ${v.message}`).join('\n') +
      `\nTest runners MUST invoke the real test harness dynamically and exit non-zero on any failure.`
  };
}
