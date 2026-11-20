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
import { analyzeRunnerScript } from '../scripts/lib/forensic-scanner.mjs';

export const meta = {
  id: 'pf-facade-runner',
  version: '1.1.0',
  event: 'PostToolUse'
};

function isRunnerFile(target) {
  return Boolean(target) && /^run[-_]tests?\.(?:py|sh|ps1|mjs|js|bat)$/i.test(path.basename(target));
}

function getTargetRunnerFiles(workdir, action) {
  const tool = action?.tool || '';
  const candidates = [];
  if (EDIT_TOOLS.has(tool)) {
    const target = extractTargetPath(action);
    if (isRunnerFile(target)) {
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
      /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]*run[-_]tests?\.(?:py|sh|ps1|mjs|js|bat)/gi
    );
    const seen = new Set();
    for (const target of matches) {
      if (!isRunnerFile(target)) continue;
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
  return getTargetRunnerFiles(workdir, action).length > 0;
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const files = getTargetRunnerFiles(workdir, action);
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
