import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix } from '../core/frontmatter.mjs';
import { evaluateLatestGate, getActiveOrchestrator, getTeamworkRoot } from './state-machine.mjs';

function runGit(workdir, gitArgs) {
  return execFileSync('git', gitArgs, { cwd: workdir, encoding: 'utf8', stdio: 'pipe' }).trimEnd();
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
    if (fs.existsSync(path.join(wtDir, '.git'))) {
      return { created: false, wtDir: normalizePosix(wtDir), branch, note: 'Worktree already exists' };
    }
    const leftovers = fs.readdirSync(wtDir);
    if (leftovers.length > 0) {
      throw new Error(`Refusing to overwrite non-empty directory without .git at ${wtDir}`);
    }
    fs.rmSync(wtDir, { recursive: true, force: true });
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
  const hasWtGit = fs.existsSync(path.join(wtDir, '.git'));
  const statusOut = hasWtGit ? runGit(wtDir, ['status', '--short']) : '';
  let diffFiles = [];
  try {
    const names = runGit(root, ['diff', '--name-only', `HEAD...${branch}`]);
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
  return evaluateLatestGate(fs.readFileSync(gatePath, 'utf8')).passed;
}

export function mergeWorktree(workdir, agentId, { requireGate = true } = {}) {
  const { root, wtDir, branch } = getWorktreePaths(workdir, agentId);
  if (requireGate && !isGatePassing(root)) {
    throw new Error(`Refusing to merge ${branch}: Verification Gate is not CLEAN/PASS.`);
  }
  const mainDirty = runGit(root, ['status', '--porcelain', '--untracked-files=no']).trim();
  if (mainDirty) {
    const files = mainDirty
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 5)
      .join(', ');
    throw new Error(
      `Refusing to merge ${branch}: main worktree has uncommitted tracked changes (${files}). Commit or stash them before merging.`
    );
  }
  if (fs.existsSync(path.join(wtDir, '.git'))) {
    const dirtyRaw = runGit(wtDir, ['status', '--porcelain', '-uall']);
    const dirtyPaths = dirtyRaw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const rawPath = line.slice(3).trim();
        const finalPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
        return finalPath.replace(/^"|"$/g, '');
      })
      .filter((p) => p && !p.startsWith('.agents/') && p !== '.agents');
    if (dirtyPaths.length > 0) {
      runGit(wtDir, ['add', '-A', '--', ...dirtyPaths]);
      runGit(wtDir, ['commit', '-m', `chore(teamwork): snapshot ${agentId} milestone changes`]);
    }
  }
  try {
    runGit(root, ['merge', '--no-ff', branch, '-m', `feat(teamwork): merge ${agentId} (${branch})`]);
  } catch (err) {
    try {
      runGit(root, ['merge', '--abort']);
    } catch {
      // ignore if merge state already clean
    }
    throw err;
  }
  return { merged: true, branch };
}

export function pruneWorktree(workdir, agentId, { deleteBranch = false } = {}) {
  const { root, wtDir, branch } = getWorktreePaths(workdir, agentId);
  if (fs.existsSync(wtDir)) {
    if (fs.existsSync(path.join(wtDir, '.git'))) {
      runGit(root, ['worktree', 'remove', '--force', wtDir]);
    } else if (fs.readdirSync(wtDir).length === 0) {
      fs.rmSync(wtDir, { recursive: true, force: true });
    }
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
