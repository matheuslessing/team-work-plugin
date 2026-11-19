import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens, normalizePosix, parseFrontmatter, serializeFrontmatter, sha256Hex } from '../core/frontmatter.mjs';
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
    const skillMdRaw = fs.existsSync(path.join(dir, 'SKILL.md')) ? fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8') : '';
    const contractRaw = fs.existsSync(path.join(dir, 'skill.contract.json'))
      ? fs.readFileSync(path.join(dir, 'skill.contract.json'), 'utf8')
      : '';
    nodes.push({
      id: name,
      version: contract.version || '0.0.0',
      description: desc,
      token_budget_tier: contract.token_budget_tier || 'medium',
      authority_profile: contract.O_operation?.authority_profile || 'unknown',
      program_functions: contract.O_operation?.program_functions || [],
      line_count: res.meta?.lineCount || 0,
      token_estimate: res.meta?.tokenEstimate || 0,
      content_sha256: sha256Hex(`${skillMdRaw}\n${contractRaw}`),
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

export function auditSkills(skillsDir, { strict = false, telemetryPath = null } = {}) {
  const abs = path.resolve(skillsDir);
  const dirs = listSkillDirs(abs);
  const errors = [];
  const warnings = [];
  const maintenanceActions = [];
  const validSkills = [];
  const programsDir = path.join(path.dirname(abs), 'programs');
  const hasProgramsDir = fs.existsSync(programsDir);

  let baselineBySkill = new Map();
  const baselineGraphPath = path.join(abs, 'ecosystem-graph.json');
  if (fs.existsSync(baselineGraphPath)) {
    try {
      const prevGraph = JSON.parse(fs.readFileSync(baselineGraphPath, 'utf8'));
      baselineBySkill = new Map((prevGraph.nodes || []).map((n) => [n.id, n]));
    } catch {
      // ignore invalid baseline graph
    }
  }

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
    const prevNode = baselineBySkill.get(name);
    if (prevNode?.content_sha256 && contract) {
      const skillMdRaw = fs.existsSync(path.join(dir, 'SKILL.md')) ? fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8') : '';
      const contractRaw = fs.existsSync(path.join(dir, 'skill.contract.json'))
        ? fs.readFileSync(path.join(dir, 'skill.contract.json'), 'utf8')
        : '';
      const currentSha = sha256Hex(`${skillMdRaw}\n${contractRaw}`);
      if (currentSha !== prevNode.content_sha256 && prevNode.version === contract.version) {
        warnings.push(
          `[${name}] Silent modification detected without version bump (${contract.version}) — run skillops graph or bump semver`
        );
      }
    }

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

  const resolvedTelemetry =
    telemetryPath || path.resolve(abs, '..', '..', '.agents', 'teamwork', 'skill-telemetry.jsonl');
  if (resolvedTelemetry && fs.existsSync(resolvedTelemetry)) {
    const tel = summarizeTelemetry(resolvedTelemetry);
    for (const [skillName, st] of Object.entries(tel.skills || {})) {
      const failRate = st.invocations > 0 ? st.failures / st.invocations : 0;
      if (st.invocations >= 3 && failRate >= 0.6) {
        maintenanceActions.push({
          skill: skillName,
          action: 'retire',
          reason: `High failure rate in telemetry (${st.failures}/${st.invocations} = ${Math.round(failRate * 100)}%)`
        });
      }
    }
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

function hasEvolutionEvidence(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  if (fs.existsSync(path.join(root, 'tests', 'evals', 'skill-use', 'suite.json'))) return true;
  if (fs.existsSync(path.join(root, '.agents', 'teamwork', 'skill-bom.json'))) return true;
  const twRoot = path.join(root, '.agents', 'teamwork');
  if (fs.existsSync(twRoot)) {
    for (const entry of fs.readdirSync(twRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^orchestrator_\d+$/.test(entry.name)) continue;
      const dePath = path.join(twRoot, entry.name, 'DEAD_ENDS.md');
      if (fs.existsSync(dePath)) {
        const rows = fs
          .readFileSync(dePath, 'utf8')
          .split(/\r?\n/)
          .filter((l) => l.trim().startsWith('|') && !l.includes('Approach Tried') && !l.includes('---'));
        if (rows.length > 0) return true;
      }
    }
  }
  return false;
}

export function triageSkills({ targetPath = '', workspaceRoot = process.cwd() } = {}) {
  const root = path.resolve(workspaceRoot);
  const absTarget = targetPath ? path.resolve(root, targetPath) : path.join(root, '.agents', 'skills');
  const relTarget = normalizePosix(path.relative(root, absTarget)) || '.';

  if (!fs.existsSync(absTarget)) {
    return {
      action: 'SCAFFOLD',
      target: relTarget,
      reason: 'Target skill or skills directory does not exist yet.',
      next_command: '/forge-skill',
      details: {}
    };
  }

  const stat = fs.statSync(absTarget);
  if (stat.isFile()) {
    if (absTarget.endsWith('.md')) {
      return {
        action: 'MIGRATE',
        target: relTarget,
        reason: 'Single Markdown file without SkillOps contract directory.',
        next_command: '/forge-migrate-skill',
        details: analyzeLegacySkill(absTarget)
      };
    }
    return {
      action: 'SKILLOPS_FIX',
      target: relTarget,
      reason: 'Target file is not a valid skill directory.',
      next_command: '/forge-validate',
      details: {}
    };
  }

  const hasSkillMd = fs.existsSync(path.join(absTarget, 'SKILL.md'));
  const hasContract = fs.existsSync(path.join(absTarget, 'skill.contract.json'));

  if (hasSkillMd && !hasContract) {
    return {
      action: 'MIGRATE',
      target: relTarget,
      reason: 'Legacy skill folder has SKILL.md without skill.contract.json.',
      next_command: '/forge-migrate-skill',
      details: analyzeLegacySkill(absTarget)
    };
  }

  if (hasSkillMd && hasContract) {
    const val = validateSkillDir(absTarget);
    if (!val.ok || val.warnings.length > 0) {
      return {
        action: 'SKILLOPS_FIX',
        target: relTarget,
        reason: !val.ok ? val.errors.join('; ') : val.warnings.join('; '),
        next_command: '/forge-validate',
        details: val
      };
    }
    if (hasEvolutionEvidence(root)) {
      return {
        action: 'EVAL_EVOLVE',
        target: relTarget,
        reason: 'Skill is valid and evolution/eval signals exist in workspace.',
        next_command: '/forge-evolve',
        details: { name: val.meta?.name }
      };
    }
    return {
      action: 'CLEAN',
      target: relTarget,
      reason: 'Skill passes SkillOps 5-tuple & security checks cleanly.',
      next_command: 'none',
      details: { name: val.meta?.name }
    };
  }

  // Directory containing multiple skills
  const subDirs = fs
    .readdirSync(absTarget, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(absTarget, d.name));

  if (subDirs.length === 0) {
    return {
      action: 'SCAFFOLD',
      target: relTarget,
      reason: 'Skills directory exists but contains no skill folders.',
      next_command: '/forge-skill',
      details: {}
    };
  }

  const legacyFolders = subDirs
    .filter((d) => fs.existsSync(path.join(d, 'SKILL.md')) && !fs.existsSync(path.join(d, 'skill.contract.json')))
    .map((d) => normalizePosix(path.relative(root, d)));

  if (legacyFolders.length > 0) {
    return {
      action: 'MIGRATE',
      target: relTarget,
      reason: `Found ${legacyFolders.length} legacy skill(s) missing skill.contract.json.`,
      next_command: '/forge-migrate-skill',
      details: { legacy_folders: legacyFolders }
    };
  }

  const audit = auditSkills(absTarget, { strict: true });
  if (!audit.ok || audit.warnings.length > 0 || audit.maintenanceActions.length > 0) {
    return {
      action: 'SKILLOPS_FIX',
      target: relTarget,
      reason: audit.errors[0] || audit.warnings[0] || audit.maintenanceActions[0]?.reason || 'SkillOps audit flagged issues.',
      next_command: '/forge-skillops',
      details: {
        errors: audit.errors,
        warnings: audit.warnings,
        maintenanceActions: audit.maintenanceActions
      }
    };
  }

  if (hasEvolutionEvidence(root)) {
    return {
      action: 'EVAL_EVOLVE',
      target: relTarget,
      reason: 'All skills pass SkillOps audit and workspace has eval/BOM/dead-end signals.',
      next_command: '/forge-evolve',
      details: { totalSkills: audit.totalSkills }
    };
  }

  return {
    action: 'CLEAN',
    target: relTarget,
    reason: `All ${audit.totalSkills} skill(s) pass SkillOps audit with zero warnings or pending maintenance.`,
    next_command: 'none',
    details: { totalSkills: audit.totalSkills }
  };
}
