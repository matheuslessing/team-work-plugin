import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';
import {
  EDIT_TOOLS,
  EXEC_TOOLS,
  extractCommand,
  extractMutatorWriteTargets,
  extractRedirectTargets,
  extractTargetPath,
  splitUnquoted,
  stripHeredocBodies,
  tokenizeArgs,
  unwrapCommandTokens
} from '../scripts/core/hasp-runner.mjs';
import { validateSkillDir } from '../scripts/core/validator.mjs';

export const meta = {
  id: 'pf-skill-contract-guard',
  version: '1.2.0',
  event: 'PostToolUse'
};

function isForgeCliStage(stage) {
  const cmdTokens = unwrapCommandTokens(tokenizeArgs(stage));
  if (cmdTokens.length < 2) return false;
  const bin = path.basename(cmdTokens[0]).toLowerCase().replace(/\.exe$/, '');
  if (!bin.startsWith('node')) return false;
  const scriptTok = cmdTokens.slice(1).find((t) => !t.startsWith('-')) || '';
  return /(?:^|[\\/])forge-cli\.mjs$/.test(scriptTok);
}

function getSkillDirs(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const baseCwd = path.resolve(state.execCwd || state.baseCwd || workdir);
  const tool = action?.tool || '';

  if (EDIT_TOOLS.has(tool)) {
    const target = normalizePosix(extractTargetPath(action));
    if (!target) return [];
    const base = path.basename(target);
    if (base !== 'SKILL.md' && base !== 'skill.contract.json') return [];
    const skillDir = path.dirname(path.resolve(baseCwd, target));
    return fs.existsSync(skillDir) ? [skillDir] : [];
  }

  if (EXEC_TOOLS.has(tool)) {
    const stripped = stripHeredocBodies(extractCommand(action));
    if (!stripped.trim()) return [];
    let effectiveCwd = baseCwd;
    const dirs = [];
    const seen = new Set();

    for (const seg of splitUnquoted(stripped, 'commands')) {
      const toks = tokenizeArgs(seg);
      if (toks[0] === 'cd' && toks[1] && !toks[1].startsWith('-')) {
        effectiveCwd = path.resolve(effectiveCwd, toks[1]);
        continue;
      }
      const stages = splitUnquoted(seg, 'pipes');
      if (stages.every((s) => isForgeCliStage(s))) continue;

      const writeTargets = [
        ...extractRedirectTargets(seg),
        ...stages.flatMap((s) => (isForgeCliStage(s) ? [] : extractMutatorWriteTargets(s)))
      ];
      for (const m of writeTargets) {
        const base = path.basename(normalizePosix(m));
        if (base !== 'SKILL.md' && base !== 'skill.contract.json') continue;
        const full = path.resolve(effectiveCwd, m);
        if (!fs.existsSync(full)) continue;
        const skillDir = path.dirname(full);
        if (fs.existsSync(skillDir) && !seen.has(skillDir)) {
          seen.add(skillDir);
          dirs.push(skillDir);
        }
      }
    }
    return dirs;
  }

  return [];
}

export function should_activate(state, action) {
  return getSkillDirs(state, action).length > 0;
}

export function intervene(state, action) {
  const skillDirs = getSkillDirs(state, action);
  const failures = [];
  for (const skillDir of skillDirs) {
    const res = validateSkillDir(skillDir);
    if (!res.ok) {
      failures.push({ skillDir, errors: res.errors });
    }
  }
  if (failures.length === 0) return { type: 'NOOP' };

  return {
    type: 'INJECT_CONTEXT',
    reason: `Skill ${failures.map((f) => path.basename(f.skillDir)).join(', ')} violates SkillOps 5-tuple standard`,
    payload: failures
      .map(
        (f) =>
          `[HASP:pf-skill-contract-guard] Fix SkillOps contract/frontmatter in ${normalizePosix(f.skillDir)}:\n- ${f.errors.join('\n- ')}`
      )
      .join('\n\n')
  };
}
