import fs from 'node:fs';
import path from 'node:path';
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
import { evaluateLatestGate, validateHandoff } from '../scripts/core/validator.mjs';
import { getActiveOrchestrator, getTeamworkRoot } from '../scripts/lib/state-machine.mjs';

export const meta = {
  id: 'pf-handoff-completeness',
  version: '1.2.0',
  events: ['PostToolUse', 'Stop']
};

const INLINE_INTERP_RE = /^(?:node|python[\d.]*|ruby|php|pwsh|powershell|perl)(?:\.exe)?$/i;

function getTargetHandoffFiles(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const baseCwd = path.resolve(state.execCwd || state.baseCwd || workdir);
  const tool = action?.tool || '';

  if (EDIT_TOOLS.has(tool)) {
    const target = extractTargetPath(action);
    if (path.basename(target).toLowerCase() !== 'handoff.md') return [];
    const fullPath = path.resolve(baseCwd, target);
    return fs.existsSync(fullPath) ? [{ target, fullPath }] : [];
  }

  if (EXEC_TOOLS.has(tool)) {
    const stripped = stripHeredocBodies(extractCommand(action));
    if (!stripped.trim()) return [];
    let effectiveCwd = baseCwd;
    const out = [];
    const seen = new Set();

    for (const seg of splitUnquoted(stripped, 'commands')) {
      const toks = tokenizeArgs(seg);
      if (toks[0] === 'cd' && toks[1] && !toks[1].startsWith('-')) {
        effectiveCwd = path.resolve(effectiveCwd, toks[1]);
        continue;
      }

      const targets = [...extractRedirectTargets(seg)];
      for (const stage of splitUnquoted(seg, 'pipes')) {
        targets.push(...extractMutatorWriteTargets(stage));
        const cmdToks = unwrapCommandTokens(tokenizeArgs(stage));
        const bin = cmdToks[0] ? path.basename(cmdToks[0]).toLowerCase().replace(/\.exe$/, '') : '';
        if (INLINE_INTERP_RE.test(bin) && SCRIPT_WRITE_RE.test(stage)) {
          targets.push(...extractPathsFromCommand(stage, /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]*handoff\.md/gi));
        }
      }

      for (const target of targets) {
        if (path.basename(target).toLowerCase() !== 'handoff.md') continue;
        const fullPath = path.resolve(effectiveCwd, target);
        if (fs.existsSync(fullPath) && !seen.has(fullPath)) {
          seen.add(fullPath);
          out.push({ target, fullPath });
        }
      }
    }
    return out;
  }
  return [];
}

export function should_activate(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  if (action?.event === 'Stop') {
    const twRoot = getTeamworkRoot(workdir);
    return fs.existsSync(twRoot);
  }
  return getTargetHandoffFiles(state, action).length > 0;
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());

  if (action?.event === 'Stop') {
    const twRoot = getTeamworkRoot(workdir);
    const activeOrch = getActiveOrchestrator(workdir);
    const gatePath = path.join(twRoot, activeOrch.id, 'GATE_STATUS.md');
    const briefingPath = path.join(twRoot, activeOrch.id, 'BRIEFING.md');

    if (fs.existsSync(gatePath) && fs.existsSync(briefingPath)) {
      const gateEval = evaluateLatestGate(fs.readFileSync(gatePath, 'utf8'));
      const briefingContent = fs.readFileSync(briefingPath, 'utf8');
      if (/\[in-progress\]/i.test(briefingContent) && gateEval.failed) {
        return {
          type: 'BLOCK',
          reason: `[HASP:pf-handoff-completeness] Stop blocked: ${activeOrch.id}/GATE_STATUS.md reports FAIL while milestone is still [in-progress]. Remediate and reach CLEAN before stopping.`
        };
      }
    }

    if (state.activeAgentId) {
      const agentHandoff = path.join(twRoot, state.activeAgentId, 'handoff.md');
      if (fs.existsSync(agentHandoff)) {
        const res = validateHandoff(agentHandoff, fs.readFileSync(agentHandoff, 'utf8'), {
          checkFiles: true,
          workspaceRoot: workdir
        });
        if (!res.ok) {
          return {
            type: 'BLOCK',
            reason: `[HASP:pf-handoff-completeness] Stop blocked: ${state.activeAgentId}/handoff.md failed 5-component validation: ${res.errors.join('; ')}`
          };
        }
      }
    }
    return { type: 'ALLOW' };
  }

  const files = getTargetHandoffFiles(state, action);
  if (files.length === 0) return { type: 'NOOP' };
  const allErrors = [];
  const badTargets = [];
  for (const { target, fullPath } of files) {
    const res = validateHandoff(fullPath, fs.readFileSync(fullPath, 'utf8'), {
      checkFiles: true,
      workspaceRoot: workdir
    });
    if (!res.ok) {
      badTargets.push(target);
      allErrors.push(...res.errors);
    }
  }
  if (allErrors.length > 0) {
    return {
      type: 'INJECT_CONTEXT',
      reason: `Handoff ${badTargets.join(', ')} is incomplete`,
      payload: `[HASP:pf-handoff-completeness] Missing/invalid handoff requirements:\n- ${allErrors.join('\n- ')}`
    };
  }
  return { type: 'NOOP' };
}
