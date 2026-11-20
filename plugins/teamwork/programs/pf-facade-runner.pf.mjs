import fs from 'node:fs';
import path from 'node:path';
import { analyzeRunnerScript } from '../scripts/lib/forensic-scanner.mjs';

export const meta = {
  id: 'pf-facade-runner',
  version: '1.0.0',
  event: 'PostToolUse'
};

const EDIT_TOOLS = new Set(['edit', 'write_file', 'edit_file', 'Write', 'Edit']);

function extractTargetPath(action) {
  const args = action?.args || {};
  return args.path || args.Path || args.file_path || args.filePath || args.target || '';
}

export function should_activate(state, action) {
  if (!EDIT_TOOLS.has(action?.tool || '')) return false;
  const target = extractTargetPath(action);
  if (!target) return false;
  return /^run[-_]tests?\.(?:py|sh|ps1|mjs|js|bat)$/i.test(path.basename(target));
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const fullPath = path.resolve(workdir, extractTargetPath(action));
  if (!fs.existsSync(fullPath)) return { type: 'NOOP' };

  const content = fs.readFileSync(fullPath, 'utf8');
  const violations = analyzeRunnerScript(fullPath, content, workdir);
  if (violations.length === 0) return { type: 'NOOP' };

  return {
    type: 'INJECT_CONTEXT',
    reason: `Facade or suppressed exit detected in test runner ${extractTargetPath(action)}`,
    payload:
      `[HASP:pf-facade-runner] Detected ${violations.length} violation(s):\n` +
      violations.map((v) => `- [${v.type}] ${v.file}:${v.line} — ${v.message}`).join('\n') +
      `\nTest runners MUST invoke the real test harness dynamically and exit non-zero on any failure.`
  };
}
