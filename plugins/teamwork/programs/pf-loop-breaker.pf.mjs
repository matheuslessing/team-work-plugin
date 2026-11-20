import fs from 'node:fs';
import path from 'node:path';
import { getActiveOrchestrator, getTeamworkRoot } from '../scripts/lib/state-machine.mjs';

export const meta = {
  id: 'pf-loop-breaker',
  version: '1.0.0',
  event: 'PostToolUse'
};

function normalizeErrorSig(tool, errorText) {
  return `${tool}:${String(errorText).trim().replace(/\s+/g, ' ').slice(0, 120)}`;
}

export function should_activate(state, action) {
  const twRoot = getTeamworkRoot(state.workdir || process.cwd());
  if (!fs.existsSync(twRoot)) return false;
  return Boolean(action?.error || action?.toolError);
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const twRoot = getTeamworkRoot(workdir);
  const histPath = path.join(twRoot, '.tool-history.json');

  let hist = { errors: [] };
  if (fs.existsSync(histPath)) {
    try {
      hist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
      hist.errors = Array.isArray(hist.errors) ? hist.errors : [];
    } catch {
      hist = { errors: [] };
    }
  }

  const errText = action.error || action.toolError || '';
  const sig = normalizeErrorSig(action.tool || 'tool', errText);
  hist.errors.push({ sig, timestamp: new Date().toISOString() });
  if (hist.errors.length > 20) hist.errors = hist.errors.slice(-20);

  fs.mkdirSync(twRoot, { recursive: true });
  const tmp = `${histPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(hist, null, 2), 'utf8');
  fs.renameSync(tmp, histPath);

  const last3 = hist.errors.slice(-3);
  if (last3.length === 3 && last3.every((e) => e.sig === sig)) {
    const activeOrch = getActiveOrchestrator(workdir);
    const deadEndsRel = `.agents/teamwork/${activeOrch.id}/DEAD_ENDS.md`;
    return {
      type: 'INJECT_CONTEXT',
      reason: 'Circuit breaker triggered: 3 consecutive identical tool errors',
      payload:
        `[HASP:pf-loop-breaker] STOP repeating the same failing action (${sig}).\n` +
        `1) Log the failed approach in ${deadEndsRel}.\n` +
        `2) Switch strategy, inspect root assumptions, or escalate to ${activeOrch.id}.`
    };
  }

  return { type: 'NOOP' };
}
