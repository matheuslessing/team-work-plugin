#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const coreSrc = path.join(repoRoot, 'packages', 'core');
const targets = [
  path.join(repoRoot, 'plugins', 'teamwork', 'scripts', 'core'),
  path.join(repoRoot, 'plugins', 'harness-forge', 'scripts', 'core')
];

const checkOnly = process.argv.includes('--check');

function walkFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, base, out);
    else out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out.sort();
}

const srcFiles = walkFiles(coreSrc);

if (checkOnly) {
  const drifts = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      drifts.push(`Missing target directory: ${target}`);
      continue;
    }
    const dstFiles = walkFiles(target);
    if (JSON.stringify(srcFiles) !== JSON.stringify(dstFiles)) {
      drifts.push(`File list mismatch in ${target}`);
      continue;
    }
    for (const rel of srcFiles) {
      const a = fs.readFileSync(path.join(coreSrc, rel));
      const b = fs.readFileSync(path.join(target, rel));
      if (!a.equals(b)) {
        drifts.push(`Content drift in ${path.join(target, rel)}`);
      }
    }
  }
  if (drifts.length > 0) {
    console.error('FAIL: core drift detected:\n' + drifts.map((d) => `  - ${d}`).join('\n'));
    process.exit(1);
  }
  console.log(`PASS: core synced across all plugins (${srcFiles.length} files each).`);
} else {
  for (const target of targets) {
    fs.rmSync(target, { recursive: true, force: true });
    for (const rel of srcFiles) {
      const srcFile = path.join(coreSrc, rel);
      const dstFile = path.join(target, rel);
      fs.mkdirSync(path.dirname(dstFile), { recursive: true });
      fs.copyFileSync(srcFile, dstFile);
    }
    console.log(`Synced ${srcFiles.length} core files -> ${target}`);
  }
}
