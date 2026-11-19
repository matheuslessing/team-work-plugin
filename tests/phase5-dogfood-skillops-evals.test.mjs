import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFrontmatter } from '../packages/core/frontmatter.mjs';
import { auditSkills, scaffoldSkill } from '../plugins/harness-forge/scripts/lib/skillops.mjs';
import { runSkillUseEval } from '../plugins/harness-forge/scripts/lib/skill-use-eval.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

test('Dogfooding: ALL skills in both plugins pass SkillOps audit --strict and AGENTS.md stay within Progressive Disclosure limits', () => {
  const teamworkSkillsDir = path.join(REPO_ROOT, 'plugins', 'teamwork', 'skills');
  const forgeSkillsDir = path.join(REPO_ROOT, 'plugins', 'harness-forge', 'skills');

  const twAudit = auditSkills(teamworkSkillsDir, { strict: true });
  assert.equal(twAudit.ok, true, `teamwork audit errors: ${twAudit.errors.join('; ')}`);
  assert.equal(twAudit.totalSkills, 12);
  assert.equal(twAudit.validSkillsCount, 12);

  const fgAudit = auditSkills(forgeSkillsDir, { strict: true });
  assert.equal(fgAudit.ok, true, `harness-forge audit errors: ${fgAudit.errors.join('; ')}`);
  assert.equal(fgAudit.totalSkills, 8);
  assert.equal(fgAudit.validSkillsCount, 8);

  const twAgentsBytes = fs.statSync(path.join(REPO_ROOT, 'plugins', 'teamwork', 'AGENTS.md')).size;
  const fgAgentsBytes = fs.statSync(path.join(REPO_ROOT, 'plugins', 'harness-forge', 'AGENTS.md')).size;
  assert.ok(twAgentsBytes <= 3000, `teamwork/AGENTS.md too large: ${twAgentsBytes} bytes`);
  assert.ok(fgAgentsBytes <= 2500, `harness-forge/AGENTS.md too large: ${fgAgentsBytes} bytes`);
});

test('Read-only and audit-only agent profiles do NOT expose edit tool', () => {
  const readOnlyAgents = ['explorer.md', 'reviewer.md', 'challenger.md', 'forensic-auditor.md', 'victory-auditor.md'];
  for (const file of readOnlyAgents) {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'plugins', 'teamwork', 'agents', file), 'utf8');
    const fm = parseFrontmatter(content);
    const tools = fm.data['allowed-tools'] || [];
    assert.equal(tools.includes('edit'), false, `${file} must NOT include edit in allowed-tools`);
    assert.ok(['read_only', 'audit_only'].includes(fm.data.authority_profile), `${file} missing read_only/audit_only authority_profile`);
  }
});

test('Skill scaffolding targets external repo without writing inside team-plugin repo', () => {
  const externalRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'external-repo-'));
  try {
    const targetSkillsDir = path.join(externalRepo, '.agents', 'skills');
    const res = scaffoldSkill(targetSkillsDir, {
      name: 'custom-deploy',
      description: 'Validates build artifacts and runs deployment checklist cleanly.',
      authorityProfile: 'scoped_worker'
    });
    assert.equal(res.ok, true);
    assert.ok(fs.existsSync(path.join(externalRepo, '.agents', 'skills', 'custom-deploy', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(externalRepo, '.agents', 'skills', 'custom-deploy', 'skill.contract.json')));
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'plugins', 'harness-forge', 'skills', 'custom-deploy')), false);
  } finally {
    fs.rmSync(externalRepo, { recursive: true, force: true });
  }
});

test('workflow.py Gate-failure safety refuses to invoke victory_auditor when Gate fails all iterations', () => {
  const pyScript = `
import asyncio, json, os, shutil, sys, tempfile
sys.path.insert(0, ${JSON.stringify(path.join(REPO_ROOT, 'plugins', 'teamwork', 'skills', 'team-cloud-workflow'))})
import workflow

async def main():
    calls = []
    async def mock_agent(prompt, **kwargs):
        label = kwargs.get('label', '')
        calls.append(label)
        if 'explorer' in label:
            return {'domain': 'd', 'root_causes': [], 'interface_contracts': ['c'], 'owned_files': ['f']}
        if 'synthesize' in label:
            return {'project_md_written': True, 'milestones': [{'id': 'm1', 'scope': 's', 'owned_files': ['src/a.js']}]}
        if 'reviewer' in label or 'challenger' in label:
            return {'agent_id': label, 'verdict': 'REQUEST_CHANGES', 'defects': ['bug'], 'handoff_path': 'h.md'}
        if 'forensic-auditor' in label:
            return {'agent_id': label, 'verdict': 'INTEGRITY_VIOLATION', 'defects': ['mock'], 'handoff_path': 'h.md'}
        if 'probe' in label:
            return {'candidate_id': label, 'hypothesis': 'h', 'branch': 'b', 'probe_passed': False, 'probe_output': 'fail', 'diff_summary': 'd'}
        return {'agent_id': label, 'handoff_path': 'h.md', 'compile_errors': 0, 'summary': 'ok'}

    async def mock_parallel(fns):
        return await asyncio.gather(*[fn() for fn in fns])

    tmp = tempfile.mkdtemp()
    old_cwd = os.getcwd()
    os.chdir(tmp)
    try:
        res = await workflow.execute_full_workflow(agent_fn=mock_agent, parallel_fn=mock_parallel)
        print(json.dumps({'result': res, 'calls': calls}))
    finally:
        os.chdir(old_cwd)
        shutil.rmtree(tmp, ignore_errors=True)

asyncio.run(main())
`;
  const out = execFileSync('python', ['-c', pyScript], { encoding: 'utf8' });
  const parsed = JSON.parse(out.trim().split(/\r?\n/).pop());
  assert.equal(parsed.result.status, 'GATE_FAILED_EXHAUSTED');
  assert.equal(parsed.calls.includes('victory-auditor'), false, 'victory-auditor MUST NOT run when Gate fails');
  assert.ok(parsed.calls.some((c) => c.startsWith('harness2-probe-')), 'Harness2 Propose-Probe-Compose should run on iteration 2 failure');
  assert.ok(parsed.calls.some((c) => c.startsWith('harness2-compose-')), 'Harness2 Compose should run after probes');
});

test('Skill-Use eval benchmark achieves SU Score >= 0.90 across Trigger, Compliance, and Boundary', async () => {
  const report = await runSkillUseEval('tests/evals/skill-use', REPO_ROOT);
  assert.ok(report.metrics.su_score >= 0.9, `Expected SU Score >= 0.90, got ${report.metrics.su_score}: ${JSON.stringify(report.scenarios)}`);
  assert.equal(report.metrics.trigger_rate, 1, `Trigger misses: ${JSON.stringify(report.scenarios.filter((s) => s.trigger === 0))}`);
  assert.equal(report.metrics.boundary_rate, 1, `Boundary misses: ${JSON.stringify(report.scenarios.filter((s) => s.boundary < 1))}`);
});
