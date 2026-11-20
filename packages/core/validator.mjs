import fs from 'node:fs';
import path from 'node:path';
import { estimateTokens, normalizePosix, parseFrontmatter, sha256Text } from './frontmatter.mjs';
import { scanPromptSecurity } from './security-scanner.mjs';

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const VALID_TIERS = new Set(['low', 'medium', 'high']);
const VALID_RUNTIMES = new Set(['DEVIN_CLI_LOCAL', 'DEVIN_CLOUD', 'ANTIGRAVITY']);
const VALID_AUTHORITY_PROFILES = new Set([
  'read_only',
  'audit_only',
  'dispatch_only',
  'scoped_worker',
  'test_writer',
  'governance_writer',
  'full_orchestrator'
]);
const VALID_MEMORY_KINDS = new Set(['architecture', 'decision', 'contract', 'gotcha']);
const VALID_MEMORY_STATUS = new Set(['active', 'stale', 'superseded', 'deprecated']);

export function validateSkillDir(skillDir) {
  const errors = [];
  const warnings = [];
  const absDir = path.resolve(skillDir);
  const folderName = path.basename(absDir);
  const skillMdPath = path.join(absDir, 'SKILL.md');
  const contractPath = path.join(absDir, 'skill.contract.json');

  if (!fs.existsSync(skillMdPath)) {
    errors.push(`Missing SKILL.md in ${absDir}`);
  }
  if (!fs.existsSync(contractPath)) {
    errors.push(`Missing skill.contract.json in ${absDir}`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings, meta: { folderName } };
  }

  const skillContent = fs.readFileSync(skillMdPath, 'utf8');
  const skillSec = scanPromptSecurity(skillContent, { filePath: skillMdPath });
  for (const f of skillSec.findings) {
    errors.push(`[SECURITY:${f.code}] SKILL.md:${f.line} — ${f.message}`);
  }
  const byteSize = Buffer.byteLength(skillContent, 'utf8');
  const lineCount = skillContent.split(/\r?\n/).length;
  const fm = parseFrontmatter(skillContent);

  if (!fm.hasFrontmatter) {
    errors.push(`SKILL.md missing YAML frontmatter (${skillMdPath})`);
  } else {
    if (!fm.data.name || typeof fm.data.name !== 'string') {
      errors.push('SKILL.md frontmatter missing string "name"');
    } else if (fm.data.name !== folderName) {
      errors.push(`SKILL.md frontmatter name "${fm.data.name}" does not match folder "${folderName}"`);
    }
    if (!fm.data.description || typeof fm.data.description !== 'string' || fm.data.description.trim().length < 10) {
      errors.push('SKILL.md frontmatter missing "description" (>= 10 chars)');
    }
  }

  if (fm.body.trim().length < 20) {
    errors.push('SKILL.md body must contain non-empty instructions (>= 20 chars)');
  }
  if (lineCount > 400) {
    errors.push(`SKILL.md exceeds 400 lines (${lineCount} lines) — violates Progressive Disclosure`);
  } else if (lineCount > 220) {
    warnings.push(`SKILL.md is ${lineCount} lines; consider extracting references/`);
  }
  if (byteSize > 14336) {
    errors.push(`SKILL.md exceeds 14 KB (${byteSize} bytes) — violates Progressive Disclosure`);
  }

  let contract = null;
  const contractRaw = fs.readFileSync(contractPath, 'utf8');
  const contractSec = scanPromptSecurity(contractRaw, { filePath: contractPath });
  for (const f of contractSec.findings) {
    errors.push(`[SECURITY:${f.code}] skill.contract.json:${f.line} — ${f.message}`);
  }
  try {
    contract = JSON.parse(contractRaw);
  } catch (err) {
    errors.push(`Invalid JSON in skill.contract.json: ${err.message}`);
    return { ok: false, errors, warnings, meta: { folderName } };
  }

  const requiredFields = [
    'name',
    'version',
    'description',
    'token_budget_tier',
    'eligibility',
    'P_preconditions',
    'O_operation',
    'A_artifacts',
    'V_validators',
    'F_failure_modes',
    'ecosystem_edges'
  ];

  for (const field of requiredFields) {
    if (contract[field] === undefined) {
      errors.push(`skill.contract.json missing required field "${field}"`);
    }
  }

  if (contract.name !== folderName) {
    errors.push(`skill.contract.json name "${contract.name}" does not match folder "${folderName}"`);
  } else if (!KEBAB_RE.test(contract.name)) {
    errors.push(`skill.contract.json name "${contract.name}" must be kebab-case`);
  }

  if (!contract.version || !SEMVER_RE.test(String(contract.version))) {
    errors.push(`skill.contract.json invalid semver version "${contract.version}"`);
  }
  if (!contract.description || String(contract.description).trim().length < 10) {
    errors.push('skill.contract.json description must be >= 10 chars');
  }
  if (!VALID_TIERS.has(contract.token_budget_tier)) {
    errors.push(`skill.contract.json invalid token_budget_tier "${contract.token_budget_tier}"`);
  }

  if (contract.eligibility) {
    if (!Array.isArray(contract.eligibility.phases) || contract.eligibility.phases.length === 0) {
      errors.push('skill.contract.json eligibility.phases must be a non-empty array');
    }
    if (!Array.isArray(contract.eligibility.runtimes) || contract.eligibility.runtimes.length === 0) {
      errors.push('skill.contract.json eligibility.runtimes must be a non-empty array');
    } else {
      for (const rt of contract.eligibility.runtimes) {
        if (!VALID_RUNTIMES.has(rt)) {
          errors.push(`skill.contract.json unknown runtime "${rt}" in eligibility.runtimes`);
        }
      }
    }
  }

  if (!Array.isArray(contract.P_preconditions)) {
    errors.push('skill.contract.json P_preconditions must be an array');
  }

  if (contract.O_operation) {
    if (!VALID_AUTHORITY_PROFILES.has(contract.O_operation.authority_profile)) {
      errors.push(`skill.contract.json invalid authority_profile "${contract.O_operation.authority_profile}"`);
    }
    for (const arrKey of ['allowed_write_globs', 'denied_shell_patterns', 'program_functions']) {
      if (!Array.isArray(contract.O_operation[arrKey])) {
        errors.push(`skill.contract.json O_operation.${arrKey} must be an array`);
      }
    }
  }

  if (!Array.isArray(contract.A_artifacts)) {
    errors.push('skill.contract.json A_artifacts must be an array');
  }
  if (!Array.isArray(contract.V_validators) || contract.V_validators.length === 0) {
    errors.push('skill.contract.json V_validators must be a non-empty array');
  }
  if (!Array.isArray(contract.F_failure_modes) || contract.F_failure_modes.length === 0) {
    errors.push('skill.contract.json F_failure_modes must be a non-empty array');
  }

  if (contract.ecosystem_edges) {
    for (const edgeKey of ['depends_on', 'compatible_with', 'redundant_with', 'alternative_to']) {
      if (!Array.isArray(contract.ecosystem_edges[edgeKey])) {
        errors.push(`skill.contract.json ecosystem_edges.${edgeKey} must be an array`);
      }
    }
    if (typeof contract.ecosystem_edges.lineage !== 'string') {
      errors.push('skill.contract.json ecosystem_edges.lineage must be a string');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    meta: {
      name: contract.name,
      version: contract.version,
      description: contract.description,
      lineCount,
      byteSize,
      tokenEstimate: estimateTokens(skillContent),
      contract
    }
  };
}

export function validateMemoryDoc(filePath, content, workspaceRoot, { checkDisk = true } = {}) {
  const errors = [];
  const warnings = [];
  const sec = scanPromptSecurity(content, { filePath });
  for (const f of sec.findings) {
    errors.push(`${filePath}: [SECURITY:${f.code}] line ${f.line} — ${f.message}`);
  }
  const fm = parseFrontmatter(content);

  if (!fm.hasFrontmatter) {
    errors.push(`${filePath}: missing YAML frontmatter block (--- ... ---)`);
    return { ok: false, errors, warnings, data: {}, body: fm.body };
  }

  const d = fm.data;
  if (!d.id || typeof d.id !== 'string' || !KEBAB_RE.test(d.id)) {
    errors.push(`${filePath}: frontmatter "id" must be non-empty kebab-case`);
  }
  if (!d.kind || !VALID_MEMORY_KINDS.has(d.kind)) {
    errors.push(`${filePath}: frontmatter "kind" must be one of architecture|decision|contract|gotcha (got "${d.kind}")`);
  }
  if (!d.status || !VALID_MEMORY_STATUS.has(d.status)) {
    errors.push(`${filePath}: frontmatter "status" must be one of active|stale|superseded|deprecated (got "${d.status}")`);
  }
  if (!d.summary || typeof d.summary !== 'string' || d.summary.trim().length < 10 || d.summary.trim().length > 240) {
    errors.push(`${filePath}: frontmatter "summary" must be 10..240 chars`);
  }
  if (!Array.isArray(d.tags) || d.tags.length === 0 || !d.tags.every((t) => typeof t === 'string' && t.trim().length > 0)) {
    errors.push(`${filePath}: frontmatter "tags" must be a non-empty array of strings`);
  }

  if (!Array.isArray(d.source_refs)) {
    errors.push(`${filePath}: frontmatter "source_refs" must be an array`);
  } else {
    for (let idx = 0; idx < d.source_refs.length; idx++) {
      const ref = d.source_refs[idx];
      if (!ref || typeof ref !== 'object' || !ref.path || typeof ref.path !== 'string') {
        errors.push(`${filePath}: source_refs[${idx}] must be an object with non-empty "path"`);
        continue;
      }
      if (checkDisk && workspaceRoot) {
        const resolvedRoot = path.resolve(workspaceRoot);
        const resolvedRef = path.resolve(resolvedRoot, ref.path);
        const rel = normalizePosix(path.relative(resolvedRoot, resolvedRef));
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          errors.push(`${filePath}: source_refs[${idx}].path "${ref.path}" escapes workspaceRoot`);
        } else if (!fs.existsSync(resolvedRef)) {
          errors.push(`${filePath}: source_refs[${idx}].path "${ref.path}" does not exist on disk`);
        }
      }
    }
  }

  if (fm.body.trim().length < 20) {
    errors.push(`${filePath}: Markdown body must contain meaningful documentation (>= 20 chars)`);
  }
  if (!/^##\s+\S/m.test(fm.body)) {
    errors.push(`${filePath}: Markdown body must include at least one "## " section heading`);
  }

  return { ok: errors.length === 0, errors, warnings, data: d, body: fm.body };
}

export function validateHandoff(filePath, content, { requireVerdict = false, checkFiles = false, workspaceRoot = null } = {}) {
  const errors = [];
  const warnings = [];
  const text = String(content || '').replace(/\r\n/g, '\n');

  const sectionSpecs = [
    { key: '1. Observation', regex: /^##\s+(?:1\.\s*)?Observation\s*$/im },
    { key: '2. Logic Chain', regex: /^##\s+(?:2\.\s*)?Logic Chain\s*$/im },
    { key: '3. Caveats', regex: /^##\s+(?:3\.\s*)?Caveats\s*$/im },
    { key: '4. Conclusion', regex: /^##\s+(?:4\.\s*)?Conclusion\s*$/im },
    { key: '5. Verification Method', regex: /^##\s+(?:5\.\s*)?Verification Method\s*$/im }
  ];

  const found = [];
  for (const spec of sectionSpecs) {
    const m = spec.regex.exec(text);
    if (!m) {
      errors.push(`Missing section "${spec.key}"`);
    } else {
      found.push({ key: spec.key, index: m.index, length: m[0].length });
    }
  }

  found.sort((a, b) => a.index - b.index);
  for (let i = 0; i < found.length; i++) {
    const start = found[i].index + found[i].length;
    const end = i + 1 < found.length ? found[i + 1].index : text.length;
    const body = text.slice(start, end).replace(/[-`*\s]/g, '');
    if (body.length < 3) {
      errors.push(`Section "${found[i].key}" is empty`);
    }
  }

  if (!/Invalidation Condition/i.test(text)) {
    errors.push('Missing explicit "Invalidation Conditions" in Section 5');
  }

  let verdict = null;
  const verdictMatch = text.match(/\b(APPROVE|REQUEST_CHANGES|CLEAN|INTEGRITY[_\s]VIOLATION|REJECT)\b/);
  if (verdictMatch) {
    verdict = verdictMatch[1].replace('_', ' ');
  }
  if (requireVerdict && !verdict) {
    errors.push('Missing formal binary verdict (APPROVE | REQUEST_CHANGES | CLEAN | INTEGRITY VIOLATION | REJECT)');
  }

  if (checkFiles && workspaceRoot) {
    const backtickPaths = text.match(/`([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z0-9]+)`/g) || [];
    for (const token of backtickPaths) {
      const rel = token.slice(1, -1);
      if (rel.startsWith('http') || rel.includes('<') || rel.startsWith('.agents/teamwork/')) continue;
      const full = path.resolve(workspaceRoot, rel);
      if (!fs.existsSync(full)) {
        warnings.push(`Referenced path "${rel}" does not exist under ${workspaceRoot}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, verdict };
}

function collectMemoryMarkdownFiles(memoryRoot) {
  const dirs = ['architecture', 'decisions', 'contracts', 'gotchas'];
  const files = [];
  for (const sub of dirs) {
    const dirPath = path.join(memoryRoot, sub);
    if (!fs.existsSync(dirPath)) continue;
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) files.push(full);
      }
    };
    walk(dirPath);
  }
  return files.sort();
}

export function validateMemoryIndexSync(memoryRoot, workspaceRoot = null) {
  const errors = [];
  const rcPath = path.join(memoryRoot, 'memory.rc.json');
  if (!fs.existsSync(rcPath)) {
    return { ok: false, errors: [`memory.rc.json not found at ${rcPath}`], entries: [] };
  }

  let rc = null;
  try {
    rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`Invalid JSON in memory.rc.json: ${err.message}`], entries: [] };
  }

  for (const key of ['schema_version', 'generated_at', 'memory_root', 'git_head', 'entries']) {
    if (rc[key] === undefined) {
      errors.push(`memory.rc.json missing field "${key}"`);
    }
  }
  if (!Array.isArray(rc.entries)) {
    errors.push('memory.rc.json "entries" must be an array');
    return { ok: false, errors, entries: [] };
  }

  const diskFiles = collectMemoryMarkdownFiles(memoryRoot);
  const diskByPath = new Map();
  for (const f of diskFiles) {
    const raw = fs.readFileSync(f, 'utf8');
    const rel = normalizePosix(path.relative(memoryRoot, f));
    const docCheck = validateMemoryDoc(rel, raw, workspaceRoot, { checkDisk: Boolean(workspaceRoot) });
    if (!docCheck.ok) {
      errors.push(...docCheck.errors);
    }
    diskByPath.set(rel, {
      id: docCheck.data.id,
      kind: docCheck.data.kind,
      summary: docCheck.data.summary || '',
      tags: Array.isArray(docCheck.data.tags) ? docCheck.data.tags : [],
      content_sha256: sha256Text(raw)
    });
  }

  const rcByPath = new Map(rc.entries.map((e) => [normalizePosix(e.path), e]));
  for (const [rel, meta] of diskByPath.entries()) {
    const entry = rcByPath.get(rel);
    if (!entry) {
      errors.push(`memory.rc.json out of sync: missing entry for "${rel}" (run memory rebuild)`);
    } else {
      if (!entry.content_sha256 || entry.content_sha256 !== meta.content_sha256) {
        errors.push(`memory.rc.json out of sync: hash mismatch for "${rel}" (run memory rebuild)`);
      }
      if (entry.id !== meta.id || entry.kind !== meta.kind || (entry.summary || '') !== meta.summary) {
        errors.push(`memory.rc.json out of sync: metadata mismatch for "${rel}" (run memory rebuild)`);
      }
      if (
        !Array.isArray(entry.tags) ||
        entry.tags.length !== meta.tags.length ||
        entry.tags.some((t, idx) => t !== meta.tags[idx])
      ) {
        errors.push(`memory.rc.json out of sync: tags mismatch for "${rel}" (run memory rebuild)`);
      }
    }
  }
  for (const rel of rcByPath.keys()) {
    if (!diskByPath.has(rel)) {
      errors.push(`memory.rc.json out of sync: stale index entry "${rel}" has no file on disk`);
    }
  }

  return { ok: errors.length === 0, errors, entries: rc.entries };
}
