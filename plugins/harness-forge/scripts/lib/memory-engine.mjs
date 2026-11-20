import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  estimateTokens,
  extractSections,
  normalizePosix,
  parseFrontmatter,
  serializeFrontmatter,
  sha256Text,
  slugify
} from '../core/frontmatter.mjs';
import { validateMemoryDoc } from '../core/validator.mjs';

const KIND_TO_DIR = {
  architecture: 'architecture',
  decision: 'decisions',
  contract: 'contracts',
  gotcha: 'gotchas'
};

export function resolveMemoryRoot(workspaceRoot) {
  const root = path.resolve(workspaceRoot || process.cwd());
  if (process.env.FORGE_MEMORY_ROOT) {
    return path.resolve(root, process.env.FORGE_MEMORY_ROOT);
  }
  const forgeCfgPath = path.join(root, '.forge.json');
  if (fs.existsSync(forgeCfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(forgeCfgPath, 'utf8'));
      if (cfg.memoryRoot) {
        return path.resolve(root, cfg.memoryRoot);
      }
    } catch {
      // ignore invalid .forge.json
    }
  }
  return path.join(root, '.memory');
}

export function getGitHead(workspaceRoot) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: path.resolve(workspaceRoot),
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
  } catch {
    return 'uncommitted';
  }
}

function collectDocs(memoryRoot) {
  const out = [];
  for (const sub of ['architecture', 'decisions', 'contracts', 'gotchas']) {
    const dir = path.join(memoryRoot, sub);
    if (!fs.existsSync(dir)) continue;
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) out.push(full);
      }
    };
    walk(dir);
  }
  return out.sort();
}

function atomicWriteFileSync(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const rand = Math.random().toString(36).slice(2, 8);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${rand}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

async function readOrRebuildRc(root, memoryRoot) {
  const rcPath = path.join(memoryRoot, 'memory.rc.json');
  if (fs.existsSync(rcPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
      if (parsed && Array.isArray(parsed.entries)) return parsed;
    } catch {
      // corrupted memory.rc.json -> auto-rebuild below
    }
  }
  await rebuildIndex(root);
  return JSON.parse(fs.readFileSync(rcPath, 'utf8'));
}

export function computeDocDrift(entryData, workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const reasons = [];
  const refs = Array.isArray(entryData?.source_refs) ? entryData.source_refs : [];

  for (const ref of refs) {
    if (!ref?.path) continue;
    const target = path.resolve(root, ref.path);
    const rel = normalizePosix(path.relative(root, target));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      reasons.push(`Escaping source_ref path: ${ref.path}`);
      continue;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      reasons.push(`Missing referenced file: ${ref.path}`);
      continue;
    }
    const content = fs.readFileSync(target, 'utf8');
    const currentPrefix = sha256Text(content).slice(0, 8);
    if (ref.sha256_prefix && ref.sha256_prefix !== currentPrefix) {
      reasons.push(`File changed since last verification: ${ref.path} (${ref.sha256_prefix} -> ${currentPrefix})`);
    }
    if (Array.isArray(ref.symbols)) {
      for (const sym of ref.symbols) {
        if (sym && !content.includes(String(sym))) {
          reasons.push(`Referenced symbol "${sym}" not found in ${ref.path}`);
        }
      }
    }
  }

  return {
    stale: reasons.length > 0 || entryData?.status === 'stale',
    drift_reasons: reasons
  };
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);
}

async function buildSearchCaches(memoryRoot, docsWithBodies) {
  const cacheDir = path.join(memoryRoot, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, '.gitignore'), '*\n!.gitignore\n', 'utf8');

  // Pure-JS BM25 index (works on every Node runtime with zero deps)
  const docCount = docsWithBodies.length;
  const df = Object.create(null);
  const docs = docsWithBodies.map((d) => {
    const terms = tokenize(`${d.id} ${d.kind} ${d.tags.join(' ')} ${d.summary} ${d.body}`);
    const tf = Object.create(null);
    for (const t of terms) tf[t] = (tf[t] || 0) + 1;
    for (const t of Object.keys(tf)) df[t] = (df[t] || 0) + 1;
    return {
      id: d.id,
      length: terms.length,
      tf
    };
  });
  const avgdl = docCount > 0 ? docs.reduce((s, d) => s + d.length, 0) / docCount : 0;

  const bm25Path = path.join(cacheDir, 'bm25-index.json');
  atomicWriteFileSync(bm25Path, JSON.stringify({ docCount, avgdl, df, docs }));

  return { bm25Indexed: true, bm25Path };
}

function renderExecutiveMemoryMd(rc) {
  const lines = [
    '# Project Memory Index (`MEMORY.md`)',
    '',
    `> Auto-compiled by \`harness-forge\`. Query \`memory.rc.json\` or MCP \`memory_index\` / \`memory_search\` first.`,
    `> **Entries**: ${rc.entries.length} | **Stale**: ${rc.entries.filter((e) => e.stale).length} | **Git HEAD**: \`${rc.git_head}\``,
    ''
  ];

  const grouped = { architecture: [], decision: [], contract: [], gotcha: [] };
  for (const e of rc.entries) {
    (grouped[e.kind] || grouped.architecture).push(e);
  }

  const labels = {
    architecture: '## Architecture',
    decision: '## Decisions (ADRs)',
    contract: '## Interface Contracts',
    gotcha: '## Known Gotchas'
  };

  for (const [kind, heading] of Object.entries(labels)) {
    const list = grouped[kind];
    if (list.length === 0) continue;
    lines.push(heading);
    for (const item of list.slice(0, 20)) {
      const badge = item.stale ? ' [STALE]' : item.status !== 'active' ? ` [${item.status.toUpperCase()}]` : '';
      lines.push(`- \`${item.id}\`${badge}: ${item.summary} ([${item.path}](${item.path}))`);
    }
    if (list.length > 20) {
      lines.push(`- _...and ${list.length - 20} more in \`memory.rc.json\`_`);
    }
    lines.push('');
  }

  return lines.slice(0, 120).join('\n').trimEnd() + '\n';
}

export async function initMemory(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const memoryRoot = resolveMemoryRoot(root);
  for (const sub of ['architecture', 'decisions', 'contracts', 'gotchas', 'skills-learned', '.cache']) {
    fs.mkdirSync(path.join(memoryRoot, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(memoryRoot, '.cache', '.gitignore'), '*\n!.gitignore\n', 'utf8');

  const rootGitignore = path.join(root, '.gitignore');
  if (fs.existsSync(rootGitignore)) {
    const gi = fs.readFileSync(rootGitignore, 'utf8');
    if (!gi.includes('.memory/.cache/')) {
      fs.appendFileSync(rootGitignore, (gi.endsWith('\n') ? '' : '\n') + '.memory/.cache/\n', 'utf8');
    }
  }

  const res = await rebuildIndex(root);
  return { memoryRoot: normalizePosix(memoryRoot), ...res };
}

export async function rebuildIndex(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const memoryRoot = resolveMemoryRoot(root);
  fs.mkdirSync(memoryRoot, { recursive: true });

  const files = collectDocs(memoryRoot);
  const entries = [];
  const docsWithBodies = [];

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const rel = normalizePosix(path.relative(memoryRoot, filePath));
    const fm = parseFrontmatter(raw);
    const d = fm.data || {};
    if (!d.id || !d.kind) continue;

    const drift = computeDocDrift(d, root);
    const sections = extractSections(raw);
    const tokenEst = estimateTokens(raw);
    const entry = {
      id: d.id,
      kind: d.kind,
      status: drift.stale && d.status === 'active' ? 'stale' : d.status || 'active',
      stale: drift.stale,
      drift_reasons: drift.drift_reasons,
      path: rel,
      summary: d.summary || '',
      tags: Array.isArray(d.tags) ? d.tags : [],
      token_estimate: tokenEst,
      content_sha256: sha256Text(raw),
      sections,
      source_refs: Array.isArray(d.source_refs) ? d.source_refs : [],
      last_verified_commit: d.last_verified_commit || null,
      supersedes: d.supersedes ?? null
    };
    entries.push(entry);
    docsWithBodies.push({
      id: entry.id,
      kind: entry.kind,
      tags: entry.tags,
      summary: entry.summary,
      body: fm.body
    });
  }

  entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const rc = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    memory_root: normalizePosix(path.relative(root, memoryRoot) || '.memory'),
    git_head: getGitHead(root),
    entries
  };

  const rcPath = path.join(memoryRoot, 'memory.rc.json');
  atomicWriteFileSync(rcPath, JSON.stringify(rc, null, 2));

  const memoryMdPath = path.join(memoryRoot, 'MEMORY.md');
  atomicWriteFileSync(memoryMdPath, renderExecutiveMemoryMd(rc));

  const cacheRes = await buildSearchCaches(memoryRoot, docsWithBodies);

  return {
    rcPath: normalizePosix(rcPath),
    memoryMdPath: normalizePosix(memoryMdPath),
    totalEntries: entries.length,
    staleEntries: entries.filter((e) => e.stale).length,
    bm25Indexed: cacheRes.bm25Indexed
  };
}

export async function upsertMemoryDoc(workspaceRoot, payload) {
  const root = path.resolve(workspaceRoot);
  const memoryRoot = resolveMemoryRoot(root);
  const {
    id,
    kind,
    status = 'active',
    supersedes = null,
    summary,
    tags,
    source_refs = [],
    body
  } = payload || {};

  if (!kind || !KIND_TO_DIR[kind]) {
    throw new Error(`Invalid memory doc kind "${kind}". Expected architecture|decision|contract|gotcha.`);
  }
  if (!id || typeof id !== 'string') {
    throw new Error('Missing memory doc "id".');
  }

  const enrichedRefs = [];
  for (const ref of Array.isArray(source_refs) ? source_refs : []) {
    if (!ref || typeof ref !== 'object' || !ref.path) {
      throw new Error('Each source_ref must be an object with a non-empty "path".');
    }
    const target = path.resolve(root, ref.path);
    const rel = normalizePosix(path.relative(root, target));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`source_ref path "${ref.path}" escapes workspaceRoot.`);
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`Referenced source_ref file does not exist on disk: ${ref.path}`);
    }
    const fileContent = fs.readFileSync(target, 'utf8');
    if (Array.isArray(ref.symbols)) {
      for (const sym of ref.symbols) {
        if (sym && !fileContent.includes(String(sym))) {
          throw new Error(`Referenced symbol "${sym}" was not found inside ${ref.path}`);
        }
      }
    }
    enrichedRefs.push({
      path: normalizePosix(ref.path),
      ...(Array.isArray(ref.symbols) && ref.symbols.length > 0 ? { symbols: ref.symbols } : {}),
      sha256_prefix: sha256Text(fileContent).slice(0, 8)
    });
  }

  const subdir = KIND_TO_DIR[kind];
  const relDocPath = `${subdir}/${id}.md`;
  const targetDocPath = path.join(memoryRoot, subdir, `${id}.md`);

  const fmData = {
    id,
    kind,
    status,
    supersedes,
    summary,
    tags,
    source_refs: enrichedRefs,
    last_verified_commit: getGitHead(root),
    token_estimate: estimateTokens(body || '')
  };

  const fullMarkdown = serializeFrontmatter(fmData, body || '');
  const validation = validateMemoryDoc(relDocPath, fullMarkdown, root, { checkDisk: true });
  if (!validation.ok) {
    throw new Error(`Memory document validation failed:\n- ${validation.errors.join('\n- ')}`);
  }

  atomicWriteFileSync(targetDocPath, fullMarkdown);

  await rebuildIndex(root);
  const rc = await readOrRebuildRc(root, memoryRoot);
  const entry = rc.entries.find((e) => e.id === id);
  return { ok: true, id, path: relDocPath, entry };
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function recordAdr(workspaceRoot, {
  title,
  context,
  decision,
  consequences,
  supersedes = null,
  tags = ['adr'],
  source_refs = []
}) {
  if (!title || String(title).trim().length < 3) {
    throw new Error('ADR title is required (>= 3 chars)');
  }
  const root = path.resolve(workspaceRoot);
  const memoryRoot = resolveMemoryRoot(root);
  const decisionsDir = path.join(memoryRoot, 'decisions');
  fs.mkdirSync(decisionsDir, { recursive: true });

  let maxNum = 0;
  for (const name of fs.readdirSync(decisionsDir)) {
    const m = name.match(/^adr-(\d+)-/i);
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  const num = String(maxNum + 1).padStart(4, '0');
  const id = `adr-${num}-${slugify(title)}`.slice(0, 64).replace(/-+$/, '');

  const body = [
    `# ADR-${num}: ${title}`,
    '',
    '## Context',
    context || 'Context recorded by agent.',
    '',
    '## Decision',
    decision || 'Decision recorded by agent.',
    '',
    '## Consequences',
    consequences || 'Consequences documented for maintainers.'
  ].join('\n');

  const summary = `ADR-${num}: ${title}`.slice(0, 240);
  const result = await upsertMemoryDoc(root, {
    id,
    kind: 'decision',
    status: 'active',
    supersedes,
    summary,
    tags: tags.length ? tags : ['adr'],
    source_refs,
    body
  });

  if (supersedes) {
    const sup = String(supersedes);
    const supRe = new RegExp(`^${escapeRegExp(sup)}(?:-|$)`);
    const oldFile = fs.readdirSync(decisionsDir).find((f) => {
      if (f === `${id}.md` || !f.endsWith('.md')) return false;
      if (f === `${sup}.md` || supRe.test(f.replace(/\.md$/, ''))) {
        const fm = parseFrontmatter(fs.readFileSync(path.join(decisionsDir, f), 'utf8'));
        return fm.data?.id === sup || supRe.test(String(fm.data?.id || f.replace(/\.md$/, '')));
      }
      return false;
    });
    if (oldFile) {
      const oldFull = path.join(decisionsDir, oldFile);
      const parsed = parseFrontmatter(fs.readFileSync(oldFull, 'utf8'));
      parsed.data.status = 'superseded';
      const updatedMd = serializeFrontmatter(parsed.data, parsed.body);
      atomicWriteFileSync(oldFull, updatedMd);
      await rebuildIndex(root);
      const refreshedRc = await readOrRebuildRc(root, memoryRoot);
      const refreshedEntry = refreshedRc.entries.find((e) => e.id === id);
      if (refreshedEntry) result.entry = refreshedEntry;
    }
  }

  return result;
}

export async function retireMemoryDoc(workspaceRoot, id, { status = 'deprecated', supersededBy = null } = {}) {
  const root = path.resolve(workspaceRoot);
  const memoryRoot = resolveMemoryRoot(root);
  const rc = await readOrRebuildRc(root, memoryRoot);
  const entry = rc.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`Memory entry "${id}" not found.`);

  const fullPath = path.join(memoryRoot, entry.path);
  const parsed = parseFrontmatter(fs.readFileSync(fullPath, 'utf8'));
  parsed.data.status = status;
  const note = supersededBy ? `\n\n> Retired in favor of \`${supersededBy}\`.\n` : '';
  const updated = serializeFrontmatter(parsed.data, parsed.body + note);
  atomicWriteFileSync(fullPath, updated);
  return rebuildIndex(root);
}

export async function readMemoryIndex(workspaceRoot, { kind = null, tag = null } = {}) {
  const root = path.resolve(workspaceRoot);
  const memoryRoot = resolveMemoryRoot(root);
  const rc = await readOrRebuildRc(root, memoryRoot);
  let entries = rc.entries || [];
  if (kind) entries = entries.filter((e) => e.kind === kind);
  if (tag) entries = entries.filter((e) => (e.tags || []).includes(tag));
  return {
    schema_version: rc.schema_version,
    git_head: rc.git_head,
    total: entries.length,
    entries
  };
}

export async function readMemoryDoc(workspaceRoot, id, section = null) {
  const root = path.resolve(workspaceRoot);
  const memoryRoot = resolveMemoryRoot(root);
  const rc = await readOrRebuildRc(root, memoryRoot);
  const entry = rc.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`Memory entry "${id}" not found.`);

  const fullPath = path.join(memoryRoot, entry.path);
  const fullText = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');

  if (!section) {
    return {
      id: entry.id,
      kind: entry.kind,
      status: entry.status,
      stale: entry.stale,
      drift_reasons: entry.drift_reasons,
      path: entry.path,
      sections: entry.sections,
      content: fullText
    };
  }

  const targetLower = String(section).toLowerCase();
  const matched =
    entry.sections.find((s) => s.id === targetLower) ||
    entry.sections.find((s) => s.title.toLowerCase().includes(targetLower));

  if (!matched) {
    throw new Error(`Section "${section}" not found in "${id}". Available: ${entry.sections.map((s) => s.id).join(', ')}`);
  }

  const lines = fullText.split('\n');
  const slice = lines.slice(matched.lines[0] - 1, matched.lines[1]).join('\n');
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    stale: entry.stale,
    drift_reasons: entry.drift_reasons,
    section: matched,
    content: slice
  };
}

export async function searchMemory(workspaceRoot, query, { kind = null, tag = null, includeStale = true, limit = 10 } = {}) {
  const root = path.resolve(workspaceRoot);
  const memoryRoot = resolveMemoryRoot(root);
  const rcPath = path.join(memoryRoot, 'memory.rc.json');
  const bm25Path = path.join(memoryRoot, '.cache', 'bm25-index.json');
  let rc;
  let bm25;
  try {
    if (!fs.existsSync(rcPath) || !fs.existsSync(bm25Path)) {
      throw new Error('Missing cache');
    }
    rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    bm25 = JSON.parse(fs.readFileSync(bm25Path, 'utf8'));
    if (!rc || !Array.isArray(rc.entries) || !bm25 || !Array.isArray(bm25.docs)) {
      throw new Error('Invalid cache shape');
    }
  } catch {
    await rebuildIndex(root);
    rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    bm25 = JSON.parse(fs.readFileSync(bm25Path, 'utf8'));
  }
  const qTerms = tokenize(query);

  const k1 = 1.5;
  const b = 0.75;
  const N = bm25.docCount || 1;
  const avgdl = bm25.avgdl || 1;

  const entryById = new Map(rc.entries.map((e) => [e.id, e]));
  const results = [];

  for (const doc of bm25.docs || []) {
    const entry = entryById.get(doc.id);
    if (!entry) continue;
    if (kind && entry.kind !== kind) continue;
    if (tag && !(entry.tags || []).includes(tag)) continue;
    if (!includeStale && entry.stale) continue;

    let score = 0;
    const docTf = doc.tf || {};
    const indexDf = bm25.df || {};
    for (const term of qTerms) {
      const tf = Object.hasOwn(docTf, term) ? docTf[term] : 0;
      if (tf === 0) continue;
      const df = Object.hasOwn(indexDf, term) ? indexDf[term] : 0;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const normTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / avgdl));
      score += idf * normTf;
    }

    if (qTerms.length === 0) score = 1;
    if (score <= 0) continue;

    if (entry.stale) score *= 0.4;
    if (entry.status === 'superseded' || entry.status === 'deprecated') score *= 0.2;

    results.push({
      id: entry.id,
      kind: entry.kind,
      status: entry.status,
      stale: entry.stale,
      summary: entry.summary,
      path: entry.path,
      tags: entry.tags,
      sections: entry.sections.map((s) => s.id),
      score: Number(score.toFixed(4))
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export async function checkDrift(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const memoryRoot = resolveMemoryRoot(root);
  await rebuildIndex(root);
  const rc = await readOrRebuildRc(root, memoryRoot);
  const staleEntries = rc.entries.filter((e) => e.stale);
  return {
    total: rc.entries.length,
    staleCount: staleEntries.length,
    staleEntries: staleEntries.map((e) => ({
      id: e.id,
      path: e.path,
      drift_reasons: e.drift_reasons
    }))
  };
}

export async function promoteFromTeamwork(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const twRoot = path.join(root, '.agents', 'teamwork');
  if (!fs.existsSync(twRoot)) {
    return { promoted: [], note: 'No .agents/teamwork workspace found.' };
  }

  await initMemory(root);

  let activeOrch = 'orchestrator_1';
  const statePath = path.join(twRoot, 'state.json');
  if (fs.existsSync(statePath)) {
    try {
      const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (st.active_orchestrator) activeOrch = st.active_orchestrator;
    } catch {
      // ignore
    }
  }

  const deadEndsPath = path.join(twRoot, activeOrch, 'DEAD_ENDS.md');
  const promoted = [];
  if (fs.existsSync(deadEndsPath)) {
    const lines = fs
      .readFileSync(deadEndsPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith('|') && !l.includes('Approach Tried') && !l.includes('---'));

    for (const line of lines) {
      const cols = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cols.length < 3) continue;
      const [iter, approach, why, filesRaw = ''] = cols;
      const id = `gotcha-${slugify(approach)}`.slice(0, 56).replace(/-+$/, '');
      const candidateRefs = filesRaw
        .split(/[,;\s]+/)
        .map((f) => f.replace(/`/g, '').trim())
        .filter((f) => f && fs.existsSync(path.resolve(root, f)))
        .map((f) => ({ path: normalizePosix(f) }));

      const body = [
        `# Gotcha: ${approach}`,
        '',
        '## Root Cause',
        `${why} (Observed in ${activeOrch}, iteration ${iter}).`,
        '',
        '## Avoidance Rule',
        `Do not retry "${approach}". Inspect referenced files before modifying.`
      ].join('\n');

      const res = await upsertMemoryDoc(root, {
        id,
        kind: 'gotcha',
        status: 'active',
        summary: `Avoid "${approach}": ${why}`.slice(0, 240),
        tags: ['gotcha', 'dead-end', activeOrch],
        source_refs: candidateRefs,
        body
      });
      promoted.push(res.id);
    }
  }

  return { promoted };
}
