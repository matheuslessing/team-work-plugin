import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens, normalizePosix, parseFrontmatter, serializeFrontmatter } from '../core/frontmatter.mjs';
import { validateSkillDir } from '../core/validator.mjs';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function listSkillDirs(skillsDir) {
  const abs = path.resolve(skillsDir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(abs, d.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'SKILL.md')) || fs.existsSync(path.join(dir, 'skill.contract.json')))
    .sort();
}

export function buildEcosystemGraph(skillsDir, { write = false } = {}) {
  const abs = path.resolve(skillsDir);
  const dirs = listSkillDirs(abs);
  const nodes = [];
  const edges = [];
  const tokenSets = new Map();

  for (const dir of dirs) {
    const res = validateSkillDir(dir);
    const name = res.meta?.name || path.basename(dir);
    const contract = res.meta?.contract || {};
    const desc = res.meta?.description || '';
    nodes.push({
      id: name,
      version: contract.version || '0.0.0',
      description: desc,
      token_budget_tier: contract.token_budget_tier || 'medium',
      authority_profile: contract.O_operation?.authority_profile || 'unknown',
      program_functions: contract.O_operation?.program_functions || [],
      line_count: res.meta?.lineCount || 0,
      token_estimate: res.meta?.tokenEstimate || 0,
      valid: res.ok
    });
    tokenSets.set(name, new Set(tokenize(`${name} ${desc}`)));

    const ce = contract.ecosystem_edges || {};
    for (const relType of ['depends_on', 'compatible_with', 'redundant_with', 'alternative_to']) {
      for (const target of Array.isArray(ce[relType]) ? ce[relType] : []) {
        edges.push({ from: name, to: target, type: relType });
      }
    }
    if (ce.lineage) {
      edges.push({ from: name, to: ce.lineage, type: 'lineage' });
    }
  }

  // Automatic similarity detection for undocumented redundancy
  const candidateRedundancies = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const sim = jaccard(tokenSets.get(a.id), tokenSets.get(b.id));
      const declaredAlt = edges.some(
        (e) => ((e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id)) && (e.type === 'alternative_to' || e.type === 'redundant_with')
      );
      if (sim >= 0.55 && !declaredAlt) {
        candidateRedundancies.push({
          a: a.id,
          b: b.id,
          similarity: Number(sim.toFixed(3))
        });
      }
    }
  }

  const graph = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    skills_dir: normalizePosix(abs),
    nodes,
    edges,
    candidate_redundancies: candidateRedundancies
  };

  if (write) {
    const outPath = path.join(abs, 'ecosystem-graph.json');
    const tmp = `${outPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(graph, null, 2), 'utf8');
    fs.renameSync(tmp, outPath);
  }

  return graph;
}

export function auditSkills(skillsDir, { strict = false } = {}) {
  const abs = path.resolve(skillsDir);
  const dirs = listSkillDirs(abs);
  const errors = [];
  const warnings = [];
  const maintenanceActions = [];
  const validSkills = [];
  const programsDir = path.join(path.dirname(abs), 'programs');
  const hasProgramsDir = fs.existsSync(programsDir);

  for (const dir of dirs) {
    const res = validateSkillDir(dir);
    const name = res.meta?.name || path.basename(dir);
    if (!res.ok) {
      errors.push(...res.errors.map((e) => `[${name}] ${e}`));
      maintenanceActions.push({ skill: name, action: 'repair', reason: res.errors.join('; ') });
    } else {
      validSkills.push(name);
    }
    warnings.push(...res.warnings.map((w) => `[${name}] ${w}`));

    const contract = res.meta?.contract;
    if (contract && hasProgramsDir) {
      for (const pfId of contract.O_operation?.program_functions || []) {
        const pfFile = path.join(programsDir, `${pfId}.pf.mjs`);
        if (!fs.existsSync(pfFile)) {
          const msg = `[${name}] References missing HASP Program Function "${pfId}" (${normalizePosix(pfFile)})`;
          if (strict) errors.push(msg);
          else warnings.push(msg);
          maintenanceActions.push({ skill: name, action: 'add_adapter', reason: msg });
        }
      }
    }
  }

  const graph = buildEcosystemGraph(abs, { write: false });
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    if (edge.type === 'lineage') continue;
    if (!nodeIds.has(edge.to)) {
      const msg = `[${edge.from}] Ecosystem edge "${edge.type}" targets unknown skill "${edge.to}" in ${abs}`;
      warnings.push(msg);
    }
  }

  for (const red of graph.candidate_redundancies) {
    warnings.push(`Potential skill overlap (${red.similarity}): ${red.a} <-> ${red.b}`);
    maintenanceActions.push({
      skill: `${red.a},${red.b}`,
      action: 'merge',
      reason: `High description overlap (${red.similarity}) without alternative_to edge`
    });
  }

  return {
    ok: errors.length === 0,
    skillsDir: normalizePosix(abs),
    totalSkills: dirs.length,
    validSkillsCount: validSkills.length,
    errors,
    warnings,
    maintenanceActions,
    graph
  };
}

export function resolveSkillTargetDir({ scope = 'project', target = '', workspaceRoot = process.cwd(), pluginRoot = '' }) {
  const root = path.resolve(workspaceRoot);
  if (target) {
    return path.resolve(root, target);
  }
  if (scope === 'global') {
    const home = process.env.HOME || process.env.USERPROFILE || root;
    return path.join(home, '.devin', 'skills');
  }
  if (scope === 'plugin' && pluginRoot) {
    return path.join(path.resolve(pluginRoot), 'skills');
  }
  return path.join(root, '.agents', 'skills');
}

export function scaffoldSkill(targetSkillsDir, {
  name,
  description,
  authorityProfile = 'scoped_worker',
  allowedWriteGlobs = ['.agents/**'],
  runtimes = ['DEVIN_CLI_LOCAL', 'DEVIN_CLOUD', 'ANTIGRAVITY'],
  phases = ['MANUAL'],
  tokenBudgetTier = 'low',
  programFunctions = [],
  validatorCmd = 'node --version',
  body = ''
}) {
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid skill name "${name}". Must be kebab-case.`);
  }
  if (!description || description.trim().length < 10) {
    throw new Error('Skill description must be at least 10 characters.');
  }

  const skillDir = path.join(path.resolve(targetSkillsDir), name);
  fs.mkdirSync(skillDir, { recursive: true });

  const skillMdBody =
    body.trim() ||
    `# ${name}\n\n${description}\n\n## Steps\n1. Validate preconditions before editing.\n2. Execute within assigned authority profile (\`${authorityProfile}\`).\n3. Run postcondition validator before concluding.\n`;

  const skillMdContent = serializeFrontmatter(
    {
      name,
      description,
      triggers: ['user', 'model']
    },
    skillMdBody
  );

  const contract = {
    $schema: 'https://teamwork-suite.dev/schemas/skill-contract.v1.json',
    name,
    version: '1.0.0',
    description,
    token_budget_tier: tokenBudgetTier,
    eligibility: {
      phases,
      runtimes
    },
    P_preconditions: [],
    O_operation: {
      authority_profile: authorityProfile,
      allowed_write_globs: allowedWriteGlobs,
      denied_shell_patterns: [],
      program_functions: programFunctions
    },
    A_artifacts: [],
    V_validators: [
      { cmd: validatorCmd, description: 'Post-execution verification check' }
    ],
    F_failure_modes: [
      { code: 'PRECONDITION_FAILED', action: 'BLOCK_EXECUTION', route_to: 'user' }
    ],
    ecosystem_edges: {
      depends_on: [],
      compatible_with: [],
      redundant_with: [],
      alternative_to: [],
      lineage: `${name}@1.0.0`
    }
  };

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf8');
  fs.writeFileSync(path.join(skillDir, 'skill.contract.json'), JSON.stringify(contract, null, 2) + '\n', 'utf8');

  const check = validateSkillDir(skillDir);
  if (!check.ok) {
    throw new Error(`Scaffolded skill failed validation: ${check.errors.join('; ')}`);
  }

  return {
    ok: true,
    skillDir: normalizePosix(skillDir),
    name,
    token_estimate: estimateTokens(skillMdContent)
  };
}

export function analyzeLegacySkill(legacyPath) {
  const full = path.resolve(legacyPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Legacy skill not found: ${full}`);
  }
  const stat = fs.statSync(full);
  const skillMdPath = stat.isDirectory() ? path.join(full, 'SKILL.md') : full;
  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`No SKILL.md found at ${skillMdPath}`);
  }
  const raw = fs.readFileSync(skillMdPath, 'utf8');
  const fm = parseFrontmatter(raw);
  const dir = path.dirname(skillMdPath);
  const hasContract = fs.existsSync(path.join(dir, 'skill.contract.json'));
  const lineCount = raw.split(/\r?\n/).length;

  const issues = [];
  if (!fm.hasFrontmatter) issues.push('Missing YAML frontmatter');
  if (!fm.data.name) issues.push('Missing frontmatter "name"');
  if (!fm.data.description || String(fm.data.description).length < 10) issues.push('Missing/short frontmatter "description"');
  if (!hasContract) issues.push('Missing SkillOps typed skill.contract.json (5-tuple P, O, A, V, F)');
  if (lineCount > 220) issues.push(`Context bloat (${lineCount} lines) — extract references/ for Progressive Disclosure`);

  const inferredName = (fm.data.name || path.basename(dir).replace(/[^a-z0-9-]+/gi, '-').toLowerCase()).replace(/^-|-$/g, '') || 'migrated-skill';
  const inferredDesc = fm.data.description || `Migrated skill from ${path.basename(skillMdPath)}`;
  const mentionsEdit = /\b(edit|write|create|modify|refactor)\b/i.test(fm.body);

  return {
    sourcePath: normalizePosix(skillMdPath),
    inferredName,
    inferredDescription: inferredDesc,
    lineCount,
    hasContract,
    issues,
    suggestedAuthorityProfile: mentionsEdit ? 'scoped_worker' : 'read_only'
  };
}

export function recordTelemetry(telemetryPath, event) {
  fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
  fs.appendFileSync(
    telemetryPath,
    JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n',
    'utf8'
  );
}

export function summarizeTelemetry(telemetryPath) {
  if (!fs.existsSync(telemetryPath)) return { skills: {} };
  const lines = fs.readFileSync(telemetryPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const stats = {};
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      const name = ev.skill || 'unknown';
      stats[name] = stats[name] || { invocations: 0, successes: 0, failures: 0, avg_tokens: 0, total_tokens: 0 };
      stats[name].invocations++;
      if (ev.success) stats[name].successes++;
      else stats[name].failures++;
      stats[name].total_tokens += Number(ev.tokens || 0);
      stats[name].avg_tokens = Math.round(stats[name].total_tokens / stats[name].invocations);
    } catch {
      // ignore
    }
  }
  return { skills: stats };
}
