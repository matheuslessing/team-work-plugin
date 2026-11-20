import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { scanProjectIntegrity } from '../plugins/teamwork/scripts/lib/forensic-scanner.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const TEAMWORK_CLI = path.join(REPO_ROOT, 'plugins', 'teamwork', 'scripts', 'teamwork-cli.mjs');
const HOOKS_ENGINE = path.join(REPO_ROOT, 'plugins', 'teamwork', 'scripts', 'hooks-engine.mjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runHook(workdir, event, stdinObj, adapter = 'devin') {
  return spawnSync('node', [HOOKS_ENGINE, event, '--workdir', workdir, '--adapter', adapter], {
    input: JSON.stringify(stdinObj),
    encoding: 'utf8'
  });
}

test('HASP pf-write-boundary blocks read_only explorer edit and destructive shell command', () => {
  const tmp = makeTmpDir('tw-hasp-');
  try {
    execFileSync('node', [TEAMWORK_CLI, 'init', '--workdir', tmp, '--env', 'local']);
    execFileSync('node', [TEAMWORK_CLI, 'spawn', 'explorer_1', 'explorer', '--workdir', tmp]);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'app.js'), 'export const x = 1;\n', 'utf8');

    // 1. Direct edit on production file by explorer_1 -> BLOCK (exitCode 2)
    const editRes = runHook(tmp, 'PreToolUse', {
      agentId: 'explorer_1',
      toolCall: { name: 'edit_file', args: { Path: 'src/app.js' } }
    });
    assert.equal(editRes.status, 2);
    const editOut = JSON.parse(editRes.stdout);
    assert.equal(editOut.decision, 'block');

    // 2. Destructive shell command `sed -i` by explorer_1 -> BLOCK (exitCode 2)
    const shellRes = runHook(tmp, 'PreToolUse', {
      agentId: 'explorer_1',
      toolCall: { name: 'run_command', args: { CommandLine: "sed -i 's/1/2/' src/app.js" } }
    });
    assert.equal(shellRes.status, 2);

    // 3. Antigravity adapter translates BLOCK into { decision: "deny" } with exitCode 0
    const agRes = runHook(
      tmp,
      'PreToolUse',
      {
        agentId: 'explorer_1',
        toolCall: { name: 'write_file', args: { Path: 'src/app.js' } }
      },
      'antigravity'
    );
    assert.equal(agRes.status, 0);
    assert.equal(JSON.parse(agRes.stdout).decision, 'deny');

    // 4. Writing inside explorer_1's own .agents/teamwork/explorer_1/ dir is ALLOWED
    const ownWrite = runHook(tmp, 'PreToolUse', {
      agentId: 'explorer_1',
      toolCall: { name: 'write_file', args: { Path: '.agents/teamwork/explorer_1/analysis.md' } }
    });
    assert.equal(ownWrite.status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('HASP pf-anti-cheat-test, pf-facade-runner, pf-loop-breaker, and Stop gate work end-to-end', () => {
  const tmp = makeTmpDir('tw-forensic-');
  try {
    execFileSync('node', [TEAMWORK_CLI, 'init', '--workdir', tmp, '--env', 'local']);
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });

    // Create bad test (no production import, mock lambda, skipped test) + facade runner + stub
    const badTestPath = path.join(tmp, 'tests', 'fake.test.mjs');
    fs.writeFileSync(
      badTestPath,
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        'class MockEngine { run() { return 42; } }',
        'const mockFn = (x) => x + 1;',
        "test.skip('ignored', () => {});",
        "test('tautology', () => { assert.equal(mockFn(1), 2); expect(true).toBe(true); });"
      ].join('\n'),
      'utf8'
    );

    const facadeRunnerPath = path.join(tmp, 'run_tests.sh');
    fs.writeFileSync(facadeRunnerPath, '#!/bin/sh\ncat TestReport.txt\necho "ALL TESTS PASSED"\n', 'utf8');

    const stubProdPath = path.join(tmp, 'src', 'core.js');
    fs.writeFileSync(stubProdPath, 'export function run() { throw new Error("TODO implement"); }\n', 'utf8');

    // Forensic scanner catches all violations
    const report = scanProjectIntegrity({ workdir: tmp });
    assert.equal(report.verdict, 'INTEGRITY_VIOLATION');
    const types = new Set(report.findings.map((f) => f.type));
    assert.ok(types.has('LOCAL_MOCK_CLASS'));
    assert.ok(types.has('LOCAL_MOCK_LAMBDA'));
    assert.ok(types.has('SKIPPED_TEST'));
    assert.ok(types.has('NO_PRODUCTION_IMPORT'));
    assert.ok(types.has('FACADE_TEST_RUNNER'));
    assert.ok(types.has('PRODUCTION_STUB'));

    // PostToolUse catches bad test edit immediately (both edit and Cloud exec)
    const postTest = runHook(tmp, 'PostToolUse', {
      toolCall: { name: 'write_file', args: { Path: 'tests/fake.test.mjs' } }
    });
    assert.equal(postTest.status, 0);
    assert.match(JSON.parse(postTest.stdout).hookSpecificOutput.additionalContext, /pf-anti-cheat-test/);

    const postExecTest = runHook(tmp, 'PostToolUse', {
      tool_name: 'exec',
      tool_input: { command: "cat <<'EOF' > tests/fake.test.mjs\nconsole.log(1)\nEOF" }
    });
    assert.equal(postExecTest.status, 0);
    assert.match(JSON.parse(postExecTest.stdout).hookSpecificOutput.additionalContext, /pf-anti-cheat-test/);

    const postExecRunner = runHook(tmp, 'PostToolUse', {
      tool_name: 'exec',
      tool_input: { command: 'cat TestReport.txt > run_tests.sh' }
    });
    assert.equal(postExecRunner.status, 0);
    assert.match(JSON.parse(postExecRunner.stdout).hookSpecificOutput.additionalContext, /pf-facade-runner/);

    // PostToolUse loop breaker fires on 3 identical errors
    for (let i = 0; i < 2; i++) {
      const r = runHook(tmp, 'PostToolUse', { toolCall: { name: 'exec', args: {} }, error: 'ENOENT missing file' });
      assert.equal(JSON.parse(r.stdout).hookSpecificOutput, undefined);
    }
    const thirdErr = runHook(tmp, 'PostToolUse', { toolCall: { name: 'exec', args: {} }, error: 'ENOENT missing file' });
    assert.match(JSON.parse(thirdErr.stdout).hookSpecificOutput.additionalContext, /pf-loop-breaker/);

    // Stop hook blocks when active orchestrator GATE_STATUS is FAIL & BRIEFING has [in-progress]
    const gatePath = path.join(tmp, '.agents', 'teamwork', 'orchestrator_1', 'GATE_STATUS.md');
    fs.writeFileSync(gatePath, '# Gate\n\n## Gate — Iteration 1\nGate Result: **FAIL**\n', 'utf8');
    const stopRes = runHook(tmp, 'Stop', {});
    assert.equal(stopRes.status, 2);
    assert.equal(JSON.parse(stopRes.stdout).decision, 'block');

    // Clean test referencing real src file passes scanner cleanly
    fs.rmSync(badTestPath);
    fs.rmSync(facadeRunnerPath);
    fs.writeFileSync(stubProdPath, 'export function run(x) { return x * 2; }\n', 'utf8');
    fs.writeFileSync(
      path.join(tmp, 'tests', 'real.test.mjs'),
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { run } from '../src/core.js';\ntest('real', () => assert.equal(run(3), 6));\n",
      'utf8'
    );
    const cleanReport = scanProjectIntegrity({ workdir: tmp });
    assert.equal(cleanReport.verdict, 'CLEAN');
    assert.equal(cleanReport.findings.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SessionStart in DEVIN_CLOUD without initialized workspace stays STANDBY without creating .agents/teamwork', () => {
  const tmp = makeTmpDir('tw-cloud-standby-');
  try {
    const res = spawnSync('node', [HOOKS_ENGINE, 'SessionStart', '--workdir', tmp, '--adapter', 'devin'], {
      input: '{}',
      env: { ...process.env, DEVIN_CLOUD: '1' },
      encoding: 'utf8'
    });
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /STANDBY/);
    assert.equal(fs.existsSync(path.join(tmp, '.agents', 'teamwork')), false);
    assert.equal(fs.existsSync(path.join(tmp, '.agents', 'teamwork', 'watchdog.pid')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
