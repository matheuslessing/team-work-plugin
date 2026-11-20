import fs from 'node:fs';
import path from 'node:path';
import {
  EDIT_TOOLS,
  EXEC_TOOLS,
  extractCommand,
  extractPathsFromCommand,
  extractTargetPath,
  isMutatingShellCommand
} from '../scripts/core/hasp-runner.mjs';
import { analyzeTestFileIntegrity } from '../scripts/lib/forensic-scanner.mjs';

export const meta = {
  id: 'pf-anti-cheat-test',
  version: '1.1.0',
  event: 'PostToolUse'
};

function isCandidateTestFile(norm) {
  if (!norm || norm.includes('.agents/teamwork/')) return false;
  return (
    /(?:test|spec)/i.test(path.basename(norm)) &&
    /\.(?:cs|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)$/i.test(norm)
  );
}

function getTargetTestFiles(workdir, action) {
  const tool = action?.tool || '';
  const candidates = [];
  if (EDIT_TOOLS.has(tool)) {
    const target = extractTargetPath(action);
    const norm = target.replace(/\\/g, '/');
    if (isCandidateTestFile(norm)) {
      const fullPath = path.resolve(workdir, target);
      if (fs.existsSync(fullPath)) candidates.push({ target, fullPath });
    }
    return candidates;
  }
  if (EXEC_TOOLS.has(tool)) {
    const cmd = extractCommand(action);
    if (!isMutatingShellCommand(cmd)) return [];
    const matches = extractPathsFromCommand(
      cmd,
      /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]*(?:test|spec)[A-Za-z0-9_./\\-]*\.(?:cs|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)/gi
    );
    const seen = new Set();
    for (const target of matches) {
      const norm = target.replace(/\\/g, '/');
      if (!isCandidateTestFile(norm)) continue;
      const fullPath = path.resolve(workdir, target);
      if (fs.existsSync(fullPath) && !seen.has(fullPath)) {
        seen.add(fullPath);
        candidates.push({ target, fullPath });
      }
    }
  }
  return candidates;
}

export function should_activate(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  return getTargetTestFiles(workdir, action).length > 0;
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const files = getTargetTestFiles(workdir, action);
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
