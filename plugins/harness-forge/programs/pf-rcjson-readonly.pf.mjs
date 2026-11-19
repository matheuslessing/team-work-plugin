import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';
import { resolveMemoryRoot } from '../scripts/lib/memory-engine.mjs';

export const meta = {
  id: 'pf-rcjson-readonly',
  version: '1.0.0',
  event: 'PreToolUse'
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
  const workdir = path.resolve(state.workdir || process.cwd());
  const memRoot = resolveMemoryRoot(workdir);
  const absTarget = path.resolve(workdir, target);
  const relToMem = normalizePosix(path.relative(memRoot, absTarget));
  if (relToMem.startsWith('..')) return false;
  return relToMem === 'memory.rc.json' || relToMem === 'MEMORY.md' || relToMem.startsWith('.cache/');
}

export function intervene(state, action) {
  return {
    type: 'BLOCK',
    reason:
      `[HASP:pf-rcjson-readonly] Direct edits to "${extractTargetPath(action)}" are forbidden. ` +
      `memory.rc.json, MEMORY.md, and .cache/ are deterministically compiled artifacts. ` +
      `Use MCP tool memory_upsert / memory_rebuild_index or \`forge-cli.mjs memory rebuild\`.`
  };
}
