import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  extractSections,
  parseFrontmatter,
  serializeFrontmatter,
  sha256Text
} from '../packages/core/frontmatter.mjs';
import { validateHandoff, validateMemoryDoc } from '../packages/core/validator.mjs';
import {
  freezeContract,
  getActiveOrchestrator,
  loadState,
  transitionPhase
} from '../plugins/teamwork/scripts/lib/state-machine.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const TEAMWORK_CLI = path.join(REPO_ROOT, 'plugins', 'teamwork', 'scripts', 'teamwork-cli.mjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('frontmatter parser & section extractor round-trip cleanly with line ranges', () => {
  const doc = {
    id: 'arch-billing',
    kind: 'architecture',
    status: 'active',
    supersedes: null,
    summary: 'Billing pipeline and Stripe ledger reconciliation.',
    tags: ['billing', 'stripe'],
    source_refs: [
      { path: 'src/billing.ts', symbols: ['processWebhook', 'ledger'], sha256_prefix: 'abcd1234' }
    ]
  };
  const body = '# Billing\n\n## Overview\nHandles invoices.\n\n## Webhooks\nVerifies signatures.\n';
  const serialized = serializeFrontmatter(doc, body);
  const parsed = parseFrontmatter(serialized);

  assert.equal(parsed.hasFrontmatter, true);
  assert.equal(parsed.data.id, 'arch-billing');
  assert.deepEqual(parsed.data.tags, ['billing', 'stripe']);
  assert.equal(parsed.data.source_refs.length, 1);
  assert.equal(parsed.data.source_refs[0].path, 'src/billing.ts');
  assert.deepEqual(parsed.data.source_refs[0].symbols, ['processWebhook', 'ledger']);

  const sections = extractSections(serialized);
  assert.equal(sections.length, 3);
  assert.equal(sections[1].id, 'overview');
  assert.equal(sections[2].id, 'webhooks');
  assert.ok(sections[1].lines[0] < sections[2].lines[0]);

  const quotedFm = parseFrontmatter(serializeFrontmatter({ summary: 'Avoid "global state": drift' }, 'Body\n'));
  assert.equal(quotedFm.data.summary, 'Avoid "global state": drift');
  assert.equal(sha256Text('a\r\nb\r\n'), sha256Text('a\nb\n'));
});

test('validator validates handoff 5 components and memory docs against disk refs', () => {
  const tmp = makeTmpDir('tw-val-');
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'real.js'), 'export const ok = true;\n', 'utf8');

    const goodHandoff = [
      '# Handoff',
      '## 1. Observation',
      'Ran test command `node --test` -> exit 0.',
      '## 2. Logic Chain',
      'Observation confirms R1 passes.',
      '## 3. Caveats',
      'No caveats.',
      '## 4. Conclusion',
      'Verdict: CLEAN',
      '## 5. Verification Method',
      'Run `node --test`. Invalidation Conditions: fails if exit code != 0.'
    ].join('\n');
    const hRes = validateHandoff('handoff.md', goodHandoff, { requireVerdict: true });
    assert.equal(hRes.ok, true);
    assert.equal(hRes.verdict, 'CLEAN');

    const badHandoff = '## 1. Observation\nDone.\n## 4. Conclusion\nOk.';
    const badRes = validateHandoff('handoff.md', badHandoff);
    assert.equal(badRes.ok, false);
    assert.ok(badRes.errors.length >= 3);

    const badMem = serializeFrontmatter(
      {
        id: 'arch-missing',
        kind: 'architecture',
        status: 'active',
        summary: 'Points to a missing file on disk.',
        tags: ['test'],
        source_refs: [{ path: 'src/does-not-exist.js' }]
      },
      '## Overview\nDetails here that look plausible.'
    );
    const memRes = validateMemoryDoc('architecture/arch-missing.md', badMem, tmp, { checkDisk: true });
    assert.equal(memRes.ok, false);
    assert.match(memRes.errors.join(' '), /does not exist on disk/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('LTS state machine enforces transitions, contract freeze, and dynamic orchestrator succession (no orchestrator_1 hardcoding)', () => {
  const tmp = makeTmpDir('tw-state-');
  try {
    execFileSync('node', [TEAMWORK_CLI, 'init', '--workdir', tmp, '--env', 'local'], { encoding: 'utf8' });

    // Illegal jump INIT -> VICTORY_AUDIT must throw
    assert.throws(() => transitionPhase(tmp, 'VICTORY_AUDIT'), /Illegal LTS state transition/);

    transitionPhase(tmp, 'SURVEY', { reason: 'Phase 0 start' });
    const orch1Dir = path.join(tmp, '.agents', 'teamwork', 'orchestrator_1');
    fs.writeFileSync(
      path.join(orch1Dir, 'PROJECT.md'),
      '# Project\n\n## Architecture\nCore.\n\n## Interface Contracts\n- `runCore(input: string): Result`\n',
      'utf8'
    );

    const frozen = freezeContract(tmp);
    assert.equal(frozen.phase, 'CONTRACT_FROZEN');
    assert.equal(frozen.sha256.length, 64);

    // Trigger orchestrator succession -> orchestrator_2
    execFileSync('node', [TEAMWORK_CLI, 'succeed-orchestrator', '--workdir', tmp], { encoding: 'utf8' });
    const active = getActiveOrchestrator(tmp);
    assert.equal(active.id, 'orchestrator_2');
    assert.equal(loadState(tmp).active_orchestrator, 'orchestrator_2');

    // check-heartbeat and check-gate must target orchestrator_2 dynamically
    const hbOut = execFileSync('node', [TEAMWORK_CLI, 'check-heartbeat', '--workdir', tmp], { encoding: 'utf8' });
    assert.match(hbOut, /orchestrator_2/);

    // Write PASS gate strictly in orchestrator_2 while orchestrator_1 still has PENDING
    fs.writeFileSync(
      path.join(tmp, '.agents', 'teamwork', 'orchestrator_2', 'GATE_STATUS.md'),
      '# Gate Status\n\n## Gate — Iteration 1\n| reviewer_1 | gate | **APPROVE** | h |\n| auditor_1 | gate | **CLEAN** | h |\n\nGate Result: **PASS**\n',
      'utf8'
    );
    const gateOut = execFileSync('node', [TEAMWORK_CLI, 'check-gate', '--workdir', tmp], { encoding: 'utf8' });
    assert.match(gateOut, /orchestrator_2.*PASS/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
