import fs from 'node:fs';
import path from 'node:path';
import { analyzeTestFileIntegrity } from '../scripts/lib/forensic-scanner.mjs';

export const meta = {
  id: 'pf-anti-cheat-test',
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
  const norm = target.replace(/\\/g, '/');
  if (norm.includes('.agents/teamwork/')) return false;
  return /(?:test|spec)/i.test(path.basename(norm)) && /\.(?:cs|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)$/i.test(norm);
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const fullPath = path.resolve(workdir, extractTargetPath(action));
  if (!fs.existsSync(fullPath)) return { type: 'NOOP' };

  const content = fs.readFileSync(fullPath, 'utf8');
  const violations = analyzeTestFileIntegrity(fullPath, content, workdir);
  if (violations.length === 0) return { type: 'NOOP' };

  return {
    type: 'INJECT_CONTEXT',
    reason: `Forensic integrity issue(s) detected immediately after editing ${extractTargetPath(action)}`,
    payload:
      `[HASP:pf-anti-cheat-test] Detected ${violations.length} integrity violation(s):\n` +
      violations.map((v) => `- [${v.type}] ${v.file}:${v.line} — ${v.message}`).join('\n') +
      `\nFix immediately by binding tests directly to real production exports/commands without mocks, skips, or tautologies.`
  };
}
