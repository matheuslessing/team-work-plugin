import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizePosix, sha256Hex } from './frontmatter.mjs';

export const EDIT_TOOLS = new Set(['edit', 'write_file', 'edit_file', 'Write', 'Edit']);
export const EXEC_TOOLS = new Set(['exec', 'run_command', 'Bash', 'shell']);

export function extractTargetPath(action) {
  const args = action?.args || {};
  return args.path || args.Path || args.file_path || args.filePath || args.target || '';
}

export function extractCommand(action) {
  const args = action?.args || {};
  return args.CommandLine || args.command || args.cmd || '';
}

export function isMutatingShellCommand(cmd) {
  const str = String(cmd || '');
  if (!str.trim()) return false;
  if (/(?:^|[^-\d&=<>])>>?\s*(?!&)\S/.test(str)) return true;
  return /\b(?:tee|sed\s+-i|perl\s+-[^\s]*i|rm\s+|mv\s+|cp\s+|truncate|dd\s+|writeFileSync|writeFile|appendFileSync|appendFile|write_text|write_bytes|json\.dump|open\([^)]*['"][wax+])/i.test(
    str
  );
}

export function extractPathsFromCommand(cmd, pathRegex) {
  const str = String(cmd || '');
  const flags = pathRegex.flags.includes('g') ? pathRegex.flags : `${pathRegex.flags}g`;
  const re = new RegExp(pathRegex.source, flags);
  const matches = str.match(re) || [];
  const cleaned = matches
    .map((m) => m.replace(/^['"]+|['";),]+$/g, '').trim())
    .filter(Boolean);
  return [...new Set(cleaned)];
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
    const tmp = `${bomPath}.${process.pid}.tmp`;
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
    } catch {
      active = false;
    }
    if (!active) continue;

    let outcome = { type: 'NOOP' };
    try {
      outcome = (await pf.intervene(state, action, helpers)) || { type: 'NOOP' };
    } catch (err) {
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
    if (event === 'PostToolUse') {
      return { exitCode: 0, json: {} };
    }
    if (event === 'SessionStart' || event === 'PreInvocation' || event === 'PostInvocation') {
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
      return {
        exitCode: 2,
        json: {
          decision: 'block',
          reason: extra || 'Blocked by HASP PreToolUse guardrail.',
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            additionalContext: extra || 'Blocked by HASP PreToolUse guardrail.'
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
    if (decision === 'BLOCK') {
      return {
        exitCode: 2,
        json: {
          decision: 'block',
          reason: extra || 'Cannot stop with failing gate or incomplete handoff.',
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: extra || 'Cannot stop with failing gate or incomplete handoff.'
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
