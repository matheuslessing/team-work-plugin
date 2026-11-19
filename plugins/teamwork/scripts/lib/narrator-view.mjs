import fs from 'node:fs';
import path from 'node:path';
import { getBoardStatus, readBoard } from './board.mjs';
import { detectStalls } from './stall-monitor.mjs';
import { getActiveOrchestrator, getTeamworkRoot, loadState } from './state-machine.mjs';

const PHASE_INDEX = {
  INIT: 1,
  SURVEY: 1,
  CONTRACT_FROZEN: 2,
  DUAL_TRACK: 2,
  GATE: 3,
  REMEDIATION: 3,
  VICTORY_AUDIT: 4,
  DONE: 4,
  FAILED: 4
};

const ATTENTION_PRIORITY = {
  decision: 1,
  failure: 2,
  review: 3,
  stuck: 4,
  quota: 5,
  error: 6,
  fyi: 7
};

function readGoalTitle(workdir) {
  const orig = path.join(getTeamworkRoot(workdir), 'ORIGINAL_REQUEST.md');
  if (!fs.existsSync(orig)) return 'Teamwork Mission';
  const lines = fs.readFileSync(orig, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || clean.startsWith('Working directory') || clean.startsWith('Runtime') || clean.startsWith('Integrity')) {
      continue;
    }
    return clean.slice(0, 72);
  }
  return 'Teamwork Mission';
}

function deriveAgentState(agentDir, agentName, scope) {
  const hasHandoff = fs.existsSync(path.join(agentDir, 'handoff.md'));
  if (hasHandoff) {
    const content = fs.readFileSync(path.join(agentDir, 'handoff.md'), 'utf8');
    if (/INTEGRITY VIOLATION|REQUEST_CHANGES|REJECT/i.test(content)) return 'failed';
    return 'done';
  }
  if (scope?.status === 'completed' || scope?.status === 'retired') return 'done';
  if (fs.existsSync(path.join(agentDir, 'progress.md'))) return 'active';
  return 'queued';
}

export function buildView(workdir) {
  const twRoot = getTeamworkRoot(workdir);
  const state = loadState(workdir);
  const activeOrch = getActiveOrchestrator(workdir);
  const boardStatus = getBoardStatus(workdir);
  const stallInfo = detectStalls(workdir, { staleMinutes: 10 });
  const recentPosts = readBoard(workdir, { since: Math.max(0, boardStatus.head_seq - 20) });

  const workstreams = [];
  const attention = [];
  const nowMap = {};
  const risks = [];

  if (fs.existsSync(twRoot)) {
    const dirs = fs
      .readdirSync(twRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    for (const dirName of dirs) {
      const fullDir = path.join(twRoot, dirName);
      const scope = state.active_agent_scopes?.[dirName];
      const wsState = deriveAgentState(fullDir, dirName, scope);
      const id = `ws-${dirName.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 40);

      let note = scope?.role || dirName;
      const progPath = path.join(fullDir, 'progress.md');
      if (fs.existsSync(progPath)) {
        const progLines = fs
          .readFileSync(progPath, 'utf8')
          .split(/\r?\n/)
          .filter((l) => l.trim().startsWith('-'));
        if (progLines.length > 0) {
          note = progLines[progLines.length - 1].replace(/^-\s*/, '').slice(0, 100);
        }
      }

      workstreams.push({
        id,
        title: dirName,
        owners: [dirName],
        state: wsState,
        note,
        short: {
          title: dirName,
          line: `${wsState}: ${note.slice(0, 60)}`
        }
      });

      nowMap[dirName] = wsState === 'done' ? 'Completed handoff' : wsState === 'failed' ? 'Failed gate check' : `Active (${scope?.role || 'agent'})`;
    }
  }

  for (const s of stallInfo.stalls) {
    attention.push({
      id: `att-stall-${s.seq || s.kind}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40),
      kind: 'stuck',
      severity: 'high',
      title: s.summary,
      why: stallInfo.recommended_action,
      refs: s.seq ? [{ seq: s.seq }] : [],
      short: { title: 'Swarm stall detected', line: s.summary.slice(0, 75) }
    });
  }

  const gatePath = path.join(twRoot, activeOrch.id, 'GATE_STATUS.md');
  if (fs.existsSync(gatePath)) {
    const gateText = fs.readFileSync(gatePath, 'utf8');
    if (/INTEGRITY VIOLATION|REQUEST_CHANGES|Gate Result:\s*\*\*FAIL\*\*/i.test(gateText)) {
      attention.push({
        id: 'att-gate-fail',
        kind: 'failure',
        severity: 'high',
        title: 'Verification Gate requires remediation',
        why: 'Latest iteration in GATE_STATUS.md has defects or integrity violations.',
        refs: [{ member: activeOrch.id }],
        short: { title: 'Gate failed', line: 'Remediation required before Victory Audit.' }
      });
    }
  }

  const deadEndsPath = path.join(twRoot, activeOrch.id, 'DEAD_ENDS.md');
  if (fs.existsSync(deadEndsPath)) {
    const deLines = fs
      .readFileSync(deadEndsPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith('|') && !l.includes('Approach Tried') && !l.includes('---'));
    for (let i = 0; i < deLines.length; i++) {
      risks.push({ id: `r-de-${i + 1}`, text: deLines[i].replace(/\|/g, ' ').trim().slice(0, 100) });
    }
  }

  attention.sort((a, b) => (ATTENTION_PRIORITY[a.kind] || 99) - (ATTENTION_PRIORITY[b.kind] || 99));

  const threads = [];
  const surveyIds = workstreams.filter((w) => w.title.includes('explorer')).map((w) => w.id);
  const implIds = workstreams.filter((w) => w.title.includes('worker') || w.title.includes('test_writer')).map((w) => w.id);
  const gateIds = workstreams
    .filter((w) => w.title.includes('reviewer') || w.title.includes('challenger') || w.title.includes('auditor'))
    .map((w) => w.id);

  if (surveyIds.length > 0) {
    threads.push({
      id: 't-survey',
      title: 'Codebase Survey',
      goal: 'Map architecture and freeze contracts',
      now: `${surveyIds.length} survey stream(s)`,
      workstreams: surveyIds,
      attention: []
    });
  }
  if (implIds.length > 0) {
    threads.push({
      id: 't-dual-track',
      title: 'Dual-Track Build',
      goal: 'Implement milestones and 4-tier E2E tests',
      now: `${implIds.length} implementation/QA stream(s)`,
      workstreams: implIds,
      attention: attention.filter((a) => a.kind === 'stuck').map((a) => a.id)
    });
  }
  if (gateIds.length > 0) {
    threads.push({
      id: 't-verification-gate',
      title: 'Verification Gate',
      goal: 'Adversarial review and binary forensic audit',
      now: `${gateIds.length} gate reviewer/auditor(s)`,
      workstreams: gateIds,
      attention: attention.filter((a) => a.kind === 'failure').map((a) => a.id)
    });
  }

  const lastPost = recentPosts[recentPosts.length - 1];
  const headline = lastPost
    ? `Phase ${state.phase}: ${lastPost.text.slice(0, 80)}`
    : `Phase ${state.phase} (${activeOrch.id}) — ${workstreams.length} workspace(s) tracked.`;

  return {
    version: 1,
    as_of_seq: boardStatus.head_seq,
    updated_at: new Date().toISOString(),
    active_orchestrator: activeOrch.id,
    goal: {
      title: readGoalTitle(workdir),
      line: `Phase ${state.phase} (${PHASE_INDEX[state.phase] || 1}/4) — ${activeOrch.id}`
    },
    headline,
    phase: {
      label: state.phase,
      index: PHASE_INDEX[state.phase] || 1,
      total: 4
    },
    running_summary: `${workstreams.filter((w) => w.state === 'active').length} active, ${workstreams.filter((w) => w.state === 'done').length} done, ${attention.length} attention item(s).`,
    threads,
    workstreams,
    attention,
    now: nowMap,
    risks
  };
}

export function buildAndWriteView(workdir) {
  const view = buildView(workdir);
  const viewPath = path.join(getTeamworkRoot(workdir), 'view.json');
  fs.mkdirSync(path.dirname(viewPath), { recursive: true });
  const tmp = `${viewPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(view, null, 2), 'utf8');
  fs.renameSync(tmp, viewPath);
  return { viewPath, view };
}
