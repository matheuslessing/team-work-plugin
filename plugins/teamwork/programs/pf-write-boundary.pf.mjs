import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';

export const meta = {
  id: 'pf-write-boundary',
  version: '1.0.0',
  event: 'PreToolUse'
};

const EDIT_TOOLS = new Set(['edit', 'write_file', 'edit_file', 'Write', 'Edit']);
const EXEC_TOOLS = new Set(['exec', 'run_command', 'Bash', 'shell']);

const DESTRUCTIVE_SHELL_PATTERNS = [
  /\bsed\s+-i\b/,
  /\btee\b/,
  /\brm\s+-?[rf]*\s+/,
  /\bgit\s+(?:commit|push|reset|checkout|merge|rebase)\b/,
  /(?:^|[^-])>\s*[^\s&>]/,
  />>\s*[^\s]/,
  /\b(?:writeFileSync|fs\.writeFile|open\([^)]*['"][wa]['"])/
];

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

function extractTargetPath(action) {
  const args = action?.args || {};
  return args.path || args.Path || args.file_path || args.filePath || args.target || '';
}

function extractCommand(action) {
  const args = action?.args || {};
  return args.CommandLine || args.command || args.cmd || '';
}

export function should_activate(state, action) {
  if (!state?.activeScope) return false;
  const tool = action?.tool || '';
  return EDIT_TOOLS.has(tool) || EXEC_TOOLS.has(tool);
}

export function intervene(state, action) {
  const scope = state.activeScope;
  const workdir = path.resolve(state.workdir || process.cwd());
  const tool = action.tool || '';
  const profile = scope.authority_profile || 'scoped_worker';
  const agentId = state.activeAgentId || 'agent';
  const ownAgentDirGlob = `.agents/teamwork/${agentId}/**`;
  const effectiveAllowed = [...(scope.allowed_write_globs || []), ownAgentDirGlob];

  if (EDIT_TOOLS.has(tool)) {
    const rawTarget = extractTargetPath(action);
    if (!rawTarget) return { type: 'NOOP' };
    const resolved = path.resolve(workdir, rawTarget);
    const rel = normalizePosix(path.relative(workdir, resolved));

    if (rel.startsWith('..')) {
      return {
        type: 'BLOCK',
        reason: `Write outside workspace blocked for ${agentId} (${profile}): ${rawTarget}`
      };
    }

    if (profile === 'read_only' || profile === 'audit_only') {
      if (!matchesAnyGlob(rel, [ownAgentDirGlob])) {
        return {
          type: 'BLOCK',
          reason: `Authority Violation: "${agentId}" has profile "${profile}" and cannot modify "${rel}". Only "${ownAgentDirGlob}" is writable.`
        };
      }
      return { type: 'ALLOW' };
    }

    if (profile === 'dispatch_only') {
      if (!matchesAnyGlob(rel, ['.agents/teamwork/**'])) {
        return {
          type: 'BLOCK',
          reason: `Dispatch-Only Violation: orchestrator/sentinel "${agentId}" cannot edit "${rel}". Delegate code/test changes to workers.`
        };
      }
      return { type: 'ALLOW' };
    }

    if (scope.allowed_write_globs && scope.allowed_write_globs.length > 0) {
      if (!matchesAnyGlob(rel, effectiveAllowed)) {
        return {
          type: 'BLOCK',
          reason: `Scope Violation: "${agentId}" (${profile}) does not own "${rel}". Allowed globs: [${effectiveAllowed.join(', ')}]`
        };
      }
    }
    return { type: 'ALLOW' };
  }

  if (EXEC_TOOLS.has(tool) && (profile === 'read_only' || profile === 'audit_only' || profile === 'dispatch_only')) {
    const cmd = extractCommand(action);
    for (const pat of DESTRUCTIVE_SHELL_PATTERNS) {
      if (pat.test(cmd)) {
        // Allow writing strictly inside .agents/teamwork/
        if (cmd.includes('.agents/teamwork/') && !/\bgit\s+(?:commit|push|reset|checkout|merge|rebase)\b/.test(cmd)) {
          return { type: 'ALLOW' };
        }
        return {
          type: 'BLOCK',
          reason: `Unmonitored Shell Write Violation: profile "${profile}" (${agentId}) cannot run mutating command matching ${pat}: "${cmd.slice(0, 120)}"`
        };
      }
    }
  }

  return { type: 'ALLOW' };
}
