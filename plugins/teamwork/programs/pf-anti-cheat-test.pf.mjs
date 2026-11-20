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
import { analyzeTestFileIntegrity, isTestFilePath } from '../scripts/lib/forensic-scanner.mjs';

export const meta = {
  id: 'pf-anti-cheat-test',
  version: '1.2.0',
  event: 'PostToolUse'
};

const INLINE_INTERP_RE = /^(?:node|python[\d.]*|ruby|php|pwsh|powershell|perl)(?:\.exe)?$/i;

function isCandidateTestFile(norm) {
  if (!norm) return false;
  if (norm.includes('.agents/teamwork/') && !/\.agents\/teamwork\/[^/]+\/worktree\//.test(norm)) {
    return false;
  }
  return isTestFilePath(norm);
}

function getTargetTestFiles(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const baseCwd = path.resolve(state.execCwd || state.baseCwd || workdir);
  const tool = action?.tool || '';
  const candidates = [];

  if (EDIT_TOOLS.has(tool)) {
    const target = extractTargetPath(action);
    const norm = target.replace(/\\/g, '/');
    if (isCandidateTestFile(norm)) {
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
          targets.push(
            ...extractPathsFromCommand(
              stage,
              /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+\.(?:cs|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)/gi
            )
          );
        }
      }

      for (const target of targets) {
        const norm = target.replace(/\\/g, '/');
        if (!isCandidateTestFile(norm)) continue;
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
  return getTargetTestFiles(state, action).length > 0;
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const files = getTargetTestFiles(state, action);
  const violations = [];
  const affectedTargets = [];

  for (const { target, fullPath } of files) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const found = analyzeTestFileIntegrity(fullPath, content, workdir);
    if (found.length > 0) {
      violations.push(...found);
      affectedTargets.push(target);
    }
  }
  if (violations.length === 0) return { type: 'NOOP' };

  return {
    type: 'INJECT_CONTEXT',
    reason: `Forensic integrity issue(s) detected immediately after editing ${affectedTargets.join(', ')}`,
    payload:
      `[HASP:pf-anti-cheat-test] Detected ${violations.length} integrity violation(s):\n` +
      violations.map((v) => `- [${v.type}] ${v.file}:${v.line} — ${v.message}`).join('\n') +
      `\nFix immediately by binding tests directly to real production exports/commands without mocks, skips, or tautologies.`
  };
}
