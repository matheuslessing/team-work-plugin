import fs from 'node:fs';
import path from 'node:path';
import {
  EDIT_TOOLS,
  EXEC_TOOLS,
  extractCommand,
  extractPathsFromCommand,
  extractTargetPath,
  isMutatingShellCommand
} from '../scripts/core/hasp-runner.mjs';
import { validateHandoff } from '../scripts/core/validator.mjs';
import { getActiveOrchestrator, getTeamworkRoot } from '../scripts/lib/state-machine.mjs';

export const meta = {
  id: 'pf-handoff-completeness',
  version: '1.1.0',
  events: ['PostToolUse', 'Stop']
};

function getTargetHandoffFiles(workdir, action) {
  const tool = action?.tool || '';
  if (EDIT_TOOLS.has(tool)) {
    const target = extractTargetPath(action);
    if (path.basename(target).toLowerCase() !== 'handoff.md') return [];
    const fullPath = path.resolve(workdir, target);
    return fs.existsSync(fullPath) ? [{ target, fullPath }] : [];
  }
  if (EXEC_TOOLS.has(tool)) {
    const cmd = extractCommand(action);
    if (!isMutatingShellCommand(cmd)) return [];
    const matches = extractPathsFromCommand(cmd, /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]*handoff\.md/gi);
    const out = [];
    const seen = new Set();
    for (const target of matches) {
      if (path.basename(target).toLowerCase() !== 'handoff.md') continue;
      const fullPath = path.resolve(workdir, target);
      if (fs.existsSync(fullPath) && !seen.has(fullPath)) {
        seen.add(fullPath);
        out.push({ target, fullPath });
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
  return getTargetHandoffFiles(workdir, action).length > 0;
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());

  if (action?.event === 'Stop') {
    const twRoot = getTeamworkRoot(workdir);
    const activeOrch = getActiveOrchestrator(workdir);
    const gatePath = path.join(twRoot, activeOrch.id, 'GATE_STATUS.md');
    const briefingPath = path.join(twRoot, activeOrch.id, 'BRIEFING.md');

    if (fs.existsSync(gatePath) && fs.existsSync(briefingPath)) {
      const gateContent = fs.readFileSync(gatePath, 'utf8');
      const briefingContent = fs.readFileSync(briefingPath, 'utf8');
      const latestGate = gateContent.split(/^##\s+Gate/im).pop() || '';
      const hasFail = /Gate Result:\s*\*\*FAIL\*\*/i.test(latestGate) || /INTEGRITY[_\s]VIOLATION|REQUEST_CHANGES/i.test(latestGate);
      const hasPass = /Gate Result:\s*\*\*PASS\*\*/i.test(latestGate);
      if (briefingContent.includes('[in-progress]') && hasFail && !hasPass) {
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

  // PostToolUse on handoff.md
  const files = getTargetHandoffFiles(workdir, action);
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
