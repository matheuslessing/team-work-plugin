import fs from 'node:fs';
import path from 'node:path';
import { getBoardStatus, readBoard } from './board.mjs';
import { getTeamworkRoot, loadState } from './state-machine.mjs';

export function detectStalls(workdir, { staleMinutes = 10, nowMs = Date.now() } = {}) {
  const state = loadState(workdir);
  const boardStatus = getBoardStatus(workdir);
  const entries = readBoard(workdir, { since: 0, limit: 1000, tail: true });
  const parsedStale = Number(staleMinutes);
  const safeStaleMinutes = Number.isFinite(parsedStale) ? Math.max(0, parsedStale) : 10;
  const staleMs = safeStaleMinutes * 60 * 1000;

  const coordinatorDone = entries.some(
    (e) => e.from === 'coordinator' && e.done && (e.mentions || []).length === 0
  );
  if (state.phase === 'DONE' || state.phase === 'FAILED' || coordinatorDone) {
    return {
      dormant: true,
      stalled: false,
      stalls: [],
      head_seq: boardStatus.head_seq,
      recommended_action: `Go dormant: mission is ${state.phase === 'FAILED' ? 'FAILED' : 'DONE'}.`
    };
  }

  const stalls = [];
  const members = boardStatus.members || {};
  const coordCursors = members.coordinator?.channel_cursors || {};
  const coordHasCursors = Object.keys(coordCursors).length > 0;
  const coordWildcard = coordHasCursors ? coordCursors['*'] || 0 : members.coordinator?.last_read_seq || 0;

  // 1. Unaddressed results (done posts with no @mention or unread by coordinator)
  for (const e of entries) {
    const channelCursor = Math.max(coordWildcard, coordCursors[e.channel || 'main'] || 0);
    if (e.from !== 'coordinator' && e.done && (e.mentions || []).length === 0) {
      stalls.push({
        kind: 'unaddressed_result',
        seq: e.seq,
        from: e.from,
        channel: e.channel,
        summary: `#${e.seq} from ${e.from} posted [done] with no @mention.`
      });
    } else if (
      e.seq > channelCursor &&
      (e.mentions || []).some((m) => String(m).toLowerCase() === 'coordinator')
    ) {
      const tsMs = Date.parse(e.timestamp || '');
      const ageMs = Number.isFinite(tsMs) ? nowMs - tsMs : 0;
      if (ageMs >= staleMs) {
        stalls.push({
          kind: 'coordinator_unread',
          seq: e.seq,
          from: e.from,
          summary: `@coordinator has unread #${e.seq} from ${e.from}.`
        });
      }
    }
  }

  // 2. Unanswered @mentions to active (non-retired) workers
  const retiredStatuses = new Set(['retired', 'killed', 'done', 'completed']);
  for (const [name, info] of Object.entries(members)) {
    const lowerName = name.toLowerCase();
    if (lowerName === 'coordinator' || lowerName === 'monitor' || lowerName === 'narrator') continue;
    const memberStatus = String(info?.status || '').toLowerCase();
    const agentStatus = String(state.agents?.[name]?.status || '').toLowerCase();
    if (retiredStatuses.has(memberStatus) || retiredStatuses.has(agentStatus)) continue;

    const lastPostSeq = info.last_post_seq || 0;
    const unanswered = entries.filter((e) => {
      if (e.seq <= lastPostSeq) return false;
      const mentions = (e.mentions || []).map((m) => String(m).toLowerCase());
      return mentions.includes(lowerName) || mentions.includes('all');
    });
    if (unanswered.length > 0) {
      const oldest = unanswered[0];
      const tsMs = Date.parse(oldest.timestamp || '');
      const ageMs = Number.isFinite(tsMs) ? nowMs - tsMs : 0;
      if (ageMs >= staleMs) {
        stalls.push({
          kind: 'unanswered_mention',
          target: name,
          seq: oldest.seq,
          summary: `@${name} has unanswered mention #${oldest.seq} (last_post_seq=${lastPostSeq}).`
        });
      }
    }
  }

  // 3. Repeated tool errors in .tool-history.json
  const histPath = path.join(getTeamworkRoot(workdir), '.tool-history.json');
  if (fs.existsSync(histPath)) {
    try {
      const hist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
      const recent = (hist.errors || []).slice(-3);
      if (recent.length === 3 && recent.every((r) => r.sig === recent[0].sig)) {
        stalls.push({
          kind: 'repeated_error_loop',
          signature: recent[0].sig,
          summary: `3 consecutive identical errors detected: ${recent[0].sig}`
        });
      }
    } catch {
      // ignore invalid tool history
    }
  }

  const stalled = stalls.length > 0;
  let recommended_action = 'No stall detected; continue monitoring.';
  if (stalled) {
    const first = stalls[0];
    if (first.kind === 'unanswered_mention') {
      recommended_action = `@${first.target} [stall] #${first.seq} is for you (or switch model if out of quota).`;
    } else if (first.kind === 'unaddressed_result') {
      recommended_action = `@coordinator [stall] #${first.seq} (${first.from}) was addressed to nobody.`;
    } else {
      recommended_action = `@coordinator [stall] ${first.summary}`;
    }
  }

  return {
    dormant: false,
    stalled,
    stalls,
    head_seq: boardStatus.head_seq,
    recommended_action
  };
}
