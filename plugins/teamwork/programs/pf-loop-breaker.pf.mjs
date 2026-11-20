import fs from 'node:fs';
import path from 'node:path';
import { getActiveOrchestrator, getTeamworkRoot } from '../scripts/lib/state-machine.mjs';

export const meta = {
  id: 'pf-loop-breaker',
  version: '1.1.0',
  event: 'PostToolUse'
};

function formatErrorText(rawError) {
  if (!rawError) return '';
  if (typeof rawError === 'string') return rawError.trim();
  if (typeof rawError === 'object') {
    if (typeof rawError.message === 'string' && rawError.message.trim()) return rawError.message.trim();
    if (typeof rawError.stderr === 'string' && rawError.stderr.trim()) return rawError.stderr.trim();
    try {
      return JSON.stringify(rawError);
    } catch {
      return 'Unknown object error';
    }
  }
  return String(rawError).trim();
}

function normalizeErrorSig(tool, errorText) {
  return `${tool}:${errorText.replace(/\s+/g, ' ').slice(0, 120)}`;
}

export function should_activate(state) {
  const twRoot = getTeamworkRoot(state.workdir || process.cwd());
  return fs.existsSync(twRoot);
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const twRoot = getTeamworkRoot(workdir);
  const histPath = path.join(twRoot, '.tool-history.json');

  let hist = { errors: [], streaks: {} };
  if (fs.existsSync(histPath)) {
    try {
      hist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
      hist.errors = Array.isArray(hist.errors) ? hist.errors : [];
      hist.streaks = hist.streaks && typeof hist.streaks === 'object' ? hist.streaks : {};
    } catch {
      hist = { errors: [], streaks: {} };
    }
  }

  const agentKey = state.activeAgentId || 'default';
  const errText = formatErrorText(action?.error || action?.toolError);

  if (!errText) {
    // Successful call resets active error streak & cleared error history for this agent
    if (!hist.streaks[agentKey] && hist.errors.length === 0) {
      return { type: 'NOOP' };
    }
    hist.streaks[agentKey] = { sig: '', count: 0 };
    hist.errors = hist.errors.filter((e) => (e.agent || 'default') !== agentKey);
    fs.mkdirSync(twRoot, { recursive: true });
    const tmp = `${histPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(hist, null, 2), 'utf8');
    fs.renameSync(tmp, histPath);
    return { type: 'NOOP' };
  }

  const sig = normalizeErrorSig(action?.tool || 'tool', errText);
  const prev = hist.streaks[agentKey] || { sig: '', count: 0 };
  const count = prev.sig === sig ? prev.count + 1 : 1;
  hist.streaks[agentKey] = { sig, count, timestamp: new Date().toISOString() };

  hist.errors.push({ sig, agent: agentKey, timestamp: new Date().toISOString() });
  if (hist.errors.length > 20) hist.errors = hist.errors.slice(-20);

  fs.mkdirSync(twRoot, { recursive: true });
  const tmp = `${histPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(hist, null, 2), 'utf8');
  fs.renameSync(tmp, histPath);

  if (count >= 3) {
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
