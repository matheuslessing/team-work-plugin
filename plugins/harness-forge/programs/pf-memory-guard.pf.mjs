import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';
import {
  EDIT_TOOLS,
  EXEC_TOOLS,
  extractCommand,
  extractPathsFromCommand,
  extractTargetPath,
  isMutatingShellCommand
} from '../scripts/core/hasp-runner.mjs';
import { validateMemoryDoc, validateMemoryIndexSync } from '../scripts/core/validator.mjs';
import { rebuildIndex, resolveMemoryRoot } from '../scripts/lib/memory-engine.mjs';

export const meta = {
  id: 'pf-memory-guard',
  version: '1.1.0',
  events: ['PreToolUse', 'PostToolUse', 'Stop']
};

const MEMORY_FOLDERS = new Set(['architecture', 'decisions', 'contracts', 'gotchas']);

function isManagedMemoryMarkdown(workdir, target) {
  if (!target) return false;
  const memRoot = resolveMemoryRoot(workdir);
  const abs = path.resolve(workdir, target);
  const rel = normalizePosix(path.relative(memRoot, abs));
  if (rel.startsWith('..') || !rel.endsWith('.md')) return false;
  const topDir = rel.split('/')[0];
  return MEMORY_FOLDERS.has(topDir);
}

function getManagedExecMdPaths(workdir, cmd) {
  if (!cmd || /\bforge-cli\.mjs\b/i.test(cmd) || !isMutatingShellCommand(cmd)) return [];
  return extractPathsFromCommand(cmd, /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+\.md/g).filter(
    (p) => isManagedMemoryMarkdown(workdir, p) && fs.existsSync(path.resolve(workdir, p))
  );
}

export function should_activate(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  if (action?.event === 'Stop') {
    const memRoot = resolveMemoryRoot(workdir);
    return fs.existsSync(memRoot);
  }
  const tool = action?.tool || '';
  if (EDIT_TOOLS.has(tool)) {
    return isManagedMemoryMarkdown(workdir, extractTargetPath(action));
  }
  if (action?.event === 'PostToolUse' && EXEC_TOOLS.has(tool)) {
    return getManagedExecMdPaths(workdir, extractCommand(action)).length > 0;
  }
  return false;
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

  if (action?.event === 'PostToolUse' && EXEC_TOOLS.has(action?.tool || '')) {
    const targets = getManagedExecMdPaths(workdir, extractCommand(action));
    if (targets.length === 0) return { type: 'NOOP' };
    const allErrors = [];
    const validatedRels = [];
    for (const t of targets) {
      const abs = path.resolve(workdir, t);
      const rel = normalizePosix(path.relative(memRoot, abs));
      const raw = fs.readFileSync(abs, 'utf8');
      const res = validateMemoryDoc(rel, raw, workdir, { checkDisk: true });
      if (!res.ok) allErrors.push(...res.errors);
      else validatedRels.push(rel);
    }
    if (allErrors.length > 0) {
      return {
        type: 'INJECT_CONTEXT',
        reason: `Memory document(s) violated PMSP schema`,
        payload: `[HASP:pf-memory-guard] Fix ${validatedRels.concat(targets).join(', ')} before finishing:\n- ${allErrors.join('\n- ')}`
      };
    }
    await rebuildIndex(workdir);
    return {
      type: 'INJECT_CONTEXT',
      reason: `Recompiled memory.rc.json after valid update to ${validatedRels.join(', ')}`,
      payload: `[HASP:pf-memory-guard] Validated ${validatedRels.join(', ')} and deterministically recompiled memory.rc.json.`
    };
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
