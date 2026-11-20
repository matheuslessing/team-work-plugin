#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  let out = path.join(repoRoot, 'dist', 'antigravity');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return { out };
}

/** Convert YAML list `globs:\n  - "a"\n  - "b"` into Antigravity string `globs: "a, b"`. */
export function convertRuleForAntigravity(rawMd) {
  const normalized = rawMd.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return rawMd;
  const endIdx = normalized.indexOf('\n---\n', 4);
  if (endIdx === -1) return rawMd;

  const fm = normalized.slice(4, endIdx);
  const body = normalized.slice(endIdx + 5);
  const lines = fm.split('\n');
  const outLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^globs:\s*$/.test(line)) {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
        const val = lines[j].replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '');
        if (val) items.push(val);
        j += 1;
      }
      if (items.length > 0) {
        outLines.push(`globs: "${items.join(', ')}"`);
        i = j - 1;
        continue;
      }
    }
    outLines.push(line);
  }

  return `---\n${outLines.join('\n')}\n---\n${body}`;
}

export function buildAntigravityBundles(outDir = path.join(repoRoot, 'dist', 'antigravity')) {
  const plugins = ['teamwork', 'harness-forge'];
  const copyDirs = ['skills', 'agents', 'scripts', 'programs', 'mcp-server', 'templates'];
  const built = [];

  fs.mkdirSync(outDir, { recursive: true });

  for (const name of plugins) {
    const srcRoot = path.join(repoRoot, 'plugins', name);
    const destRoot = path.join(outDir, name);
    const adapterDir = path.join(srcRoot, 'adapters', 'antigravity');

    fs.rmSync(destRoot, { recursive: true, force: true });
    fs.mkdirSync(destRoot, { recursive: true });

    for (const dir of copyDirs) {
      const srcSub = path.join(srcRoot, dir);
      if (fs.existsSync(srcSub)) {
        fs.cpSync(srcSub, path.join(destRoot, dir), { recursive: true });
      }
    }

    fs.copyFileSync(path.join(adapterDir, 'plugin.json'), path.join(destRoot, 'plugin.json'));
    fs.copyFileSync(path.join(adapterDir, 'hooks.json'), path.join(destRoot, 'hooks.json'));
    const mcpCfgSrc = path.join(adapterDir, 'mcp_config.json');
    if (fs.existsSync(mcpCfgSrc)) {
      fs.copyFileSync(mcpCfgSrc, path.join(destRoot, 'mcp_config.json'));
    }

    const rulesDest = path.join(destRoot, 'rules');
    fs.mkdirSync(rulesDest, { recursive: true });

    const agentsMdSrc = path.join(srcRoot, 'AGENTS.md');
    if (fs.existsSync(agentsMdSrc)) {
      fs.copyFileSync(agentsMdSrc, path.join(rulesDest, 'AGENTS.md'));
    }

    const rulesSrc = path.join(srcRoot, 'rules');
    if (fs.existsSync(rulesSrc)) {
      for (const entry of fs.readdirSync(rulesSrc, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = fs.readFileSync(path.join(rulesSrc, entry.name), 'utf8');
          fs.writeFileSync(path.join(rulesDest, entry.name), convertRuleForAntigravity(content), 'utf8');
        }
      }
    }

    built.push({ name, dir: destRoot });
  }

  return built;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const { out } = parseArgs(process.argv.slice(2));
  const built = buildAntigravityBundles(out);
  console.log(JSON.stringify({ ok: true, out, bundles: built }, null, 2));
}
