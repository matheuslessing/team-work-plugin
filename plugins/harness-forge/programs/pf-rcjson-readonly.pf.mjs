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
import { resolveMemoryRoot } from '../scripts/lib/memory-engine.mjs';

export const meta = {
  id: 'pf-rcjson-readonly',
  version: '1.3.0',
  event: 'PreToolUse'
};

const INLINE_INTERP_RE = /^(?:node|python[\d.]*|ruby|php|pwsh|powershell|perl)(?:\.exe)?$/i;
const SHELL_INTERP_RE = /^(?:sh|bash|zsh|dash)(?:\.exe)?$/i;
const INLINE_FLAG_RE = /(?:^|\s)(?:-e|--eval|-c|-p|-r|-Command)(?:[\s="']|$)/i;
const PROTECTED_ABS_RE = /(?:^|\/)\.memory\/(?:memory\.rc\.json|MEMORY\.md|\.cache(?:\/|$))/;
const PROTECTED_SCRIPT_MENTION_RE = /\bmemory\.rc\.json\b|(?:^|[\\/])MEMORY\.md\b|\.memory[\\/]\.cache(?:[\\/]|$)/;

function isProtectedArtifact(workdir, baseCwd, target, allowDirMatch = false) {
  if (!target) return false;
  const memRoot = resolveMemoryRoot(workdir);
  const absTarget = path.resolve(baseCwd || workdir, target);
  const normAbs = normalizePosix(absTarget);

  // Protect any `.memory/` compiled artifact even if hook `workdir` differs from target project dir
  if (PROTECTED_ABS_RE.test(normAbs)) return true;
  if (allowDirMatch && /(?:^|\/)\.memory\/?$/.test(normAbs)) return true;

  const relToMem = normalizePosix(path.relative(memRoot, absTarget));
  if (relToMem.startsWith('..') || path.isAbsolute(relToMem)) return false;
  if (allowDirMatch && (relToMem === '' || relToMem === '.cache')) return true;
  return relToMem === 'memory.rc.json' || relToMem === 'MEMORY.md' || relToMem === '.cache' || relToMem.startsWith('.cache/');
}

function isProtectedFileToken(workdir, baseCwd, token, allowDirMatch = false) {
  if (!token) return false;
  if (isProtectedArtifact(workdir, baseCwd, token, allowDirMatch)) return true;
  const norm = normalizePosix(token).replace(/\/+$/, '');
  if (/(?:^|\/)memory\.rc\.json$/.test(norm)) return true;
  if (/(?:^|\/)\.memory\/MEMORY\.md$/.test(norm)) return true;
  if (/(?:^|\/)\.memory\/\.cache(?:\/|$)/.test(norm)) return true;
  return allowDirMatch && /(?:^|\/)\.memory$/.test(norm);
}

function isLegitCliStage(cmdTokens) {
  if (cmdTokens.length < 2) return false;
  const bin = path.basename(cmdTokens[0]).toLowerCase().replace(/\.exe$/, '');
  if (!bin.startsWith('node')) return false;
  const scriptTok = cmdTokens.slice(1).find((t) => !t.startsWith('-')) || '';
  return /(?:^|[\\/])(?:forge-cli|validate-real-env)\.mjs$/.test(scriptTok);
}

function checkStage(workdir, baseCwd, stage) {
  const cmdTokens = unwrapCommandTokens(tokenizeArgs(stage));
  if (cmdTokens.length === 0 || isLegitCliStage(cmdTokens)) return '';

  const bin = path.basename(cmdTokens[0]).toLowerCase().replace(/\.exe$/, '');
  const rest = cmdTokens.slice(1);

  if (bin === 'xargs') {
    const subBin = rest.find((t) => !t.startsWith('-')) || '';
    if (subBin && ['rm', 'mv', 'cp', 'tee'].includes(path.basename(subBin).toLowerCase())) {
      const m = stage.match(PROTECTED_SCRIPT_MENTION_RE);
      if (m) return m[0];
    }
  }
  if (bin === 'find' && rest.some((t) => t === '-delete' || t === '-exec')) {
    if (rest.some((t) => PROTECTED_SCRIPT_MENTION_RE.test(t) || isProtectedArtifact(workdir, baseCwd, t, true))) {
      return rest.find((t) => !t.startsWith('-')) || '.memory';
    }
  }

  const allowDir = ['rm', 'mv'].includes(bin);
  const writeTargets = extractMutatorWriteTargets(stage);
  const directHit = writeTargets.find((t) => isProtectedFileToken(workdir, baseCwd, t, allowDir));
  if (directHit) return directHit;

  // Guard `cp .../memory.rc.json .memory/` where dest is `.memory/` dir
  if (bin === 'cp' && writeTargets.length > 0 && isProtectedFileToken(workdir, baseCwd, writeTargets[0], true)) {
    const nonFlags = rest.filter((t) => !t.startsWith('-'));
    const sources = nonFlags.slice(0, -1);
    const srcHit = sources.find((s) => isProtectedFileToken(workdir, baseCwd, s, false));
    if (srcHit) return srcHit;
  }

  // Recurse into `sh -c "..."` / `bash -c "..."`
  if (SHELL_INTERP_RE.test(bin)) {
    const cIdx = rest.findIndex((t) => t === '-c');
    if (cIdx !== -1 && rest[cIdx + 1]) {
      const innerHit = inspectShellCommand(workdir, baseCwd, rest[cIdx + 1]);
      if (innerHit) return innerHit;
    } else if (stage.includes('\n')) {
      const innerHit = inspectShellCommand(workdir, baseCwd, stage.split('\n').slice(1).join('\n'));
      if (innerHit) return innerHit;
    }
  }

  if (INLINE_INTERP_RE.test(bin) && (INLINE_FLAG_RE.test(stage) || stage.includes('\n')) && SCRIPT_WRITE_RE.test(stage)) {
    const candidates = extractPathsFromCommand(stage, /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+/g);
    const matched = candidates.find((p) => isProtectedArtifact(workdir, baseCwd, p, true));
    if (matched) return matched;
    const m = stage.match(PROTECTED_SCRIPT_MENTION_RE);
    if (m) return m[0];
  }

  return '';
}

function inspectShellCommand(workdir, baseCwd, cmd) {
  let effectiveCwd = baseCwd;
  const stripped = stripHeredocBodies(cmd);

  for (const seg of splitUnquoted(stripped, 'commands')) {
    const toks = tokenizeArgs(seg);
    if (toks[0] === 'cd' && toks[1] && !toks[1].startsWith('-')) {
      effectiveCwd = path.resolve(effectiveCwd, toks[1]);
      continue;
    }

    for (const target of extractRedirectTargets(seg)) {
      if (isProtectedFileToken(workdir, effectiveCwd, target, false)) {
        return target;
      }
    }

    for (const stage of splitUnquoted(seg, 'pipes')) {
      const hit = checkStage(workdir, effectiveCwd, stage);
      if (hit) return hit;
    }
  }
  return '';
}

function detectBlockedTarget(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const baseCwd = path.resolve(state.execCwd || state.baseCwd || workdir);
  const tool = action?.tool || '';

  if (EDIT_TOOLS.has(tool)) {
    const target = extractTargetPath(action);
    return isProtectedArtifact(workdir, baseCwd, target, false) ? target : '';
  }
  if (EXEC_TOOLS.has(tool)) {
    return inspectShellCommand(workdir, baseCwd, extractCommand(action));
  }
  return '';
}

export function should_activate(state, action) {
  return Boolean(detectBlockedTarget(state, action));
}

export function intervene(state, action) {
  const target = detectBlockedTarget(state, action) || extractTargetPath(action) || 'memory.rc.json';
  return {
    type: 'BLOCK',
    reason:
      `[HASP:pf-rcjson-readonly] Direct edits to "${target}" are forbidden. ` +
      `memory.rc.json, MEMORY.md, and .cache/ are deterministically compiled artifacts. ` +
      `Use MCP tool memory_upsert / memory_rebuild_index or \`forge-cli.mjs memory rebuild\`.`
  };
}
