import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';
import {
  EDIT_TOOLS,
  EXEC_TOOLS,
  extractCommand,
  extractPathsFromCommand,
  extractTargetPath,
  isMutatingShellCommand
} from '../scripts/core/hasp-runner.mjs';
import { validateSkillDir } from '../scripts/core/validator.mjs';

export const meta = {
  id: 'pf-skill-contract-guard',
  version: '1.1.0',
  event: 'PostToolUse'
};

function getSkillDirs(workdir, action) {
  const tool = action?.tool || '';
  if (EDIT_TOOLS.has(tool)) {
    const target = normalizePosix(extractTargetPath(action));
    if (!target) return [];
    const base = path.basename(target);
    if (base !== 'SKILL.md' && base !== 'skill.contract.json') return [];
    const full = path.resolve(workdir, target);
    const skillDir = path.dirname(full);
    return fs.existsSync(skillDir) ? [skillDir] : [];
  }
  if (EXEC_TOOLS.has(tool)) {
    const cmd = extractCommand(action);
    if (!cmd || /\bforge-cli\.mjs\b/i.test(cmd) || !isMutatingShellCommand(cmd)) return [];
    const matches = extractPathsFromCommand(
      cmd,
      /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]*(?:SKILL\.md|skill\.contract\.json)/g
    );
    const dirs = [];
    const seen = new Set();
    for (const m of matches) {
      const full = path.resolve(workdir, m);
      if (!fs.existsSync(full)) continue;
      const skillDir = path.dirname(full);
      if (fs.existsSync(skillDir) && !seen.has(skillDir)) {
        seen.add(skillDir);
        dirs.push(skillDir);
      }
    }
    return dirs;
  }
  return [];
}

export function should_activate(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  return getSkillDirs(workdir, action).length > 0;
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const skillDirs = getSkillDirs(workdir, action);
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
