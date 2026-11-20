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
import { resolveMemoryRoot } from '../scripts/lib/memory-engine.mjs';

export const meta = {
  id: 'pf-rcjson-readonly',
  version: '1.1.0',
  event: 'PreToolUse'
};

const ALLOWED_CLI_RE = /\bforge-cli\.mjs\b|\bmemory\s+(?:init|rebuild|drift|promote)\b|\bvalidate-real-env\.mjs\b/i;
const PROTECTED_MENTION_RE = /\bmemory\.rc\.json\b|\bMEMORY\.md\b|\.memory[\\/]\.cache[\\/]/i;

function isProtectedArtifact(workdir, target) {
  if (!target) return false;
  const memRoot = resolveMemoryRoot(workdir);
  const absTarget = path.resolve(workdir, target);
  const relToMem = normalizePosix(path.relative(memRoot, absTarget));
  if (relToMem.startsWith('..')) return false;
  return relToMem === 'memory.rc.json' || relToMem === 'MEMORY.md' || relToMem.startsWith('.cache/');
}

function detectBlockedTarget(workdir, action) {
  const tool = action?.tool || '';
  if (EDIT_TOOLS.has(tool)) {
    const target = extractTargetPath(action);
    return isProtectedArtifact(workdir, target) ? target : '';
  }
  if (EXEC_TOOLS.has(tool)) {
    const cmd = extractCommand(action);
    if (!cmd || ALLOWED_CLI_RE.test(cmd) || !isMutatingShellCommand(cmd)) return '';
    const candidates = extractPathsFromCommand(cmd, /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+/g);
    const matched = candidates.find((p) => isProtectedArtifact(workdir, p));
    if (matched) return matched;
    if (PROTECTED_MENTION_RE.test(cmd)) {
      const m = cmd.match(PROTECTED_MENTION_RE);
      return m ? m[0] : 'memory.rc.json';
    }
  }
  return '';
}

export function should_activate(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  return Boolean(detectBlockedTarget(workdir, action));
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const target = detectBlockedTarget(workdir, action) || extractTargetPath(action) || 'memory.rc.json';
  return {
    type: 'BLOCK',
    reason:
      `[HASP:pf-rcjson-readonly] Direct edits to "${target}" are forbidden. ` +
      `memory.rc.json, MEMORY.md, and .cache/ are deterministically compiled artifacts. ` +
      `Use MCP tool memory_upsert / memory_rebuild_index or \`forge-cli.mjs memory rebuild\`.`
  };
}
