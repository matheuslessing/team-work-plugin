import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix } from '../scripts/core/frontmatter.mjs';
import { validateSkillDir } from '../scripts/core/validator.mjs';

export const meta = {
  id: 'pf-skill-contract-guard',
  version: '1.0.0',
  event: 'PostToolUse'
};

const EDIT_TOOLS = new Set(['edit', 'write_file', 'edit_file', 'Write', 'Edit']);

function extractTargetPath(action) {
  const args = action?.args || {};
  return args.path || args.Path || args.file_path || args.filePath || args.target || '';
}

export function should_activate(state, action) {
  if (!EDIT_TOOLS.has(action?.tool || '')) return false;
  const target = normalizePosix(extractTargetPath(action));
  if (!target) return false;
  const base = path.basename(target);
  return base === 'SKILL.md' || base === 'skill.contract.json';
}

export function intervene(state, action) {
  const workdir = path.resolve(state.workdir || process.cwd());
  const full = path.resolve(workdir, extractTargetPath(action));
  const skillDir = path.dirname(full);
  if (!fs.existsSync(skillDir)) return { type: 'NOOP' };

  const res = validateSkillDir(skillDir);
  if (res.ok) return { type: 'NOOP' };

  return {
    type: 'INJECT_CONTEXT',
    reason: `Skill ${path.basename(skillDir)} violates SkillOps 5-tuple standard`,
    payload: `[HASP:pf-skill-contract-guard] Fix SkillOps contract/frontmatter in ${normalizePosix(skillDir)}:\n- ${res.errors.join('\n- ')}`
  };
}
