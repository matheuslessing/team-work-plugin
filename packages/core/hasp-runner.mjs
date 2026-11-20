import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizePosix, sha256Hex } from './frontmatter.mjs';

export const EDIT_TOOLS = new Set([
  'edit',
  'write_file',
  'edit_file',
  'Write',
  'Edit',
  'MultiEdit',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'delete_file'
]);

export const EXEC_TOOLS = new Set(['exec', 'run_command', 'Bash', 'bash', 'shell']);

const WRAPPER_BINS = new Set(['env', 'command', 'nohup', 'sudo', 'time', 'timeout']);
const INTERPRETER_RE = /^(?:sh|bash|zsh|dash|node|python[\d.]*|perl|ruby|pwsh|powershell|php)(?:\.exe)?$/i;
const INLINE_INTERP_RE = /^(?:node|python[\d.]*|ruby|php|pwsh|powershell|perl)(?:\.exe)?$/i;
const SHELL_INTERP_RE = /^(?:sh|bash|zsh|dash)(?:\.exe)?$/i;
const MUTATOR_BINS = new Set(['tee', 'rm', 'truncate', 'mv', 'cp', 'dd', 'install', 'ln', 'touch']);

export const SCRIPT_WRITE_RE =
  /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|promises\.(?:writeFile|rm|unlink|rename|truncate|copyFile)|rmSync|unlinkSync|renameSync|truncateSync|write_text|write_bytes|json\.dump|os\.replace\s*\(|os\.remove\s*\(|os\.unlink\s*\(|shutil\.(?:copy|move|rmtree)|Set-Content|Out-File|Add-Content|Remove-Item|Move-Item|Copy-Item)\b|\bopen\([^)]*,\s*(?:mode\s*=\s*)?['"][^'"]*[wax+]/i;

export function extractTargetPath(action) {
  const args = action?.args || {};
  return (
    args.path ||
    args.Path ||
    args.file_path ||
    args.filePath ||
    args.target ||
    args.TargetFile ||
    args.targetFile ||
    ''
  );
}

export function extractCommand(action) {
  const args = action?.args || {};
  return args.CommandLine || args.command || args.cmd || '';
}

export function stripUnquotedComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && !inSingle && i + 1 < line.length) {
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
    if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s|;|\||&|\(/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function findUnquotedHeredoc(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (ch === '\\' && !inSingle && i + 1 < line.length) {
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
    if (!inSingle && !inDouble && ch === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
      const rest = line.slice(i);
      const m = rest.match(/^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1/);
      if (m) {
        return { index: i, delim: m[2] };
      }
    }
  }
  return null;
}

/**
 * Strip non-interpreter heredoc data payloads (e.g. `cat <<'EOF' > .gitignore`)
 * while preserving heredocs fed to interpreters (`node <<EOF`, `python3 <<EOF`, `bash <<EOF`)
 * and ignoring `<<` inside comments or quotes.
 */
export function stripHeredocBodies(cmd) {
  const lines = String(cmd || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let delim = null;
  let keepBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (delim !== null) {
      if (keepBody) out.push(line);
      if (line.trim() === delim) {
        delim = null;
        keepBody = false;
      }
      continue;
    }
    const clean = stripUnquotedComment(line);
    out.push(clean);
    const hd = findUnquotedHeredoc(clean);
    if (hd && i + 1 < lines.length) {
      const prefix = clean.slice(0, hd.index);
      const unwrapped = unwrapCommandTokens(tokenizeArgs(prefix));
      const bin = unwrapped[0] ? path.basename(unwrapped[0]).toLowerCase() : '';
      keepBody = INTERPRETER_RE.test(bin);
      delim = hd.delim;
    }
  }
  return out.join('\n');
}

export function splitUnquoted(str, mode) {
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
        const prev = i > 0 ? str[i - 1] : '';
        const next = i + 1 < str.length ? str[i + 1] : '';
        if (ch === '&' && prev !== '>' && prev !== '<' && next !== '>') {
          if (cur.trim()) out.push(cur.trim());
          cur = '';
          continue;
        }
        if (ch === ';' || ch === '\n') {
          if (cur.trim()) out.push(cur.trim());
          cur = '';
          continue;
        }
      } else if (mode === 'pipes' && ch === '|' && str[i + 1] !== '|') {
        const prev = i > 0 ? str[i - 1] : '';
        if (prev === '>') {
          // `>|` clobber redirect operator, not a pipe
          cur += ch;
          continue;
        }
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

export function tokenizeArgs(stage) {
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
    if (!inSingle && !inDouble && !hasToken && (ch === '(' || ch === ')')) {
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (hasToken) {
        tokens.push(cur.replace(/\)+$/, (m) => (m === cur ? '' : m)));
        cur = '';
        hasToken = false;
      }
      continue;
    }
    cur += ch;
    hasToken = true;
  }
  if (hasToken && cur) tokens.push(cur.replace(/\)+$/, (m) => (m === cur ? '' : m)));
  return tokens.filter(Boolean);
}

/** Unwrap leading env vars (`A=1`), subshell parens, and wrappers (`env`, `command`, `timeout`, `sudo`, `nohup`). */
export function unwrapCommandTokens(tokens) {
  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      idx += 1;
      continue;
    }
    const base = path.basename(tok).toLowerCase().replace(/\.exe$/, '');
    if (!WRAPPER_BINS.has(base)) break;
    idx += 1;
    if (base === 'timeout' && idx < tokens.length) {
      while (idx < tokens.length && tokens[idx].startsWith('-')) idx += 1;
      if (idx < tokens.length && /^\d+(?:\.\d+)?[smhd]?$/.test(tokens[idx])) idx += 1;
    } else if (base === 'env' || base === 'sudo') {
      while (idx < tokens.length && tokens[idx].startsWith('-')) {
        const flag = tokens[idx];
        idx += 1;
        if ((flag === '-u' || flag === '-C' || flag === '-g') && idx < tokens.length) idx += 1;
      }
    }
  }
  return tokens.slice(idx);
}

/** Collect unquoted redirection destination paths (`>`, `>>`, `1>`, `>|`, `<>`, `&>`, `&>>`). */
export function extractRedirectTargets(seg) {
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
    if (prev === '-' || prev === '=') continue;
    // Allow `<` before `>` (read-write `<>`), ignore `>&`, allow `&>` and `1>`/`2>`
    if (prev === '&' && prev2 !== '' && !/[\s;|&(]/.test(prev2)) continue;

    let j = i + 1;
    if (seg[j] === '>' || seg[j] === '|') j += 1;
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
      } else if (!q && /[\s;|&<>)]/.test(c)) {
        break;
      } else {
        tok += c;
      }
      j += 1;
    }
    if (tok && tok !== '/dev/null') targets.push(tok);
    i = j - 1;
  }
  return targets;
}

export function extractMutatorWriteTargets(stage) {
  const cmdTokens = unwrapCommandTokens(tokenizeArgs(stage));
  if (cmdTokens.length === 0) return [];
  const bin = path.basename(cmdTokens[0]).toLowerCase().replace(/\.exe$/, '');
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

  if (bin === 'tee' || bin === 'rm' || bin === 'truncate' || bin === 'mv' || bin === 'touch') {
    return nonFlags();
  }
  if ((bin === 'sed' || bin === 'perl') && rest.some((t) => /^-[A-Za-z]*i/.test(t) || /^--in-place(?:=|$)/.test(t))) {
    return nonFlags();
  }
  if (bin === 'cp' || bin === 'install' || bin === 'ln') {
    const tIdx = rest.findIndex((t) => t === '-t');
    if (tIdx !== -1 && rest[tIdx + 1]) return [rest[tIdx + 1], ...nonFlags()];
    const files = nonFlags();
    return files.length > 0 ? [files[files.length - 1]] : [];
  }
  if (bin === 'dd') {
    const ofTok = rest.find((t) => t.startsWith('of='));
    return ofTok ? [ofTok.slice(3)] : [];
  }
  if (bin === 'git' && rest[0]) {
    const gitSub = rest[0].toLowerCase();
    if (['rm', 'mv', 'checkout', 'restore', 'clean', 'apply'].includes(gitSub)) {
      return nonFlags().slice(1);
    }
  }
  return [];
}

export function isMutatingShellCommand(cmd) {
  const stripped = stripHeredocBodies(cmd);
  if (!stripped.trim()) return false;
  for (const seg of splitUnquoted(stripped, 'commands')) {
    if (extractRedirectTargets(seg).length > 0) return true;
    for (const stage of splitUnquoted(seg, 'pipes')) {
      const cmdTokens = unwrapCommandTokens(tokenizeArgs(stage));
      if (cmdTokens.length === 0) continue;
      const bin = path.basename(cmdTokens[0]).toLowerCase().replace(/\.exe$/, '');
      if (MUTATOR_BINS.has(bin)) return true;
      if ((bin === 'sed' || bin === 'perl') && cmdTokens.slice(1).some((t) => /^-[A-Za-z]*i/.test(t) || /^--in-place(?:=|$)/.test(t))) {
        return true;
      }
      if (bin === 'find' && cmdTokens.some((t) => t === '-delete' || t === '-exec')) return true;
      if (bin === 'xargs' && cmdTokens.some((t) => MUTATOR_BINS.has(path.basename(t).toLowerCase()))) return true;
      if (SHELL_INTERP_RE.test(bin)) {
        const cIdx = cmdTokens.findIndex((t) => t === '-c');
        if (cIdx !== -1 && cmdTokens[cIdx + 1] && isMutatingShellCommand(cmdTokens[cIdx + 1])) return true;
        if (stage.includes('\n')) return true;
      }
      if (INLINE_INTERP_RE.test(bin) && SCRIPT_WRITE_RE.test(stage)) return true;
    }
  }
  return false;
}

export function extractPathsFromCommand(cmd, pathRegex) {
  const str = String(cmd || '');
  const flags = pathRegex.flags.includes('g') ? pathRegex.flags : `${pathRegex.flags}g`;
  const re = new RegExp(pathRegex.source, flags);
  const tokenCandidates = tokenizeArgs(str);
  const regexMatches = str.match(re) || [];
  const combined = [...regexMatches];
  for (const tok of tokenCandidates) {
    re.lastIndex = 0;
    if (re.test(tok)) combined.push(tok);
  }
  const cleaned = combined
    .map((m) => m.replace(/^['"]+|['";),]+$/g, '').trim())
    .filter(Boolean);
  return [...new Set(cleaned)];
}

/**
 * Resolve the effective project workspace root, handling Devin Cloud `cwd=/home/ubuntu`
 * editing `/tmp/project/...`, subshell `cd <dir>`, action `cwd`/`Cwd`, and `.agents/teamwork/<id>/worktree`.
 */
export function resolveEffectiveWorkdir({ cliWorkdir = '', stdinObj = {}, action = {}, targetPath = '', command = '' } = {}) {
  const argsCwd = action?.args?.cwd || action?.args?.Cwd || action?.args?.workdir || '';
  const rawInitial =
    cliWorkdir ||
    stdinObj.cwd ||
    (Array.isArray(stdinObj.workspacePaths) ? stdinObj.workspacePaths[0] : '') ||
    process.env.DEVIN_PROJECT_DIR ||
    process.cwd();

  const initialAbs = path.resolve(rawInitial);
  let baseDir = argsCwd ? path.resolve(initialAbs, argsCwd) : initialAbs;

  if (command && !argsCwd) {
    const segs = splitUnquoted(String(command), 'commands');
    for (const seg of segs) {
      const toks = tokenizeArgs(seg);
      if (toks[0] === 'cd' && toks[1] && !toks[1].startsWith('-')) {
        baseDir = path.resolve(baseDir, toks[1]);
      }
    }
  }

  const execCwd = path.resolve(baseDir);

  const normalizeWorktreeRepo = (dirPath) => {
    const norm = normalizePosix(path.resolve(dirPath));
    const m = norm.match(/^(.*?)\/\.agents\/teamwork\/[^/]+\/worktree(?:\/|$)/);
    return m && m[1] ? path.resolve(m[1]) : path.resolve(dirPath);
  };

  // Preserve active Teamwork workspace from initial/CLI workdir so `cd /elsewhere` cannot escape scope guards.
  const initialRepo = normalizeWorktreeRepo(initialAbs);
  const initialRoot = findNearestRepoRoot(initialRepo);
  if (initialRoot && fs.existsSync(path.join(initialRoot, '.agents', 'teamwork', 'state.json'))) {
    return { workdir: initialRoot, baseCwd: execCwd };
  }

  if (targetPath && path.isAbsolute(targetPath)) {
    const targetRepo = normalizeWorktreeRepo(path.dirname(path.resolve(targetPath)));
    const found = findNearestRepoRoot(targetRepo);
    if (found) return { workdir: found, baseCwd: execCwd };
  }

  const execRepo = normalizeWorktreeRepo(execCwd);
  const execRoot = findNearestRepoRoot(execRepo);
  if (execRoot) return { workdir: execRoot, baseCwd: execCwd };

  return { workdir: initialRoot || execRepo, baseCwd: execCwd };
}

function findNearestRepoRoot(startDir) {
  let cur = path.resolve(startDir || process.cwd());
  for (let depth = 0; depth < 12; depth++) {
    if (
      fs.existsSync(path.join(cur, '.agents', 'teamwork')) ||
      fs.existsSync(path.join(cur, '.memory')) ||
      fs.existsSync(path.join(cur, '.forge.json')) ||
      fs.existsSync(path.join(cur, '.git'))
    ) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

const PRIORITY = {
  NOOP: 0,
  ALLOW: 1,
  INJECT_CONTEXT: 2,
  MODIFY_ACTION: 3,
  BLOCK: 4
};

export async function loadProgramFunctions(programsDir) {
  if (!programsDir || !fs.existsSync(programsDir)) return [];
  const files = fs
    .readdirSync(programsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.pf.mjs'))
    .map((d) => d.name)
    .sort();

  const loaded = [];
  for (const file of files) {
    const full = path.join(programsDir, file);
    const content = fs.readFileSync(full, 'utf8');
    try {
      const mod = await import(pathToFileURL(full).href);
      loaded.push({
        id: mod.meta?.id || file.replace(/\.pf\.mjs$/, ''),
        version: mod.meta?.version || '1.0.0',
        event: mod.meta?.event || null,
        events: Array.isArray(mod.meta?.events) ? mod.meta.events : null,
        sha256: sha256Hex(content),
        file: normalizePosix(full),
        should_activate: mod.should_activate,
        intervene: mod.intervene
      });
    } catch (err) {
      process.stderr.write(`[hasp-runner] Failed to load PF ${file}: ${err.message}\n`);
    }
  }
  return loaded;
}

function appendBomRecord(bomPath, record) {
  if (!bomPath) return;
  try {
    fs.mkdirSync(path.dirname(bomPath), { recursive: true });
    let bom = {
      schema_version: '1.0.0',
      generated_at: new Date().toISOString(),
      program_functions: {},
      events: []
    };
    if (fs.existsSync(bomPath)) {
      try {
        bom = JSON.parse(fs.readFileSync(bomPath, 'utf8'));
      } catch {
        // overwrite corrupted bom cleanly
      }
    }
    bom.program_functions = bom.program_functions || {};
    bom.events = Array.isArray(bom.events) ? bom.events : [];
    for (const pf of record.pfs_loaded || []) {
      bom.program_functions[pf.id] = { version: pf.version, sha256: pf.sha256 };
    }
    bom.events.push({
      timestamp: new Date().toISOString(),
      event: record.event,
      decision: record.decision,
      activated_pfs: record.activated_pfs
    });
    if (bom.events.length > 200) {
      bom.events = bom.events.slice(-200);
    }
    bom.generated_at = new Date().toISOString();
    const tmp = `${bomPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(bom, null, 2), 'utf8');
    fs.renameSync(tmp, bomPath);
  } catch {
    // non-fatal BOM recording
  }
}

export async function runProgramFunctions({ programsDir, event, state = {}, action = {}, helpers = {}, bomPath = null }) {
  const pfs = await loadProgramFunctions(programsDir);
  let bestDecision = 'ALLOW';
  let overwrite = null;
  const reasons = [];
  const contextPayloads = [];
  const activated = [];

  for (const pf of pfs) {
    const matchesEvent = !event || (pf.events ? pf.events.includes(event) : (!pf.event || pf.event === event));
    if (!matchesEvent || typeof pf.should_activate !== 'function' || typeof pf.intervene !== 'function') {
      continue;
    }

    let active = false;
    try {
      active = Boolean(await pf.should_activate(state, action, helpers));
    } catch (err) {
      process.stderr.write(`[hasp-runner] PF ${pf.id}.should_activate error: ${err.message}\n`);
      active = false;
    }
    if (!active) continue;

    let outcome = { type: 'NOOP' };
    try {
      outcome = (await pf.intervene(state, action, helpers)) || { type: 'NOOP' };
    } catch (err) {
      process.stderr.write(`[hasp-runner] PF ${pf.id}.intervene error: ${err.message}\n`);
      outcome = { type: 'NOOP', error: err.message };
    }

    const type = outcome.type || 'NOOP';
    activated.push({ id: pf.id, version: pf.version, sha256: pf.sha256, decision: type });

    if ((PRIORITY[type] || 0) > (PRIORITY[bestDecision] || 0)) {
      bestDecision = type;
    }
    if (outcome.reason) reasons.push(`[${pf.id}] ${outcome.reason}`);
    if (outcome.payload) contextPayloads.push(outcome.payload);
    if (type === 'MODIFY_ACTION' && outcome.overwrite && typeof outcome.overwrite === 'object') {
      overwrite = { ...(overwrite || {}), ...outcome.overwrite };
    }
  }

  const result = {
    decision: bestDecision === 'NOOP' ? 'ALLOW' : bestDecision,
    reason: reasons.join(' | '),
    additionalContext: contextPayloads.join('\n\n'),
    overwrite,
    activated
  };

  if (bomPath) {
    appendBomRecord(bomPath, {
      event,
      decision: result.decision,
      activated_pfs: activated,
      pfs_loaded: pfs
    });
  }

  return result;
}

export function formatHookOutput({ adapter = 'devin', event, result, continuationActive = false }) {
  const decision = result?.decision || 'ALLOW';
  const reason = result?.reason || '';
  const extra = [reason, result?.additionalContext].filter(Boolean).join('\n');

  if (adapter === 'antigravity') {
    if (event === 'PreToolUse') {
      if (decision === 'BLOCK') {
        return { exitCode: 0, json: { decision: 'deny', reason: extra || 'Blocked by HASP guardrail.' } };
      }
      if (decision === 'MODIFY_ACTION' && result?.overwrite) {
        return { exitCode: 0, json: { decision: 'allow', overwrite: result.overwrite, reason: reason || undefined } };
      }
      return { exitCode: 0, json: { decision: 'allow' } };
    }
    if (event === 'Stop') {
      if (continuationActive) {
        return { exitCode: 0, json: { decision: 'allow' } };
      }
      if (decision === 'BLOCK') {
        return { exitCode: 0, json: { decision: 'continue', reason: extra || 'Gate or handoff validation pending.' } };
      }
      return { exitCode: 0, json: { decision: 'allow' } };
    }
    if (event === 'PostToolUse' || event === 'UserPromptSubmit' || event === 'PostCompaction' || event === 'SessionStart' || event === 'PreInvocation' || event === 'PostInvocation') {
      if (!extra) return { exitCode: 0, json: {} };
      return {
        exitCode: 0,
        json: {
          injectSteps: [{ systemMessage: { systemMessage: extra } }]
        }
      };
    }
    return { exitCode: 0, json: {} };
  }

  // Devin CLI / Cloud default hook contract
  if (event === 'PreToolUse') {
    if (decision === 'BLOCK') {
      const msg = extra || 'Blocked by HASP PreToolUse guardrail.';
      return {
        exitCode: 2,
        json: {
          decision: 'block',
          reason: msg,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: msg,
            additionalContext: msg
          }
        }
      };
    }
    if (decision === 'MODIFY_ACTION' && result?.overwrite) {
      return {
        exitCode: 0,
        json: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            updatedInput: result.overwrite,
            ...(extra ? { additionalContext: extra } : {})
          }
        }
      };
    }
    return {
      exitCode: 0,
      json: extra ? { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: extra } } : {}
    };
  }

  if (event === 'Stop') {
    if (continuationActive) {
      return { exitCode: 0, json: {} };
    }
    if (decision === 'BLOCK') {
      const msg = extra || 'Cannot stop with failing gate or incomplete handoff.';
      return {
        exitCode: 2,
        json: {
          decision: 'block',
          reason: msg,
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: msg
          }
        }
      };
    }
    return {
      exitCode: 0,
      json: extra ? { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: extra } } : {}
    };
  }

  return {
    exitCode: 0,
    json: extra ? { hookSpecificOutput: { hookEventName: event, additionalContext: extra } } : {}
  };
}
