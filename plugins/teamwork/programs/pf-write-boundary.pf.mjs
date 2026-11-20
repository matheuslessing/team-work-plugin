import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';
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

export const meta = {
  id: 'pf-write-boundary',
  version: '1.2.0',
  event: 'PreToolUse'
};

const INLINE_INTERP_RE = /^(?:node|python[\d.]*|ruby|php|pwsh|powershell|perl)(?:\.exe)?$/i;
const GIT_MUTATION_RE = /\bgit(?:\s+-[^\s]+(?:\s+[^\s]+)?)*\s+(?:commit|push|reset|checkout|merge|rebase|rm|mv|clean|restore)\b/i;

function globToRegex(glob) {
  const clean = normalizePosix(glob).replace(/^\/+/, '');
  let regex = '^';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '*') {
      if (clean[i + 1] === '*') {
        if (clean[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 2;
        } else {
          regex += '.*';
          i += 1;
        }
      } else {
        regex += '[^/]*';
      }
    } else if (ch === '?') {
      regex += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regex += '\\' + ch;
    } else {
      regex += ch;
    }
  }
  regex += '$';
  return new RegExp(regex, 'i');
}

function matchesAnyGlob(relPath, globs = []) {
  const norm = normalizePosix(relPath).replace(/^\.\//, '');
  return globs.some((g) => {
    const cleanG = normalizePosix(g).replace(/^\.\//, '');
    if (cleanG === norm) return true;
    if (cleanG.endsWith('/') && norm.startsWith(cleanG)) return true;
    return globToRegex(cleanG).test(norm);
  });
}

function resolveScopedTarget(workdir, baseCwd, agentId, rawTarget) {
  const resolved = path.resolve(baseCwd || workdir, rawTarget);
  const rel = normalizePosix(path.relative(workdir, resolved));
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { escapesWorkspace: true, inOwnAgentMetaDir: false, effectiveRel: rel, rawRel: rel };
  }
  const wtPrefix = `.agents/teamwork/${agentId}/worktree`;
  if (rel === wtPrefix || rel.startsWith(`${wtPrefix}/`)) {
    const inner = rel === wtPrefix ? '' : rel.slice(wtPrefix.length + 1);
    return { escapesWorkspace: false, inOwnAgentMetaDir: false, effectiveRel: inner, rawRel: rel };
  }
  const ownPrefix = `.agents/teamwork/${agentId}`;
  const inOwnAgentMetaDir = rel === ownPrefix || rel.startsWith(`${ownPrefix}/`);
  return { escapesWorkspace: false, inOwnAgentMetaDir, effectiveRel: rel, rawRel: rel };
}

function checkTargetAllowance(workdir, baseCwd, agentId, profile, scope, rawTarget) {
  const info = resolveScopedTarget(workdir, baseCwd, agentId, rawTarget);
  if (info.escapesWorkspace) {
    return `Write outside workspace blocked for ${agentId} (${profile}): ${rawTarget}`;
  }
  if (profile === 'read_only' || profile === 'audit_only') {
    if (!info.inOwnAgentMetaDir) {
      return `Authority Violation: "${agentId}" has profile "${profile}" and cannot modify "${info.rawRel}". Only ".agents/teamwork/${agentId}/**" is writable.`;
    }
    return '';
  }
  if (profile === 'dispatch_only') {
    if (!matchesAnyGlob(info.rawRel, ['.agents/teamwork/**'])) {
      return `Dispatch-Only Violation: orchestrator/sentinel "${agentId}" cannot edit "${info.rawRel}". Delegate code/test changes to workers.`;
    }
    return '';
  }
  if (profile === 'full_orchestrator') return '';

  if (info.inOwnAgentMetaDir) return '';
  if (scope.allowed_write_globs && scope.allowed_write_globs.length > 0) {
    if (!matchesAnyGlob(info.effectiveRel, scope.allowed_write_globs)) {
      return `Scope Violation: "${agentId}" (${profile}) does not own "${info.effectiveRel}". Allowed globs: [${scope.allowed_write_globs.join(', ')}]`;
    }
  }
  return '';
}

function collectExecWriteTargets(workdir, baseCwd, cmd) {
  const stripped = stripHeredocBodies(cmd);
  const ops = [];
  let effectiveCwd = baseCwd || workdir;

  for (const seg of splitUnquoted(stripped, 'commands')) {
    const toks = tokenizeArgs(seg);
    if (toks[0] === 'cd' && toks[1] && !toks[1].startsWith('-')) {
      effectiveCwd = path.resolve(effectiveCwd, toks[1]);
      continue;
    }

    const targets = [...extractRedirectTargets(seg)];
    let unresolvableMutation = false;

    for (const stage of splitUnquoted(seg, 'pipes')) {
      const mutTargets = extractMutatorWriteTargets(stage);
      targets.push(...mutTargets);

      const cmdToks = unwrapCommandTokens(tokenizeArgs(stage));
      const bin = cmdToks[0] ? path.basename(cmdToks[0]).toLowerCase().replace(/\.exe$/, '') : '';
      if (GIT_MUTATION_RE.test(stage)) {
        unresolvableMutation = true;
      }
      if (INLINE_INTERP_RE.test(bin) && SCRIPT_WRITE_RE.test(stage)) {
        const inlinePaths = extractPathsFromCommand(stage, /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+/g);
        if (inlinePaths.length > 0) targets.push(...inlinePaths);
        else unresolvableMutation = true;
      }
    }

    ops.push({ cwd: effectiveCwd, targets, seg, unresolvableMutation });
  }
  return ops;
}

export function should_activate(state, action) {
  if (!state?.activeScope) return false;
  const tool = action?.tool || '';
  return EDIT_TOOLS.has(tool) || EXEC_TOOLS.has(tool);
}

export function intervene(state, action) {
  const scope = state.activeScope;
  const workdir = path.resolve(state.workdir || process.cwd());
  const baseCwd = path.resolve(state.execCwd || state.baseCwd || workdir);
  const tool = action.tool || '';
  const profile = scope.authority_profile || 'scoped_worker';
  const agentId = state.activeAgentId || 'agent';

  if (EDIT_TOOLS.has(tool)) {
    const rawTarget = extractTargetPath(action);
    if (!rawTarget) return { type: 'NOOP' };
    const violation = checkTargetAllowance(workdir, baseCwd, agentId, profile, scope, rawTarget);
    if (violation) return { type: 'BLOCK', reason: violation };
    return { type: 'ALLOW' };
  }

  if (EXEC_TOOLS.has(tool) && profile !== 'full_orchestrator') {
    const ops = collectExecWriteTargets(workdir, baseCwd, extractCommand(action));
    for (const op of ops) {
      for (const target of op.targets) {
        const violation = checkTargetAllowance(workdir, op.cwd, agentId, profile, scope, target);
        if (violation) return { type: 'BLOCK', reason: violation };
      }
      if (
        (profile === 'read_only' || profile === 'audit_only' || profile === 'dispatch_only') &&
        op.unresolvableMutation
      ) {
        return {
          type: 'BLOCK',
          reason: `Unmonitored Shell Write Violation: profile "${profile}" (${agentId}) cannot run mutating command: "${op.seg.slice(0, 120)}"`
        };
      }
    }
  }

  return { type: 'ALLOW' };
}
