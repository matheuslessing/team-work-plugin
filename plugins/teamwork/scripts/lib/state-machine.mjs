import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix, sha256Hex } from '../core/frontmatter.mjs';

export const VALID_PHASES = [
  'INIT',
  'SURVEY',
  'CONTRACT_FROZEN',
  'DUAL_TRACK',
  'GATE',
  'REMEDIATION',
  'VICTORY_AUDIT',
  'DONE',
  'FAILED'
];

export const VALID_TRANSITIONS = {
  INIT: ['SURVEY', 'DUAL_TRACK', 'GATE', 'DONE', 'FAILED'],
  SURVEY: ['CONTRACT_FROZEN', 'DUAL_TRACK', 'GATE', 'DONE', 'FAILED'],
  CONTRACT_FROZEN: ['DUAL_TRACK', 'GATE', 'FAILED'],
  DUAL_TRACK: ['GATE', 'REMEDIATION', 'FAILED'],
  GATE: ['REMEDIATION', 'VICTORY_AUDIT', 'DONE', 'FAILED'],
  REMEDIATION: ['GATE', 'VICTORY_AUDIT', 'FAILED'],
  VICTORY_AUDIT: ['DONE', 'REMEDIATION', 'FAILED'],
  DONE: ['INIT', 'SURVEY', 'DUAL_TRACK', 'GATE'],
  FAILED: ['INIT', 'SURVEY', 'REMEDIATION', 'GATE']
};

export function getTeamworkRoot(workdir) {
  return path.join(path.resolve(workdir), '.agents', 'teamwork');
}

export function getStatePath(workdir) {
  return path.join(getTeamworkRoot(workdir), 'state.json');
}

export function getActiveOrchestrator(workdir) {
  const statePath = getStatePath(workdir);
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (state.active_orchestrator && /^orchestrator_\d+$/.test(state.active_orchestrator)) {
        return {
          id: state.active_orchestrator,
          gen: Number(state.active_orchestrator.split('_')[1])
        };
      }
    } catch {
      // fall back to directory scan
    }
  }

  const teamworkRoot = getTeamworkRoot(workdir);
  if (!fs.existsSync(teamworkRoot)) return { id: 'orchestrator_1', gen: 1 };
  const dirs = fs
    .readdirSync(teamworkRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^orchestrator_\d+$/.test(d.name))
    .map((d) => ({ id: d.name, gen: Number(d.name.split('_')[1]) }))
    .sort((a, b) => b.gen - a.gen);
  return dirs[0] || { id: 'orchestrator_1', gen: 1 };
}

export function createInitialState(workdir, { mode = 'full', runtime = 'DEVIN_CLI_LOCAL' } = {}) {
  const now = new Date().toISOString();
  const active = getActiveOrchestrator(workdir);
  return {
    schema_version: '1.0.0',
    mode,
    runtime,
    phase: 'INIT',
    active_orchestrator: active.id,
    contract_sha256: null,
    milestones: {},
    active_agent_scopes: {},
    budgets: {
      max_spawns: 16,
      spawns_used: 0,
      max_remediations: 3,
      remediations_used: 0,
      max_turns: 80
    },
    gate_iterations: [],
    history: [
      {
        from: null,
        to: 'INIT',
        reason: 'Initialized Teamwork LTS state machine',
        timestamp: now
      }
    ],
    updated_at: now
  };
}

export function loadState(workdir) {
  const statePath = getStatePath(workdir);
  if (!fs.existsSync(statePath)) {
    return createInitialState(workdir);
  }
  const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const active = getActiveOrchestratorFromDirs(workdir, raw.active_orchestrator);
  raw.active_orchestrator = active;
  return raw;
}

function getActiveOrchestratorFromDirs(workdir, current) {
  const teamworkRoot = getTeamworkRoot(workdir);
  if (!fs.existsSync(teamworkRoot)) return current || 'orchestrator_1';
  const dirs = fs
    .readdirSync(teamworkRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^orchestrator_\d+$/.test(d.name))
    .map((d) => ({ id: d.name, gen: Number(d.name.split('_')[1]) }))
    .sort((a, b) => b.gen - a.gen);
  if (dirs.length === 0) return current || 'orchestrator_1';
  const curGen = current && /^orchestrator_\d+$/.test(current) ? Number(current.split('_')[1]) : 0;
  return dirs[0].gen >= curGen ? dirs[0].id : current;
}

export function saveState(workdir, state) {
  const statePath = getStatePath(workdir);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  state.updated_at = new Date().toISOString();
  const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, statePath);
  return state;
}

export function transitionPhase(workdir, toPhase, { reason = '', force = false } = {}) {
  if (!VALID_PHASES.includes(toPhase)) {
    throw new Error(`Invalid Teamwork phase: "${toPhase}". Valid: ${VALID_PHASES.join(', ')}`);
  }
  const state = loadState(workdir);
  const fromPhase = state.phase;
  if (fromPhase === toPhase) return state;

  const allowed = VALID_TRANSITIONS[fromPhase] || [];
  if (!force && !allowed.includes(toPhase)) {
    throw new Error(
      `Illegal LTS state transition: ${fromPhase} -> ${toPhase}. Allowed from ${fromPhase}: [${allowed.join(', ')}]`
    );
  }

  state.phase = toPhase;
  state.history.push({
    from: fromPhase,
    to: toPhase,
    reason: reason || `Transition ${fromPhase} -> ${toPhase}`,
    timestamp: new Date().toISOString()
  });
  return saveState(workdir, state);
}

export function registerAgentScope(workdir, {
  agentId,
  role,
  authorityProfile,
  allowedWriteGlobs = [],
  worktreePath = null,
  status = 'active',
  incrementSpawn = true
}) {
  const state = loadState(workdir);
  state.active_agent_scopes[agentId] = {
    role,
    authority_profile: authorityProfile,
    allowed_write_globs: allowedWriteGlobs.map((g) => normalizePosix(g)),
    worktree_path: worktreePath ? normalizePosix(worktreePath) : null,
    status
  };
  if (incrementSpawn) {
    state.budgets.spawns_used = (state.budgets.spawns_used || 0) + 1;
  }
  return saveState(workdir, state);
}

export function setOrchestratorGeneration(workdir, orchId) {
  const state = loadState(workdir);
  state.active_orchestrator = orchId;
  state.budgets.spawns_used = 0; // Fresh spawn budget for new orchestrator generation
  return saveState(workdir, state);
}

export function freezeContract(workdir) {
  const state = loadState(workdir);
  const orch = getActiveOrchestrator(workdir);
  const projectMdPath = path.join(getTeamworkRoot(workdir), orch.id, 'PROJECT.md');
  if (!fs.existsSync(projectMdPath)) {
    throw new Error(`Cannot freeze contracts: PROJECT.md not found at ${projectMdPath}`);
  }
  const content = fs.readFileSync(projectMdPath, 'utf8').replace(/\r\n/g, '\n');
  const match = content.match(/^##\s+Interface Contracts\s*\n([\s\S]*?)(?=^##\s+|\Z)/m);
  const contractSection = match ? match[1].trim() : content;
  if (!contractSection) {
    throw new Error(`PROJECT.md § Interface Contracts is empty (${projectMdPath})`);
  }
  const digest = sha256Hex(contractSection);
  state.contract_sha256 = digest;
  if (state.phase === 'INIT' || state.phase === 'SURVEY') {
    state.history.push({
      from: state.phase,
      to: 'CONTRACT_FROZEN',
      reason: `Frozen Interface Contracts (${digest.slice(0, 12)})`,
      timestamp: new Date().toISOString()
    });
    state.phase = 'CONTRACT_FROZEN';
  }
  saveState(workdir, state);
  return { sha256: digest, projectMdPath, phase: state.phase };
}

export function recordGateIteration(workdir, { iteration, result }) {
  const state = loadState(workdir);
  state.gate_iterations = state.gate_iterations.filter((g) => g.iteration !== iteration);
  state.gate_iterations.push({
    iteration,
    result,
    timestamp: new Date().toISOString()
  });
  state.gate_iterations.sort((a, b) => a.iteration - b.iteration);
  if (result === 'FAIL') {
    state.budgets.remediations_used = (state.budgets.remediations_used || 0) + 1;
  }
  return saveState(workdir, state);
}

export function checkBudget(workdir) {
  const state = loadState(workdir);
  const b = state.budgets;
  return {
    spawns_ok: b.spawns_used < b.max_spawns,
    remediations_ok: b.remediations_used < b.max_remediations,
    budgets: b
  };
}
