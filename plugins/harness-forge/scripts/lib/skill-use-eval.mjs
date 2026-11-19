import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix, parseFrontmatter } from '../core/frontmatter.mjs';
import { runProgramFunctions } from '../core/hasp-runner.mjs';
import { listSkillDirs } from './skillops.mjs';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 2);
}

function loadLevel1Catalog(skillsDirs) {
  const items = [];
  for (const dir of skillsDirs) {
    for (const sDir of listSkillDirs(dir)) {
      const skillMd = path.join(sDir, 'SKILL.md');
      const contractPath = path.join(sDir, 'skill.contract.json');
      if (!fs.existsSync(skillMd) || !fs.existsSync(contractPath)) continue;
      const raw = fs.readFileSync(skillMd, 'utf8');
      const fm = parseFrontmatter(raw);
      const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
      items.push({
        name: fm.data.name || path.basename(sDir),
        description: fm.data.description || contract.description || '',
        skillDir: sDir,
        pluginRoot: path.resolve(sDir, '..', '..'),
        rawBody: fm.body,
        contract
      });
    }
  }
  return items;
}

function selectSkillProgressiveDisclosure(prompt, catalog) {
  const lowerPrompt = String(prompt || '').toLowerCase();
  // Explicit slash trigger check first
  for (const item of catalog) {
    if (new RegExp(`(?:^|\\s)/${item.name}(?:\\s|$)`).test(lowerPrompt)) {
      return { selected: item.name, score: 100 };
    }
  }

  const qTokens = new Set(tokenize(prompt));
  let best = { selected: null, score: -1 };
  for (const item of catalog) {
    const docTokens = tokenize(`${item.name.replace(/-/g, ' ')} ${item.description}`);
    let hits = 0;
    for (const dt of docTokens) {
      if (qTokens.has(dt)) hits++;
    }
    const score = docTokens.length > 0 ? hits / Math.sqrt(docTokens.length) : 0;
    if (score > best.score) {
      best = { selected: item.name, score };
    }
  }
  return best;
}

export async function runSkillUseEval(suiteDirOrFile, repoRoot = process.cwd()) {
  const abs = path.resolve(repoRoot, suiteDirOrFile);
  const suiteFile = fs.statSync(abs).isDirectory() ? path.join(abs, 'suite.json') : abs;
  const suite = JSON.parse(fs.readFileSync(suiteFile, 'utf8'));

  const skillsDirs = (suite.skills_dirs || []).map((d) => path.resolve(repoRoot, d));
  const catalog = loadLevel1Catalog(skillsDirs);
  const catalogByName = new Map(catalog.map((c) => [c.name, c]));

  const scenarios = suite.scenarios || [];
  const results = [];

  for (const sc of scenarios) {
    // 1. Trigger Score (Progressive Disclosure: Level-1 name+description only)
    const trig = selectSkillProgressiveDisclosure(sc.prompt, catalog);
    const triggerPass = trig.selected === sc.expected_skill ? 1 : 0;

    const item = catalogByName.get(sc.expected_skill);

    // 2. Compliance Score (required steps/commands/validators/artifacts present in contract+SKILL.md)
    let compliancePass = 0;
    const complianceMissing = [];
    if (item) {
      const combined = `${item.rawBody}\n${JSON.stringify(item.contract)}`.toLowerCase();
      const checks = sc.compliance_keywords || [];
      let matched = 0;
      for (const kw of checks) {
        if (combined.includes(String(kw).toLowerCase())) matched++;
        else complianceMissing.push(kw);
      }
      compliancePass = checks.length > 0 ? matched / checks.length : 1;
    }

    // 3. Boundary Score (HASP PreToolUse/PostToolUse actually blocks/flags forbidden_action)
    let boundaryPass = 1;
    let boundaryDetail = 'no_forbidden_probe';
    if (sc.forbidden_action && item) {
      const programsDir = path.join(item.pluginRoot, 'programs');
      const scope = {
        role: sc.forbidden_action.role || item.expected_role || 'agent',
        authority_profile: item.contract.O_operation?.authority_profile || 'read_only',
        allowed_write_globs: item.contract.O_operation?.allowed_write_globs || [],
        status: 'active'
      };
      const pfRes = await runProgramFunctions({
        programsDir,
        event: sc.forbidden_action.event || 'PreToolUse',
        state: {
          workdir: repoRoot,
          activeAgentId: sc.forbidden_action.agentId || 'eval_agent',
          activeScope: scope
        },
        action: {
          event: sc.forbidden_action.event || 'PreToolUse',
          tool: sc.forbidden_action.tool,
          args: sc.forbidden_action.args || {}
        }
      });
      const expectedDecision = sc.forbidden_action.expected_decision || 'BLOCK';
      boundaryPass = pfRes.decision === expectedDecision ? 1 : 0;
      boundaryDetail = `expected=${expectedDecision}, got=${pfRes.decision}`;
    }

    // Gated Skill-Use Score (arXiv:2608.04828): Trigger * (0.5 * Compliance + 0.5 * Boundary)
    const suScore = triggerPass * (0.5 * compliancePass + 0.5 * boundaryPass);
    results.push({
      id: sc.id,
      expected_skill: sc.expected_skill,
      triggered_skill: trig.selected,
      trigger: triggerPass,
      compliance: Number(compliancePass.toFixed(3)),
      boundary: Number(boundaryPass.toFixed(3)),
      su_score: Number(suScore.toFixed(3)),
      compliance_missing: complianceMissing,
      boundary_detail: boundaryDetail
    });
  }

  const count = results.length || 1;
  const avg = (key) => Number((results.reduce((s, r) => s + r[key], 0) / count).toFixed(4));

  return {
    suite: normalizePosix(suiteFile),
    total_scenarios: results.length,
    metrics: {
      trigger_rate: avg('trigger'),
      compliance_rate: avg('compliance'),
      boundary_rate: avg('boundary'),
      su_score: avg('su_score')
    },
    scenarios: results
  };
}
