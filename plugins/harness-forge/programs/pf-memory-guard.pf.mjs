import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';
import {
  EDIT_TOOLS,
  EXEC_TOOLS,
  extractCommand,
  extractMutatorWriteTargets,
  extractRedirectTargets,
  extractTargetPath,
  splitUnquoted,
  stripHeredocBodies,
  tokenizeArgs,
  unwrapCommandTokens
} from '../scripts/core/hasp-runner.mjs';
import { validateMemoryDoc, validateMemoryIndexSync } from '../scripts/core/validator.mjs';
import { rebuildIndex, resolveMemoryRoot } from '../scripts/lib/memory-engine.mjs';

export const meta = {
  id: 'pf-memory-guard',
  version: '1.2.0',
  events: ['PreToolUse', 'PostToolUse', 'Stop']
};

const MEMORY_FOLDERS = new Set(['architecture', 'decisions', 'contracts', 'gotchas']);

function isManagedMemoryMarkdown(workdir, baseCwd, target) {
  if (!target) return false;
  const memRoot = resolveMemoryRoot(workdir);
  const abs = path.resolve(baseCwd || workdir, target);
  const rel = normalizePosix(path.relative(memRoot, abs));
  if (rel.startsWith('..') || path.isAbsolute(rel) || !rel.endsWith('.md')) return false;
  const topDir = rel.split('/')[0];
  return MEMORY_FOLDERS.has(topDir);
}

function isForgeCliStage(stage) {
  const cmdTokens = unwrapCommandTokens(tokenizeArgs(stage));
  if (cmdTokens.length < 2) return false;
  const bin = path.basename(cmdTokens[0]).toLowerCase().replace(/\.exe$/, '');
  if (!bin.startsWith('node')) return false;
  const scriptTok = cmdTokens.slice(1).find((t) => !t.startsWith('-')) || '';
  return /(?:^|[\\/])forge-cli\.mjs$/.test(scriptTok);
}

function getManagedExecMdOps(workdir, baseCwd, cmd) {
  const stripped = stripHeredocBodies(cmd);
  if (!stripped.trim()) return [];
  let effectiveCwd = baseCwd || workdir;
  const ops = [];
  const seen = new Set();

  for (const seg of splitUnquoted(stripped, 'commands')) {
    const toks = tokenizeArgs(seg);
    if (toks[0] === 'cd' && toks[1] && !toks[1].startsWith('-')) {
      effectiveCwd = path.resolve(effectiveCwd, toks[1]);
      continue;
    }

    const stages = splitUnquoted(seg, 'pipes');
    if (stages.every((s) => isForgeCliStage(s))) continue;

    const candidates = [
      ...extractRedirectTargets(seg),
      ...stages.flatMap((s) => (isForgeCliStage(s) ? [] : extractMutatorWriteTargets(s)))
    ];

    for (const candidate of candidates) {
      if (!isManagedMemoryMarkdown(workdir, effectiveCwd, candidate)) continue;
      const abs = path.resolve(effectiveCwd, candidate);
      if (!seen.has(abs)) {
        seen.add(abs);
        ops.push({ target: candidate, abs });
      }
    }
  }
  return ops;
}

export function should_activate(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const baseCwd = path.resolve(state.execCwd || state.baseCwd || workdir);

  if (action?.event === 'Stop') {
    return fs.existsSync(resolveMemoryRoot(workdir));
  }
  const tool = action?.tool || '';
  if (EDIT_TOOLS.has(tool)) {
    return isManagedMemoryMarkdown(workdir, baseCwd, extractTargetPath(action));
  }
  if (action?.event === 'PostToolUse' && EXEC_TOOLS.has(tool)) {
    return getManagedExecMdOps(workdir, baseCwd, extractCommand(action)).length > 0;
  }
  return false;
}

export async function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const baseCwd = path.resolve(state.execCwd || state.baseCwd || workdir);
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
    const ops = getManagedExecMdOps(workdir, baseCwd, extractCommand(action));
    if (ops.length === 0) return { type: 'NOOP' };

    const allErrors = [];
    const failedRels = [];
    const validatedRels = [];
    let removedAny = false;

    for (const { abs } of ops) {
      const rel = normalizePosix(path.relative(memRoot, abs));
      if (!fs.existsSync(abs)) {
        removedAny = true;
        continue;
      }
      const raw = fs.readFileSync(abs, 'utf8');
      const res = validateMemoryDoc(rel, raw, workdir, { checkDisk: true });
      if (!res.ok) {
        allErrors.push(...res.errors);
        failedRels.push(rel);
      } else {
        validatedRels.push(rel);
      }
    }

    if (allErrors.length > 0) {
      return {
        type: 'INJECT_CONTEXT',
        reason: `Memory document(s) violated PMSP schema`,
        payload: `[HASP:pf-memory-guard] Fix ${failedRels.join(', ')} before finishing:\n- ${allErrors.join('\n- ')}`
      };
    }

    await rebuildIndex(workdir);
    return {
      type: 'INJECT_CONTEXT',
      reason: removedAny
        ? 'Recompiled memory.rc.json after memory document removal'
        : `Recompiled memory.rc.json after valid update to ${validatedRels.join(', ')}`,
      payload: `[HASP:pf-memory-guard] Validated ${validatedRels.length} document(s) and deterministically recompiled memory.rc.json.`
    };
  }

  const target = extractTargetPath(action);
  const abs = path.resolve(baseCwd, target);
  const rel = normalizePosix(path.relative(memRoot, abs));

  if (action?.event === 'PreToolUse') {
    const candidateContent =
      action?.args?.Content ??
      action?.args?.content ??
      action?.args?.file_text ??
      action?.args?.CodeContent ??
      action?.args?.code_content;
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

  // PostToolUse (EDIT_TOOLS): validate saved file and recompile memory.rc.json if valid
  if (!fs.existsSync(abs)) {
    await rebuildIndex(workdir);
    return {
      type: 'INJECT_CONTEXT',
      reason: `Recompiled memory.rc.json after removing ${rel}`,
      payload: `[HASP:pf-memory-guard] Recompiled memory.rc.json after deleting ${rel}.`
    };
  }
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
