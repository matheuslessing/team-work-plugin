import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix } from '../core/frontmatter.mjs';
import { getActiveOrchestrator, getTeamworkRoot } from './state-machine.mjs';

function runGit(workdir, gitArgs) {
  return execFileSync('git', gitArgs, { cwd: workdir, encoding: 'utf8', stdio: 'pipe' }).trim();
}

export function getWorktreePaths(workdir, agentId) {
  const root = path.resolve(workdir);
  const wtDir = path.join(getTeamworkRoot(root), agentId, 'worktree');
  const branch = `teamwork/${agentId}`;
  return { root, wtDir, branch };
}

export function createWorktree(workdir, agentId, { baseRef = 'HEAD' } = {}) {
  const { root, wtDir, branch } = getWorktreePaths(workdir, agentId);
  if (fs.existsSync(wtDir)) {
    return { created: false, wtDir: normalizePosix(wtDir), branch, note: 'Worktree already exists' };
  }

  let branchExists = false;
  try {
    runGit(root, ['rev-parse', '--verify', branch]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  fs.mkdirSync(path.dirname(wtDir), { recursive: true });
  if (branchExists) {
    runGit(root, ['worktree', 'add', wtDir, branch]);
  } else {
    runGit(root, ['worktree', 'add', wtDir, '-b', branch, baseRef]);
  }
  return { created: true, wtDir: normalizePosix(wtDir), branch };
}

export function worktreeStatus(workdir) {
  const root = path.resolve(workdir);
  const raw = runGit(root, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let cur = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur);
      cur = { path: normalizePosix(line.slice(9).trim()), head: '', branch: '' };
    } else if (line.startsWith('HEAD ') && cur) {
      cur.head = line.slice(5).trim();
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    }
  }
  if (cur) entries.push(cur);
  return entries.filter((e) => e.branch.startsWith('teamwork/') || e.path.includes('.agents/teamwork/'));
}

export function worktreeDiff(workdir, agentId) {
  const { root, wtDir, branch } = getWorktreePaths(workdir, agentId);
  const statusOut = fs.existsSync(wtDir) ? runGit(wtDir, ['status', '--short']) : '';
  let diffFiles = [];
  try {
    const names = runGit(root, ['diff', '--name-only', `HEAD..${branch}`]);
    diffFiles = names ? names.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    diffFiles = [];
  }
  return { agentId, branch, wtDir: normalizePosix(wtDir), dirty_status: statusOut, committed_files: diffFiles };
}

function isGatePassing(workdir) {
  const active = getActiveOrchestrator(workdir);
  const gatePath = path.join(getTeamworkRoot(workdir), active.id, 'GATE_STATUS.md');
  if (!fs.existsSync(gatePath)) return false;
  const content = fs.readFileSync(gatePath, 'utf8');
  const latest = content.split(/^##\s+Gate/im).pop() || '';
  const hasViolation = /INTEGRITY[_\s]VIOLATION/i.test(latest);
  const hasRequestChanges = /REQUEST_CHANGES/i.test(latest);
  const hasClean = /\bCLEAN\b/i.test(latest);
  return !hasViolation && !hasRequestChanges && hasClean;
}

export function mergeWorktree(workdir, agentId, { requireGate = true } = {}) {
  const { root, wtDir, branch } = getWorktreePaths(workdir, agentId);
  if (requireGate && !isGatePassing(root)) {
    throw new Error(`Refusing to merge ${branch}: Verification Gate is not CLEAN/PASS.`);
  }
  if (fs.existsSync(wtDir)) {
    const dirty = runGit(wtDir, ['status', '--porcelain']);
    if (dirty) {
      runGit(wtDir, ['add', '-A']);
      runGit(wtDir, ['commit', '-m', `chore(teamwork): snapshot ${agentId} milestone changes`]);
    }
  }
  runGit(root, ['merge', '--no-ff', branch, '-m', `feat(teamwork): merge ${agentId} (${branch})`]);
  return { merged: true, branch };
}

export function pruneWorktree(workdir, agentId, { deleteBranch = false } = {}) {
  const { root, wtDir, branch } = getWorktreePaths(workdir, agentId);
  if (fs.existsSync(wtDir)) {
    runGit(root, ['worktree', 'remove', '--force', wtDir]);
  }
  runGit(root, ['worktree', 'prune']);
  if (deleteBranch) {
    try {
      runGit(root, ['branch', '-D', branch]);
    } catch {
      // ignore if already deleted
    }
  }
  return { pruned: true, wtDir: normalizePosix(wtDir), branch };
}
