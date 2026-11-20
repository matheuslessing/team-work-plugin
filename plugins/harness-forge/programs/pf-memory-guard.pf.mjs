import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';
import { validateMemoryDoc, validateMemoryIndexSync } from '../scripts/core/validator.mjs';
import { rebuildIndex, resolveMemoryRoot } from '../scripts/lib/memory-engine.mjs';

export const meta = {
  id: 'pf-memory-guard',
  version: '1.0.0',
  events: ['PreToolUse', 'PostToolUse', 'Stop']
};

const EDIT_TOOLS = new Set(['edit', 'write_file', 'edit_file', 'Write', 'Edit']);
const MEMORY_FOLDERS = new Set(['architecture', 'decisions', 'contracts', 'gotchas']);

function extractTargetPath(action) {
  const args = action?.args || {};
  return args.path || args.Path || args.file_path || args.filePath || args.target || '';
}

function isManagedMemoryMarkdown(workdir, target) {
  if (!target) return false;
  const memRoot = resolveMemoryRoot(workdir);
  const abs = path.resolve(workdir, target);
  const rel = normalizePosix(path.relative(memRoot, abs));
  if (rel.startsWith('..') || !rel.endsWith('.md')) return false;
  const topDir = rel.split('/')[0];
  return MEMORY_FOLDERS.has(topDir);
}

export function should_activate(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  if (action?.event === 'Stop') {
    const memRoot = resolveMemoryRoot(workdir);
    return fs.existsSync(memRoot);
  }
  if (!EDIT_TOOLS.has(action?.tool || '')) return false;
  return isManagedMemoryMarkdown(workdir, extractTargetPath(action));
}

export async function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const memRoot = resolveMemoryRoot(workdir);

  if (action?.event === 'Stop') {
    const sync = validateMemoryIndexSync(memRoot, workdir);
    if (!sync.ok) {
      return {
        type: 'BLOCK',
        reason: `[HASP:pf-memory-guard] Stop blocked — .memory/ failed PMSP validation or index sync:\n- ${sync.errors.join('\n- ')}`
      };
    }
    return { type: 'ALLOW' };
  }

  const target = extractTargetPath(action);
  const abs = path.resolve(workdir, target);
  const rel = normalizePosix(path.relative(memRoot, abs));

  if (action?.event === 'PreToolUse') {
    const candidateContent = action?.args?.Content ?? action?.args?.content ?? action?.args?.file_text;
    if (typeof candidateContent === 'string') {
      const res = validateMemoryDoc(rel, candidateContent, workdir, { checkDisk: true });
      if (!res.ok) {
        return {
          type: 'BLOCK',
          reason: `[HASP:pf-memory-guard] Blocked invalid PMSP memory document (${rel}):\n- ${res.errors.join('\n- ')}`
        };
      }
    }
    return { type: 'ALLOW' };
  }

  // PostToolUse: validate saved file and recompile memory.rc.json if valid
  if (!fs.existsSync(abs)) return { type: 'NOOP' };
  const raw = fs.readFileSync(abs, 'utf8');
  const res = validateMemoryDoc(rel, raw, workdir, { checkDisk: true });
  if (!res.ok) {
    return {
      type: 'INJECT_CONTEXT',
      reason: `Memory document ${rel} violated PMSP schema`,
      payload: `[HASP:pf-memory-guard] Fix ${rel} before finishing:\n- ${res.errors.join('\n- ')}`
    };
  }

  await rebuildIndex(workdir);
  return {
    type: 'INJECT_CONTEXT',
    reason: `Recompiled memory.rc.json after valid update to ${rel}`,
    payload: `[HASP:pf-memory-guard] Validated ${rel} and deterministically recompiled memory.rc.json.`
  };
}
