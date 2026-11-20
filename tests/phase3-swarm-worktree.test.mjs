import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  createChannel,
  postMessage,
  readBoard,
  registerBoardMember
} from '../plugins/teamwork/scripts/lib/board.mjs';
import { buildAndWriteView } from '../plugins/teamwork/scripts/lib/narrator-view.mjs';
import { detectStalls } from '../plugins/teamwork/scripts/lib/stall-monitor.mjs';
import { transitionPhase } from '../plugins/teamwork/scripts/lib/state-machine.mjs';
import {
  createWorktree,
  mergeWorktree,
  pruneWorktree,
  worktreeDiff,
  worktreeStatus
} from '../plugins/teamwork/scripts/lib/worktree.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const TEAMWORK_CLI = path.join(REPO_ROOT, 'plugins', 'teamwork', 'scripts', 'teamwork-cli.mjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initGitRepo(dir) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@teamwork.local'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Teamwork Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Repo\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
}

test('Swarm Board #seq channels, Stall Monitor detection & dormant mode, and Narrator view.json', () => {
  const tmp = makeTmpDir('tw-board-');
  try {
    execFileSync('node', [TEAMWORK_CLI, 'init', '--workdir', tmp, '--env', 'local']);

    createChannel(tmp, 'm1', 'Milestone 1');
    registerBoardMember(tmp, 'worker_m1', { role: 'worker', channels: ['m1'] });

    const p1 = postMessage(tmp, { from: 'coordinator', channel: 'm1', text: '@worker_m1 implement auth module' });
    assert.equal(p1.seq, 1);

    // Unanswered mention detected when staleMinutes = 0
    let stall = detectStalls(tmp, { staleMinutes: 0 });
    assert.equal(stall.stalled, true);
    assert.equal(stall.stalls[0].kind, 'unanswered_mention');

    // Worker posts [done] with NO @mention -> detected as unaddressed_result
    const p2 = postMessage(tmp, { from: 'worker_m1', channel: 'm1', text: '[done] Implemented auth' });
    assert.equal(p2.seq, 2);
    stall = detectStalls(tmp, { staleMinutes: 0 });
    assert.equal(stall.stalled, true);
    assert.ok(stall.stalls.some((s) => s.kind === 'unaddressed_result'));

    // Channel read updates coordinator cursor
    const msgs = readBoard(tmp, { since: 0, channel: 'm1', reader: 'coordinator' });
    assert.equal(msgs.length, 2);

    // Narrator view.json renders atomically with goal, phase, threads, attention
    const { viewPath, view } = buildAndWriteView(tmp);
    assert.ok(fs.existsSync(viewPath));
    assert.equal(view.version, 1);
    assert.equal(view.as_of_seq, 2);
    assert.ok(view.attention.length > 0);

    // Transition to DONE -> Stall Monitor goes dormant
    transitionPhase(tmp, 'DONE', { reason: 'Test complete' });
    stall = detectStalls(tmp, { staleMinutes: 0 });
    assert.equal(stall.dormant, true);
    assert.equal(stall.stalled, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Git Worktree lifecycle isolates parallel milestone edits and refuses merge until Gate PASS', () => {
  const tmp = makeTmpDir('tw-wt-');
  try {
    initGitRepo(tmp);
    execFileSync('node', [TEAMWORK_CLI, 'init', '--workdir', tmp, '--env', 'local']);

    const wt1 = createWorktree(tmp, 'worker_m1');
    const wt2 = createWorktree(tmp, 'worker_m2');
    assert.equal(wt1.created, true);
    assert.equal(wt2.created, true);

    fs.writeFileSync(path.join(wt1.wtDir, 'm1.txt'), 'milestone 1\n', 'utf8');
    fs.writeFileSync(path.join(wt2.wtDir, 'm2.txt'), 'milestone 2\n', 'utf8');

    // Main workspace does NOT see worktree changes yet
    assert.equal(fs.existsSync(path.join(tmp, 'm1.txt')), false);
    assert.equal(fs.existsSync(path.join(tmp, 'm2.txt')), false);

    const activeWts = worktreeStatus(tmp);
    assert.equal(activeWts.length, 2);

    const diff1 = worktreeDiff(tmp, 'worker_m1');
    assert.match(diff1.dirty_status, /m1\.txt/);

    // Merge blocked while GATE_STATUS.md is PENDING
    assert.throws(() => mergeWorktree(tmp, 'worker_m1', { requireGate: true }), /Gate is not CLEAN\/PASS/);

    // Mark Gate PASS, verify dirty main tree blocks merge, then revert and merge cleanly
    fs.writeFileSync(
      path.join(tmp, '.agents', 'teamwork', 'orchestrator_1', 'GATE_STATUS.md'),
      '# Gate\n\n## Gate — Iteration 1\n| r | g | **APPROVE** | h |\n| a | g | **CLEAN** | h |\n\nGate Result: **PASS**\n',
      'utf8'
    );
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Dirty main\n', 'utf8');
    assert.throws(
      () => mergeWorktree(tmp, 'worker_m1', { requireGate: true }),
      /main worktree has uncommitted tracked changes/
    );
    execFileSync('git', ['checkout', '--', 'README.md'], { cwd: tmp, stdio: 'pipe' });

    mergeWorktree(tmp, 'worker_m1', { requireGate: true });
    mergeWorktree(tmp, 'worker_m2', { requireGate: true });

    assert.equal(fs.existsSync(path.join(tmp, 'm1.txt')), true);
    assert.equal(fs.existsSync(path.join(tmp, 'm2.txt')), true);

    pruneWorktree(tmp, 'worker_m1', { deleteBranch: true });
    pruneWorktree(tmp, 'worker_m2', { deleteBranch: true });
    assert.equal(worktreeStatus(tmp).length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Wave 2 regression: email/@scope mention filtering, per-channel cursors, NaN staleMinutes, merge conflict abort', async () => {
  const { parseMentions, postMessage: postMsg } = await import('../plugins/teamwork/scripts/lib/board.mjs');
  const { createInitialState, saveState } = await import('../plugins/teamwork/scripts/lib/state-machine.mjs');
  const { pruneWorktree } = await import('../plugins/teamwork/scripts/lib/worktree.mjs');

  const pm = parseMentions('Email alice@example.com or install @types/node; ask @worker_1 and @#m2.');
  assert.deepEqual(pm.mentions, ['worker_1']);
  assert.deepEqual(pm.channelMentions, ['m2']);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-reg-p3-'));
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test Bot',
    GIT_AUTHOR_EMAIL: 'bot@example.com',
    GIT_COMMITTER_NAME: 'Test Bot',
    GIT_COMMITTER_EMAIL: 'bot@example.com'
  };
  try {
    saveState(tmp, createInitialState(tmp));
    postMsg(tmp, { from: 'worker_1', channel: 'm1', text: '@coordinator check m1' });
    postMsg(tmp, { from: 'worker_2', channel: 'm2', text: '@coordinator check m2' });

    readBoard(tmp, { since: 0, channel: 'm1', reader: 'coordinator' });
    const futureMs = Date.now() + 15 * 60 * 1000;
    const stallCursors = detectStalls(tmp, { staleMinutes: 0, nowMs: futureMs });
    assert.equal(stallCursors.stalled, true);
    assert.ok(!stallCursors.stalls.some((s) => s.kind === 'coordinator_unread' && s.from === 'worker_1'));
    assert.ok(stallCursors.stalls.some((s) => s.kind === 'coordinator_unread' && s.from === 'worker_2'));

    const stallNan = detectStalls(tmp, { staleMinutes: Number.NaN, nowMs: futureMs });
    assert.equal(stallNan.stalled, true);
    assert.ok(stallNan.stalls.some((s) => s.kind === 'coordinator_unread' && s.from === 'worker_2'));

    // Conflict merge abort check
    const wtRepo = path.join(tmp, 'git-conflict');
    fs.mkdirSync(path.join(wtRepo, 'src'), { recursive: true });
    execFileSync('git', ['init'], { cwd: wtRepo, stdio: 'pipe' });
    fs.writeFileSync(path.join(wtRepo, 'src', 'conflict.js'), 'export const v = "base";\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: wtRepo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: wtRepo, env: gitEnv, stdio: 'pipe' });

    saveState(wtRepo, createInitialState(wtRepo));
    const { wtDir } = createWorktree(wtRepo, 'worker_cf');
    fs.writeFileSync(path.join(wtDir, 'src', 'conflict.js'), 'export const v = "worker";\n', 'utf8');
    execFileSync('git', ['add', 'src/conflict.js'], { cwd: wtDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'worker edit'], { cwd: wtDir, env: gitEnv, stdio: 'pipe' });

    fs.writeFileSync(path.join(wtRepo, 'src', 'conflict.js'), 'export const v = "main";\n', 'utf8');
    execFileSync('git', ['add', 'src/conflict.js'], { cwd: wtRepo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'main edit'], { cwd: wtRepo, env: gitEnv, stdio: 'pipe' });

    const gatePath = path.join(wtRepo, '.agents', 'teamwork', 'orchestrator_1', 'GATE_STATUS.md');
    fs.mkdirSync(path.dirname(gatePath), { recursive: true });
    fs.writeFileSync(
      gatePath,
      '# Gate\n## Gate — Iteration 1\n| Agent | Role | Verdict | Source |\n| `r` | gate | **APPROVE** | `h` |\n| `a` | gate | **CLEAN** | `h` |\nGate Result: **PASS**\n',
      'utf8'
    );

    assert.throws(() => mergeWorktree(wtRepo, 'worker_cf'), /conflict|CONFLICT|Command failed/i);
    assert.equal(fs.existsSync(path.join(wtRepo, '.git', 'MERGE_HEAD')), false);
    pruneWorktree(wtRepo, 'worker_cf', { deleteBranch: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
