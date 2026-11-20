#!/usr/bin/env node
/**
 * Harness Forge CLI — PMSP Project Memory, SkillOps Governance, Scaffolding & Skill-Use Evals
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMemoryIndexSync, validateSkillDir } from './core/validator.mjs';
import {
  checkDrift,
  initMemory,
  promoteFromTeamwork,
  readMemoryDoc,
  readMemoryIndex,
  rebuildIndex,
  recordAdr,
  resolveMemoryRoot,
  retireMemoryDoc,
  searchMemory,
  upsertMemoryDoc
} from './lib/memory-engine.mjs';
import { runSkillUseEval } from './lib/skill-use-eval.mjs';
import {
  analyzeLegacySkill,
  auditSkills,
  buildEcosystemGraph,
  resolveSkillTargetDir,
  scaffoldSkill,
  summarizeTelemetry,
  triageSkills
} from './lib/skillops.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, '..');

const BOOLEAN_FLAGS = new Set([
  '--strict',
  '--no-stale',
  '--fail-on-drift',
  '--update-graph',
  '--no-write',
  '--json-only'
]);

function parseCli(argv) {
  const positionals = [];
  const flags = new Map();
  const seenBool = new Set();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const k = a.slice(0, eq);
        const v = a.slice(eq + 1);
        if (BOOLEAN_FLAGS.has(k)) {
          if (v !== 'false' && v !== '0') seenBool.add(k);
        } else {
          flags.set(k, v);
        }
      } else if (BOOLEAN_FLAGS.has(a)) {
        seenBool.add(a);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags.set(a, argv[i + 1]);
        i += 1;
      } else {
        seenBool.add(a);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags, seenBool };
}

const cli = parseCli(process.argv.slice(2));
const command = cli.positionals[0] || 'validate';

function getFlag(name, def = '') {
  return cli.flags.has(name) ? cli.flags.get(name) : def;
}

function hasFlag(name) {
  return cli.seenBool.has(name) || cli.flags.has(name);
}

function getNumberFlag(name, def) {
  const raw = getFlag(name, String(def));
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid numeric value for ${name}: "${raw}"`);
  }
  return num;
}

const workdir = path.resolve(getFlag('--workdir', process.env.DEVIN_PROJECT_DIR || process.cwd()));

async function cmdMemory() {
  const sub = cli.positionals[1] || 'index';
  switch (sub) {
    case 'init': {
      console.log(JSON.stringify(await initMemory(workdir), null, 2));
      break;
    }
    case 'rebuild': {
      console.log(JSON.stringify(await rebuildIndex(workdir), null, 2));
      break;
    }
    case 'index': {
      const res = await readMemoryIndex(workdir, {
        kind: getFlag('--kind', '') || null,
        tag: getFlag('--tag', '') || null
      });
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case 'search': {
      const query = getFlag('--query', cli.positionals[2] || '');
      const res = await searchMemory(workdir, query, {
        kind: getFlag('--kind', '') || null,
        tag: getFlag('--tag', '') || null,
        includeStale: !hasFlag('--no-stale'),
        limit: getNumberFlag('--limit', 10)
      });
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case 'read': {
      const id = getFlag('--id', cli.positionals[2] || '');
      if (!id) throw new Error('Usage: forge-cli.mjs memory read <id> [--section <sec>]');
      const section = getFlag('--section', '') || null;
      console.log(JSON.stringify(await readMemoryDoc(workdir, id, section), null, 2));
      break;
    }
    case 'upsert': {
      const payloadFile = getFlag('--file', '');
      const rawJson = payloadFile ? fs.readFileSync(path.resolve(workdir, payloadFile), 'utf8') : getFlag('--json', '{}');
      const payload = JSON.parse(rawJson);
      console.log(JSON.stringify(await upsertMemoryDoc(workdir, payload), null, 2));
      break;
    }
    case 'adr': {
      const title = getFlag('--title', cli.positionals[2] || '');
      const context = getFlag('--context', 'Context recorded via forge-cli.');
      const decision = getFlag('--decision', 'Decision recorded via forge-cli.');
      const consequences = getFlag('--consequences', 'Consequences documented.');
      const supersedes = getFlag('--supersedes', '') || null;
      console.log(JSON.stringify(await recordAdr(workdir, { title, context, decision, consequences, supersedes }), null, 2));
      break;
    }
    case 'retire': {
      const id = getFlag('--id', cli.positionals[2] || '');
      if (!id) throw new Error('Usage: forge-cli.mjs memory retire <id> [--status deprecated|superseded]');
      console.log(JSON.stringify(await retireMemoryDoc(workdir, id, {
        status: getFlag('--status', 'deprecated'),
        supersededBy: getFlag('--superseded-by', '') || null
      }), null, 2));
      break;
    }
    case 'drift': {
      const report = await checkDrift(workdir);
      console.log(JSON.stringify(report, null, 2));
      if (hasFlag('--fail-on-drift') && report.staleCount > 0) process.exit(2);
      break;
    }
    case 'promote': {
      console.log(JSON.stringify(await promoteFromTeamwork(workdir), null, 2));
      break;
    }
    default:
      console.error(`Unknown memory subcommand: ${sub}`);
      process.exit(1);
  }
}

function cmdSkill() {
  const sub = cli.positionals[1] || 'validate';
  if (sub === 'scaffold') {
    const targetDir = resolveSkillTargetDir({
      scope: getFlag('--scope', 'project'),
      target: getFlag('--target', ''),
      workspaceRoot: workdir,
      pluginRoot
    });
    const res = scaffoldSkill(targetDir, {
      name: getFlag('--name', cli.positionals[2] || ''),
      description: getFlag('--description', 'Standardized SkillOps skill generated by harness-forge.'),
      authorityProfile: getFlag('--authority', 'scoped_worker')
    });
    if (hasFlag('--update-graph')) {
      buildEcosystemGraph(targetDir, { write: true });
    }
    console.log(JSON.stringify(res, null, 2));
  } else if (sub === 'analyze-legacy') {
    const target = getFlag('--path', cli.positionals[2] || '');
    if (!target) throw new Error('Usage: forge-cli.mjs skill analyze-legacy <path>');
    console.log(JSON.stringify(analyzeLegacySkill(path.resolve(workdir, target)), null, 2));
  } else if (sub === 'triage') {
    const target = getFlag('--target', cli.positionals[2] || '');
    console.log(JSON.stringify(triageSkills({ targetPath: target, workspaceRoot: workdir }), null, 2));
  } else if (sub === 'validate') {
    const target = getFlag('--dir', cli.positionals[2] || '.');
    const res = validateSkillDir(path.resolve(workdir, target));
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(2);
  } else {
    console.error(`Unknown skill subcommand: ${sub}`);
    process.exit(1);
  }
}

function cmdSkillOps() {
  const sub = cli.positionals[1] || 'audit';
  const skillsDir = path.resolve(workdir, getFlag('--skills-dir', '.agents/skills'));
  if (sub === 'graph') {
    const graph = buildEcosystemGraph(skillsDir, { write: !hasFlag('--no-write') });
    console.log(JSON.stringify(graph, null, 2));
  } else if (sub === 'telemetry') {
    const telPath = getFlag('--file', path.join(workdir, '.agents', 'teamwork', 'skill-telemetry.jsonl'));
    console.log(JSON.stringify(summarizeTelemetry(path.resolve(workdir, telPath)), null, 2));
  } else if (sub === 'audit') {
    const telFlag = getFlag('--telemetry', '');
    const report = auditSkills(skillsDir, {
      strict: hasFlag('--strict'),
      telemetryPath: telFlag ? path.resolve(workdir, telFlag) : null
    });
    console.log(JSON.stringify({
      ok: report.ok,
      skillsDir: report.skillsDir,
      totalSkills: report.totalSkills,
      validSkillsCount: report.validSkillsCount,
      errors: report.errors,
      warnings: report.warnings,
      maintenanceActions: report.maintenanceActions
    }, null, 2));
    if (!report.ok) process.exit(2);
  } else {
    console.error(`Unknown skillops subcommand: ${sub}`);
    process.exit(1);
  }
}

function cmdValidate() {
  const strict = hasFlag('--strict');
  const errors = [];
  const warnings = [];
  const memRoot = resolveMemoryRoot(workdir);
  let memEntries = 0;
  if (fs.existsSync(memRoot)) {
    const memSync = validateMemoryIndexSync(memRoot, workdir);
    memEntries = memSync.entries.length;
    if (!memSync.ok) errors.push(...memSync.errors);
  }

  const projectSkillsDir = path.join(workdir, '.agents', 'skills');
  let skillCount = 0;
  if (fs.existsSync(projectSkillsDir)) {
    const skAudit = auditSkills(projectSkillsDir, { strict });
    skillCount = skAudit.totalSkills;
    if (!skAudit.ok) {
      if (skAudit.errors.length > 0) errors.push(...skAudit.errors);
      if (strict && skAudit.warnings.length > 0) {
        errors.push(...skAudit.warnings.map((w) => `[STRICT WARNING] ${w}`));
      }
    }
    warnings.push(...skAudit.warnings);
  }

  const ok = errors.length === 0;
  console.log(JSON.stringify({ ok, memoryEntries: memEntries, projectSkills: skillCount, errors, warnings }, null, 2));
  if (!ok) process.exit(2);
}

async function cmdEvalSkills() {
  const suite = getFlag('--suite', path.join(workdir, 'tests', 'evals', 'skill-use'));
  const report = await runSkillUseEval(suite, workdir);
  console.log(JSON.stringify(report, null, 2));
  const minScore = getNumberFlag('--min-score', 0);
  if (report.metrics.su_score < minScore) {
    process.exit(2);
  }
}

function shSingleQuote(val) {
  return `'${String(val).replace(/'/g, `'\\''`)}'`;
}

function cmdInstallGitHook() {
  let gitHooksDir = '';
  try {
    const relOrAbs = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: workdir,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
    gitHooksDir = path.resolve(workdir, relOrAbs);
  } catch {
    gitHooksDir = path.join(workdir, '.git', 'hooks');
  }

  if (!fs.existsSync(gitHooksDir)) {
    const gitDir = path.join(workdir, '.git');
    if (fs.existsSync(gitDir)) {
      fs.mkdirSync(gitHooksDir, { recursive: true });
    } else {
      console.error(`No Git repository / .git/hooks found at ${workdir}`);
      process.exit(2);
    }
  }

  const hookPath = path.join(gitHooksDir, 'pre-commit');
  const block = [
    '# BEGIN harness-forge',
    `node ${shSingleQuote(__filename.replace(/\\/g, '/'))} validate --workdir ${shSingleQuote(workdir.replace(/\\/g, '/'))} --strict || exit $?`,
    '# END harness-forge',
    ''
  ].join('\n');

  let nextContent = `#!/bin/sh\n${block}`;
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8').replace(/\r\n/g, '\n');
    const cleaned = existing.replace(/\n?# BEGIN harness-forge[\s\S]*?# END harness-forge\n?/g, '\n').trimEnd();
    nextContent = cleaned ? `${cleaned}\n\n${block}` : `#!/bin/sh\n${block}`;
  }

  fs.writeFileSync(hookPath, nextContent, 'utf8');
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // ignore chmod error on Windows
  }
  console.log(`Installed PMSP & SkillOps pre-commit hook at ${hookPath}`);
}

async function main() {
  switch (command) {
    case 'memory':
      await cmdMemory();
      break;
    case 'skill':
      cmdSkill();
      break;
    case 'skillops':
      cmdSkillOps();
      break;
    case 'eval-skills':
      await cmdEvalSkills();
      break;
    case 'install-git-hook':
      cmdInstallGitHook();
      break;
    case 'validate':
      cmdValidate();
      break;
    default:
      console.error(`Unknown forge-cli command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(2);
});
