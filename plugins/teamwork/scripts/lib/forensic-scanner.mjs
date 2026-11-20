import fs from 'node:fs';
import path from 'node:path';
import { normalizePosix } from '../core/frontmatter.mjs';

const TEST_FRAMEWORK_PACKAGES = new Set([
  'node:test',
  'node:assert',
  'node:assert/strict',
  'node:fs',
  'node:path',
  'node:os',
  'node:child_process',
  'node:url',
  'assert',
  'assert/strict',
  'fs',
  'path',
  'os',
  'child_process',
  'url',
  'vitest',
  'jest',
  'mocha',
  'chai',
  '@playwright/test',
  'pytest',
  'unittest',
  'typing',
  'json',
  'pathlib',
  'tempfile',
  'subprocess',
  'testing',
  'Xunit',
  'NUnit.Framework',
  'Microsoft.VisualStudio.TestTools.UnitTesting'
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'Library',
  'Temp',
  '.agents',
  '.worktrees',
  '.memory',
  '__pycache__'
]);

const CODE_EXT_RE = /\.(?:cs|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)$/i;
const TEST_BASENAME_RE = /(?:^|[._-])(?:test|spec)s?(?:[._-]|\.)/i;
const TEST_DIR_RE = /(?:^|\/)(?:tests?|__tests__|specs?)\//i;
const TEST_HARNESS_RE =
  /\b(?:node\s+--test|pytest|python[\d.]*\s+(?:-B\s+)?-m\s+(?:pytest|unittest)|npm\s+test|pnpm\s+test|yarn\s+test|vitest|jest|go\s+test|dotnet\s+test|cargo\s+test|unittest|mocha|playwright)\b/;

export function isTestFilePath(filePath) {
  const norm = normalizePosix(filePath);
  if (!CODE_EXT_RE.test(norm)) return false;
  return TEST_BASENAME_RE.test(path.basename(norm)) || TEST_DIR_RE.test(norm);
}

export function walkProjectFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkProjectFiles(full, result);
    } else {
      result.push(full);
    }
  }
  return result;
}

function stripLeadingOrInlineComment(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) return '';
  return line;
}

export function analyzeTestFileIntegrity(filePath, content, workdir = process.cwd()) {
  const findings = [];
  const rawText = String(content || '').replace(/\r\n/g, '\n');
  const lines = rawText.split('\n');
  const relPath = normalizePosix(path.relative(workdir, filePath));

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();
    if (/^\s*(['"`]).*\1\s*,?\s*$/.test(line)) return;
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) return;

    if (/\b(?:class|struct)\s+(?:Mock|Fake|Dummy)[A-Za-z0-9_]+\b/.test(line)) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'LOCAL_MOCK_CLASS',
        message: 'Local Mock/Fake/Dummy class declared inside test file',
        snippet: trimmed
      });
    }

    if (
      /\bAssert\.(?:True|IsTrue)\(\s*true\s*\)/.test(line) ||
      /\bexpect\(\s*true\s*\)\.toBe\(\s*true\s*\)/.test(line) ||
      /\bexpect\(\s*(\d+)\s*\)\.toBe\(\s*\1\s*\)/.test(line) ||
      /\bassert\.(?:equal|strictEqual)\(\s*(true|false|\d+)\s*,\s*\1\s*\)/.test(line) ||
      /\bassert\.ok\(\s*true\s*\)/.test(line) ||
      /^\s*assert\s+(?:True|(\d+)\s*==\s*\1)\b/.test(line)
    ) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'TAUTOLOGICAL_ASSERTION',
        message: 'Tautological constant assertion (e.g., assert true == true)',
        snippet: trimmed
      });
    }

    if (/\bGetMock[A-Za-z0-9_]+\s*\(/.test(line)) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'HARDCODED_MOCK_HELPER',
        message: 'Hardcoded mock helper call detected',
        snippet: trimmed
      });
    }

    if (
      /\b(?:it|describe|test)\.skip\s*\(/.test(line) ||
      /\b(?:it|describe|test)\.only\s*\(/.test(line) ||
      /\btest\(\s*['"][^'"]+['"]\s*,\s*\{\s*skip\s*:\s*true\b/.test(line) ||
      /\bt\.skip\s*\(/.test(line) ||
      /\b(?:xit|xdescribe)\s*\(/.test(line) ||
      /@pytest\.mark\.skip\b/.test(line) ||
      /\bpytest\.skip\s*\(/.test(line) ||
      /\bunittest\.skip\b/.test(line) ||
      /\[Ignore\b|#\[ignore\b|@Disabled\b|\.Skip\(\s*"/.test(line)
    ) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'SKIPPED_TEST',
        message: 'Skipped or disabled test detected',
        snippet: trimmed
      });
    }

    if (/(?:const|let|var)\s+mock[A-Z_a-z0-9]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>/.test(line)) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'LOCAL_MOCK_LAMBDA',
        message: 'Local mock lambda simulating system behavior inside test file',
        snippet: trimmed
      });
    }
  });

  // Strip comment-only lines before checking real production imports
  const uncommented = lines.map(stripLeadingOrInlineComment).join('\n');
  const hasAssertions = /\b(?:assert|expect|Assert\.|Should|t\.Fatal|t\.Error)\b/.test(uncommented);
  if (hasAssertions) {
    const ext = path.extname(filePath).toLowerCase();
    const isJsTs = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext);
    const isPy = ext === '.py';

    if (isJsTs) {
      const importTargets = [];
      for (const m of uncommented.matchAll(
        /(?:import\s+[\s\S]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\))/g
      )) {
        importTargets.push(m[1] || m[2] || m[3] || m[4]);
      }
      const hasProdImport = importTargets.some(
        (t) => !TEST_FRAMEWORK_PACKAGES.has(t) && !t.startsWith('node:')
      );
      const hasSystemInvoke = /\b(?:spawn|spawnSync|execSync|execFileSync|fetch)\s*\(/.test(uncommented);
      if (!hasProdImport && !hasSystemInvoke) {
        findings.push({
          file: relPath,
          line: 1,
          type: 'NO_PRODUCTION_IMPORT',
          message: 'Test file makes assertions without importing any production module or invoking the target binary/server',
          snippet: relPath
        });
      }
    } else if (isPy) {
      const pyImports = [];
      for (const m of uncommented.matchAll(/^(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/gm)) {
        pyImports.push((m[1] || m[2]).split('.')[0]);
      }
      const hasProdImport = pyImports.some((t) => !TEST_FRAMEWORK_PACKAGES.has(t));
      const hasSystemInvoke = /\bsubprocess\.(?:run|Popen|check_output)\b/.test(uncommented);
      if (!hasProdImport && !hasSystemInvoke) {
        findings.push({
          file: relPath,
          line: 1,
          type: 'NO_PRODUCTION_IMPORT',
          message: 'Python test file makes assertions without importing production code or running subprocess E2E',
          snippet: relPath
        });
      }
    }
  }

  return findings;
}

export function analyzeRunnerScript(filePath, content, workdir = process.cwd()) {
  const findings = [];
  const text = String(content || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const relPath = normalizePosix(path.relative(workdir, filePath));

  const codeOnlyText = lines
    .map((l) => {
      const trimmed = l.trim();
      if (trimmed.startsWith('#!') || !trimmed) return '';
      if (trimmed.startsWith('#') || trimmed.startsWith('//')) return '';
      return l.replace(/\s+(?:#|\/\/).*$/, '');
    })
    .join('\n');

  const executesRealHarness = TEST_HARNESS_RE.test(codeOnlyText);

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

    if (/(?:cat|type|Get-Content|open\(|readFileSync)\s*.*(?:TestReport|test_report|report\.txt)/i.test(line) && !executesRealHarness) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'FACADE_TEST_RUNNER',
        message: 'Test runner reads static report file without executing a real test harness',
        snippet: trimmed
      });
    }

    const suppressesWithTest = TEST_HARNESS_RE.test(line) && (/\|\|\s*(?:true|:)\b/.test(line) || /;\s*exit\s+0\b/.test(line));
    const suppressesExplicit = !/\brm\b/.test(line) && /\|\|\s*(?:true|:)\b/.test(line) && (executesRealHarness || /\brun\b/i.test(line));
    if (suppressesWithTest || suppressesExplicit) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'SUPPRESSED_TEST_EXIT',
        message: 'Test runner suppresses non-zero test failure exit codes',
        snippet: trimmed
      });
    }

    if (
      executesRealHarness &&
      idx > 0 &&
      /^\s*exit\s+0\b/.test(trimmed) &&
      lines.slice(Math.max(0, idx - 3), idx).some((prev) => TEST_HARNESS_RE.test(prev) && !/\|\|/.test(prev) && !/^set\s+-e/m.test(codeOnlyText))
    ) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'SUPPRESSED_TEST_EXIT',
        message: 'Test runner hardcodes exit 0 right after test execution without set -e',
        snippet: trimmed
      });
    }

    if (/^\s*(?:echo|printf|print\(|console\.log\()\s*.*(?:ALL\s+TESTS\s+PASSED|100%\s+PASS|PASSED\s*\()/i.test(line) && !executesRealHarness) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'FACADE_TEST_RUNNER',
        message: 'Test runner echoes hardcoded PASSED message without executing real tests',
        snippet: trimmed
      });
    }
  });

  return findings;
}

export function analyzeProductionStubs(filePath, content, workdir = process.cwd()) {
  const findings = [];
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const relPath = normalizePosix(path.relative(workdir, filePath));

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) return;
    if (
      /\b(?:NotImplementedException|NotImplementedError|todo!\(\)|unimplemented!\(\))\b/.test(line) ||
      /throw\s+new\s+Error\(\s*['"](?:TODO|not\s+implemented)/i.test(line)
    ) {
      findings.push({
        file: relPath,
        line: lineNum,
        type: 'PRODUCTION_STUB',
        message: 'Unimplemented stub / NotImplemented placeholder left in production file',
        snippet: trimmed
      });
    }
  });

  return findings;
}

export function scanProjectIntegrity({ workdir = process.cwd(), testdir = '', checkProductionStubs = true } = {}) {
  const root = path.resolve(workdir);
  const searchRoot = testdir ? path.resolve(root, testdir) : root;
  const allFiles = walkProjectFiles(searchRoot);

  const testFiles = allFiles.filter((f) => isTestFilePath(f));

  const runnerFiles = allFiles.filter((f) =>
    /^run[-_]tests?\.(?:py|sh|ps1|mjs|js|bat)$/i.test(path.basename(f))
  );

  const prodFiles = checkProductionStubs
    ? allFiles.filter(
        (f) =>
          CODE_EXT_RE.test(f) &&
          !isTestFilePath(f) &&
          !/forensic-scanner\.mjs$/.test(normalizePosix(f)) &&
          !/validator\.mjs$/.test(normalizePosix(f))
      )
    : [];

  const findings = [];
  for (const tf of testFiles) {
    findings.push(...analyzeTestFileIntegrity(tf, fs.readFileSync(tf, 'utf8'), root));
  }
  for (const rf of runnerFiles) {
    findings.push(...analyzeRunnerScript(rf, fs.readFileSync(rf, 'utf8'), root));
  }
  for (const pf of prodFiles) {
    findings.push(...analyzeProductionStubs(pf, fs.readFileSync(pf, 'utf8'), root));
  }

  return {
    workdir: normalizePosix(root),
    scannedTestFiles: testFiles.length,
    scannedRunnerFiles: runnerFiles.length,
    scannedProductionFiles: prodFiles.length,
    findings,
    verdict: findings.length > 0 ? 'INTEGRITY_VIOLATION' : 'CLEAN'
  };
}
