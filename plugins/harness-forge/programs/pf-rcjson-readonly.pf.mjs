import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';
import {
  EDIT_TOOLS,
  EXEC_TOOLS,
  extractCommand,
  extractPathsFromCommand,
  extractTargetPath
} from '../scripts/core/hasp-runner.mjs';
import { resolveMemoryRoot } from '../scripts/lib/memory-engine.mjs';

export const meta = {
  id: 'pf-rcjson-readonly',
  version: '1.2.0',
  event: 'PreToolUse'
};

const ALLOWED_CLI_RE = /\bforge-cli\.mjs\b|\bmemory\s+(?:init|rebuild|drift|promote)\b|\bvalidate-real-env\.mjs\b/i;
const PROTECTED_MENTION_RE = /\bmemory\.rc\.json\b|\bMEMORY\.md\b|\.memory[\\/]\.cache[\\/]/i;
const PROTECTED_BASENAME_RE = /(?:^|[\\/])(?:memory\.rc\.json|MEMORY\.md)$/;
const INLINE_INTERP_RE = /^(?:node|python[\d.]*|ruby|php|pwsh|powershell)(?:\.exe)?$/i;
const INLINE_FLAG_RE = /(?:^|\s)(?:-e|--eval|-c|-r|-Command)(?:\s|$)/i;
const SCRIPT_WRITE_RE = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|rmSync|unlinkSync|renameSync|truncateSync|write_text|write_bytes|json\.dump|unlink|replace|open\([^)]*['"][wax+])/i;

function isProtectedArtifact(workdir, target) {
  if (!target) return false;
  const memRoot = resolveMemoryRoot(workdir);
  const absTarget = path.resolve(workdir, target);
  const relToMem = normalizePosix(path.relative(memRoot, absTarget));
  if (relToMem.startsWith('..')) return false;
  return relToMem === 'memory.rc.json' || relToMem === 'MEMORY.md' || relToMem.startsWith('.cache/');
}

function isProtectedFileToken(workdir, token) {
  if (!token) return false;
  return isProtectedArtifact(workdir, token) || PROTECTED_BASENAME_RE.test(token);
}

/** Strip heredoc body lines so `.memory/.cache/` inside e.g. `.gitignore` heredocs doesn't false-trigger. */
function stripHeredocBodies(cmd) {
  const lines = String(cmd || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let delim = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (delim !== null) {
      if (line.trim() === delim) delim = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?(?!<)\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1/);
    if (m && i + 1 < lines.length) {
      delim = m[2];
    }
  }
  return out.join('\n');
}

function splitUnquoted(str, mode) {
  const out = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\' && !inSingle && i + 1 < str.length) {
      cur += ch + str[i + 1];
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      cur += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      cur += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (mode === 'commands') {
        if ((ch === '&' && str[i + 1] === '&') || (ch === '|' && str[i + 1] === '|')) {
          if (cur.trim()) out.push(cur.trim());
          cur = '';
          i += 1;
          continue;
        }
        if (ch === ';' || ch === '\n') {
          if (cur.trim()) out.push(cur.trim());
          cur = '';
          continue;
        }
      } else if (mode === 'pipes' && ch === '|' && str[i + 1] !== '|') {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
        if (str[i + 1] === '&') i += 1;
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function tokenizeArgs(stage) {
  const tokens = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let hasToken = false;

  for (let i = 0; i < stage.length; i++) {
    const ch = stage[i];
    if (ch === '\\' && !inSingle && i + 1 < stage.length) {
      cur += stage[i + 1];
      i += 1;
      hasToken = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasToken = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasToken = true;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (hasToken) {
        tokens.push(cur);
        cur = '';
        hasToken = false;
      }
      continue;
    }
    cur += ch;
    hasToken = true;
  }
  if (hasToken) tokens.push(cur);
  return tokens;
}

/** Collect unquoted redirection destination paths (`> file`, `>> file`, `1> file`). */
function extractRedirectTargets(seg) {
  const targets = [];
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === '\\' && !inSingle && i + 1 < seg.length) {
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble || ch !== '>') continue;

    const prev = i > 0 ? seg[i - 1] : '';
    const prev2 = i > 1 ? seg[i - 2] : '';
    if (prev === '-' || prev === '=' || prev === '<') continue;
    if (prev === '&' && prev2 !== '' && !/[\s;|&]/.test(prev2)) continue;

    let j = i + 1;
    if (seg[j] === '>') j += 1;
    while (j < seg.length && /\s/.test(seg[j])) j += 1;
    if (j >= seg.length || seg[j] === '&') {
      i = j;
      continue;
    }

    let tok = '';
    let q = null;
    while (j < seg.length) {
      const c = seg[j];
      if (!q && (c === "'" || c === '"')) {
        q = c;
      } else if (q && c === q) {
        q = null;
      } else if (!q && /[\s;|&<>]/.test(c)) {
        break;
      } else {
        tok += c;
      }
      j += 1;
    }
    if (tok) targets.push(tok);
    i = j - 1;
  }
  return targets;
}

function checkMutatorStage(workdir, stage) {
  const tokens = tokenizeArgs(stage);
  let start = 0;
  while (start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start])) {
    start += 1;
  }
  const cmdTokens = tokens.slice(start);
  if (cmdTokens.length === 0) return '';

  const bin = path.basename(cmdTokens[0]).toLowerCase();
  const rest = cmdTokens.slice(1);
  const nonFlags = () => {
    const out = [];
    let afterDash = false;
    for (const t of rest) {
      if (!afterDash && t === '--') {
        afterDash = true;
        continue;
      }
      if (afterDash || !t.startsWith('-')) out.push(t);
    }
    return out;
  };

  if (bin === 'tee') {
    return nonFlags().find((t) => isProtectedFileToken(workdir, t)) || '';
  }
  if ((bin === 'sed' || bin === 'perl') && rest.some((t) => /^-[A-Za-z]*i/.test(t) || t === '--in-place')) {
    return nonFlags().find((t) => isProtectedFileToken(workdir, t)) || '';
  }
  if (bin === 'rm' || bin === 'truncate' || bin === 'mv') {
    return nonFlags().find((t) => isProtectedFileToken(workdir, t)) || '';
  }
  if (bin === 'cp') {
    const tIdx = rest.findIndex((t) => t === '-t');
    if (tIdx !== -1 && rest[tIdx + 1] && isProtectedFileToken(workdir, rest[tIdx + 1])) {
      return rest[tIdx + 1];
    }
    const files = nonFlags();
    const dest = files.length > 0 ? files[files.length - 1] : '';
    return isProtectedFileToken(workdir, dest) ? dest : '';
  }
  if (bin === 'dd') {
    const ofTok = rest.find((t) => t.startsWith('of='));
    const dest = ofTok ? ofTok.slice(3) : '';
    return isProtectedFileToken(workdir, dest) ? dest : '';
  }
  if (INLINE_INTERP_RE.test(bin) && INLINE_FLAG_RE.test(stage) && SCRIPT_WRITE_RE.test(stage)) {
    const candidates = extractPathsFromCommand(stage, /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+/g);
    const matched = candidates.find((p) => isProtectedArtifact(workdir, p));
    if (matched) return matched;
    const m = stage.match(PROTECTED_MENTION_RE);
    if (m) return m[0];
  }
  return '';
}

function detectBlockedTargetInSegment(workdir, seg) {
  if (!seg || ALLOWED_CLI_RE.test(seg)) return '';

  for (const target of extractRedirectTargets(seg)) {
    if (isProtectedArtifact(workdir, target) || PROTECTED_MENTION_RE.test(target)) {
      return target;
    }
  }

  if (/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*git(?:\.exe)?\b/i.test(seg)) {
    return '';
  }

  for (const stage of splitUnquoted(seg, 'pipes')) {
    const hit = checkMutatorStage(workdir, stage);
    if (hit) return hit;
  }
  return '';
}

function detectBlockedTarget(workdir, action) {
  const tool = action?.tool || '';
  if (EDIT_TOOLS.has(tool)) {
    const target = extractTargetPath(action);
    return isProtectedArtifact(workdir, target) ? target : '';
  }
  if (EXEC_TOOLS.has(tool)) {
    const stripped = stripHeredocBodies(extractCommand(action));
    for (const seg of splitUnquoted(stripped, 'commands')) {
      const hit = detectBlockedTargetInSegment(workdir, seg);
      if (hit) return hit;
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
