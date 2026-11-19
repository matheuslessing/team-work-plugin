import fs from 'node:fs';
import path from 'node:path';
import { validateHandoff } from '../scripts/core/validator.mjs';
import { getActiveOrchestrator, getTeamworkRoot } from '../scripts/lib/state-machine.mjs';

export const meta = {
  id: 'pf-handoff-completeness',
  version: '1.0.0',
  events: ['PostToolUse', 'Stop']
};

const EDIT_TOOLS = new Set(['edit', 'write_file', 'edit_file', 'Write', 'Edit']);

function extractTargetPath(action) {
  const args = action?.args || {};
  return args.path || args.Path || args.file_path || args.filePath || args.target || '';
}

export function should_activate(state, action) {
  if (action?.event === 'Stop') {
    const twRoot = getTeamworkRoot(state.workdir || process.cwd());
    return fs.existsSync(twRoot);
  }
  if (EDIT_TOOLS.has(action?.tool || '')) {
    return path.basename(extractTargetPath(action)).toLowerCase() === 'handoff.md';
  }
  return false;
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
  const fullPath = path.resolve(workdir, extractTargetPath(action));
  if (!fs.existsSync(fullPath)) return { type: 'NOOP' };
  const res = validateHandoff(fullPath, fs.readFileSync(fullPath, 'utf8'), {
    checkFiles: true,
    workspaceRoot: workdir
  });
  if (!res.ok) {
    return {
      type: 'INJECT_CONTEXT',
      reason: `Handoff ${extractTargetPath(action)} is incomplete`,
      payload: `[HASP:pf-handoff-completeness] Missing/invalid handoff requirements:\n- ${res.errors.join('\n- ')}`
    };
  }
  return { type: 'NOOP' };
}
