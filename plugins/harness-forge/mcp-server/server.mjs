#!/usr/bin/env node
/**
 * Harness Forge Embedded Stdio MCP Server (JSON-RPC 2.0)
 * Exposes PMSP Project Memory & SkillOps tools over stdio.
 * Supports both Content-Length framing and newline-delimited JSON-RPC.
 * Modes:
 *   FORGE_MCP_MODE=full           (read + validated write tools)
 *   FORGE_MCP_MODE=validator-only (validated write & drift tools only; pairs with company read-only rcjson MCP)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSkillDir } from '../scripts/core/validator.mjs';
import {
  checkDrift,
  promoteFromTeamwork,
  readMemoryDoc,
  readMemoryIndex,
  rebuildIndex,
  recordAdr,
  retireMemoryDoc,
  searchMemory,
  upsertMemoryDoc
} from '../scripts/lib/memory-engine.mjs';
import { buildEcosystemGraph, resolveSkillTargetDir, scaffoldSkill, triageSkills } from '../scripts/lib/skillops.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, '..');

const MCP_MODE = (process.env.FORGE_MCP_MODE || 'full').toLowerCase();

const ALL_TOOLS = [
  {
    name: 'memory_index',
    readTool: true,
    description: 'Read compiled memory.rc.json index (Progressive Disclosure catalog).',
    inputSchema: {
      type: 'object',
      properties: {
        project_dir: { type: 'string' },
        kind: { type: 'string', enum: ['architecture', 'decision', 'contract', 'gotcha'] },
        tag: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_search',
    readTool: true,
    description: 'Hybrid BM25 search across project memory penalizing stale/superseded docs.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        project_dir: { type: 'string' },
        query: { type: 'string' },
        kind: { type: 'string' },
        tag: { type: 'string' },
        include_stale: { type: 'boolean' },
        limit: { type: 'integer' }
      }
    }
  },
  {
    name: 'memory_read',
    readTool: true,
    description: 'Surgically read a memory document or specific section by ID.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        project_dir: { type: 'string' },
        id: { type: 'string' },
        section: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_drift',
    readTool: false,
    description: 'Check SHA-256 drift of memory source_refs against current files on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        project_dir: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_upsert',
    readTool: false,
    description: 'Validate frontmatter & real disk source_refs, compute SHA-256 hashes, write .md atomically, and recompile memory.rc.json.',
    inputSchema: {
      type: 'object',
      required: ['id', 'kind', 'summary', 'tags', 'body'],
      properties: {
        project_dir: { type: 'string' },
        id: { type: 'string' },
        kind: { type: 'string', enum: ['architecture', 'decision', 'contract', 'gotcha'] },
        status: { type: 'string', enum: ['active', 'stale', 'superseded', 'deprecated'] },
        supersedes: { type: ['string', 'null'] },
        summary: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        source_refs: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path'],
            properties: {
              path: { type: 'string' },
              symbols: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        body: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_record_adr',
    readTool: false,
    description: 'Create next sequential ADR-NNNN decision doc, optionally marking superseded ADR, and recompile memory.rc.json.',
    inputSchema: {
      type: 'object',
      required: ['title', 'context', 'decision', 'consequences'],
      properties: {
        project_dir: { type: 'string' },
        title: { type: 'string' },
        context: { type: 'string' },
        decision: { type: 'string' },
        consequences: { type: 'string' },
        supersedes: { type: ['string', 'null'] },
        tags: { type: 'array', items: { type: 'string' } },
        source_refs: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path'],
            properties: {
              path: { type: 'string' },
              symbols: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    }
  },
  {
    name: 'memory_retire',
    readTool: false,
    description: 'Mark a memory doc as deprecated or superseded without deleting history.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        project_dir: { type: 'string' },
        id: { type: 'string' },
        status: { type: 'string', enum: ['deprecated', 'superseded'] },
        superseded_by: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_rebuild_index',
    readTool: false,
    description: 'Deterministically recompile memory.rc.json, MEMORY.md, and search cache from .memory/**/*.md.',
    inputSchema: {
      type: 'object',
      properties: {
        project_dir: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_promote',
    readTool: false,
    description: 'Promote Teamwork DEAD_ENDS.md lessons into verified .memory/gotchas/*.md entries.',
    inputSchema: {
      type: 'object',
      properties: {
        project_dir: { type: 'string' }
      }
    }
  },
  {
    name: 'skill_index',
    readTool: true,
    description: 'List standardized skills and their contracts in a project or plugin skills directory.',
    inputSchema: {
      type: 'object',
      properties: {
        project_dir: { type: 'string' },
        skills_dir: { type: 'string' }
      }
    }
  },
  {
    name: 'skill_graph',
    readTool: true,
    description: 'Build SkillOps Ecosystem Graph (edges + redundancy candidates).',
    inputSchema: {
      type: 'object',
      properties: {
        project_dir: { type: 'string' },
        skills_dir: { type: 'string' },
        write: { type: 'boolean' }
      }
    }
  },
  {
    name: 'skill_triage',
    readTool: true,
    description: 'Deterministically triage a skill or skills directory and recommend SCAFFOLD, MIGRATE, SKILLOPS_FIX, EVAL_EVOLVE, or CLEAN.',
    inputSchema: {
      type: 'object',
      properties: {
        project_dir: { type: 'string' },
        target: { type: 'string' }
      }
    }
  },
  {
    name: 'skill_validate',
    readTool: false,
    description: 'Validate a skill directory against SkillOps 5-tuple and Progressive Disclosure rules.',
    inputSchema: {
      type: 'object',
      required: ['skill_dir'],
      properties: {
        project_dir: { type: 'string' },
        skill_dir: { type: 'string' }
      }
    }
  },
  {
    name: 'skill_scaffold',
    readTool: false,
    description: 'Create a compliant SkillOps skill (SKILL.md + skill.contract.json) in project, global, or plugin scope.',
    inputSchema: {
      type: 'object',
      required: ['name', 'description'],
      properties: {
        project_dir: { type: 'string' },
        scope: { type: 'string', enum: ['project', 'global', 'plugin'] },
        target: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        authority_profile: { type: 'string' },
        body: { type: 'string' }
      }
    }
  }
];

function getVisibleTools() {
  if (MCP_MODE === 'validator-only') {
    return ALL_TOOLS.filter((t) => !t.readTool);
  }
  return ALL_TOOLS;
}

async function handleToolCall(name, args = {}) {
  const projectDir = path.resolve(args.project_dir || process.env.DEVIN_PROJECT_DIR || process.cwd());
  const visible = new Set(getVisibleTools().map((t) => t.name));
  if (!visible.has(name)) {
    throw new Error(`Tool "${name}" is not enabled in FORGE_MCP_MODE=${MCP_MODE}`);
  }

  switch (name) {
    case 'memory_index':
      return readMemoryIndex(projectDir, { kind: args.kind || null, tag: args.tag || null });
    case 'memory_search':
      return searchMemory(projectDir, args.query, {
        kind: args.kind || null,
        tag: args.tag || null,
        includeStale: args.include_stale !== false,
        limit: args.limit || 10
      });
    case 'memory_read':
      return readMemoryDoc(projectDir, args.id, args.section || null);
    case 'memory_drift':
      return checkDrift(projectDir);
    case 'memory_upsert':
      return upsertMemoryDoc(projectDir, args);
    case 'memory_record_adr':
      return recordAdr(projectDir, args);
    case 'memory_retire':
      return retireMemoryDoc(projectDir, args.id, {
        status: args.status || 'deprecated',
        supersededBy: args.superseded_by || null
      });
    case 'memory_rebuild_index':
      return rebuildIndex(projectDir);
    case 'memory_promote':
      return promoteFromTeamwork(projectDir);
    case 'skill_index': {
      const skillsDir = args.skills_dir
        ? path.resolve(projectDir, args.skills_dir)
        : path.join(projectDir, '.agents', 'skills');
      const graph = buildEcosystemGraph(skillsDir, { write: false });
      return { skills_dir: graph.skills_dir, nodes: graph.nodes };
    }
    case 'skill_graph': {
      const skillsDir = args.skills_dir
        ? path.resolve(projectDir, args.skills_dir)
        : path.join(projectDir, '.agents', 'skills');
      return buildEcosystemGraph(skillsDir, { write: Boolean(args.write) });
    }
    case 'skill_triage':
      return triageSkills({ targetPath: args.target || '', workspaceRoot: projectDir });
    case 'skill_validate':
      return validateSkillDir(path.resolve(projectDir, args.skill_dir));
    case 'skill_scaffold': {
      const targetDir = resolveSkillTargetDir({
        scope: args.scope || 'project',
        target: args.target || '',
        workspaceRoot: projectDir,
        pluginRoot
      });
      return scaffoldSkill(targetDir, {
        name: args.name,
        description: args.description,
        authorityProfile: args.authority_profile || 'scoped_worker',
        body: args.body || ''
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

let useContentLength = false;

function sendResponse(obj) {
  const payload = JSON.stringify(obj);
  if (useContentLength) {
    const byteLen = Buffer.byteLength(payload, 'utf8');
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${payload}`);
  } else {
    process.stdout.write(payload + '\n');
  }
}

async function dispatchMessage(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) {
    // Notification (no reply)
    return;
  }

  try {
    if (method === 'initialize') {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'harness-forge-memory', version: '2.0.0' }
        }
      });
    } else if (method === 'ping') {
      sendResponse({ jsonrpc: '2.0', id, result: {} });
    } else if (method === 'resources/list') {
      sendResponse({ jsonrpc: '2.0', id, result: { resources: [] } });
    } else if (method === 'prompts/list') {
      sendResponse({ jsonrpc: '2.0', id, result: { prompts: [] } });
    } else if (method === 'tools/list') {
      const tools = getVisibleTools().map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema
      }));
      sendResponse({ jsonrpc: '2.0', id, result: { tools } });
    } else if (method === 'tools/call') {
      try {
        const res = await handleToolCall(params?.name, params?.arguments || {});
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
            isError: false
          }
        });
      } catch (toolErr) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: toolErr.message }],
            isError: true
          }
        });
      }
    } else {
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
    }
  } catch (err) {
    sendResponse({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err.message }
    });
  }
}

let buffer = Buffer.alloc(0);

async function processBuffer() {
  while (buffer.length > 0) {
    while (buffer.length > 0 && (buffer[0] === 0x0d || buffer[0] === 0x0a)) {
      buffer = buffer.slice(1);
    }
    if (buffer.length === 0) return;

    const headPeek = buffer.slice(0, Math.min(buffer.length, 64)).toString('utf8');
    if (/^(?:Content-Length|Content-Type):/i.test(headPeek)) {
      useContentLength = true;
      const crlfIdx = buffer.indexOf('\r\n\r\n');
      const lfIdx = buffer.indexOf('\n\n');
      let sepIdx = -1;
      let sepLen = 0;
      if (crlfIdx !== -1 && (lfIdx === -1 || crlfIdx <= lfIdx)) {
        sepIdx = crlfIdx;
        sepLen = 4;
      } else if (lfIdx !== -1) {
        sepIdx = lfIdx;
        sepLen = 2;
      }
      if (sepIdx === -1) return;

      const headerStr = buffer.slice(0, sepIdx).toString('utf8');
      const m = headerStr.match(/Content-Length:\s*(\d+)/i);
      if (!m) {
        buffer = buffer.slice(sepIdx + sepLen);
        sendResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: missing valid Content-Length header' }
        });
        continue;
      }
      const len = Number(m[1]);
      if (!Number.isSafeInteger(len) || len < 0) {
        buffer = buffer.slice(sepIdx + sepLen);
        sendResponse({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: invalid Content-Length value' }
        });
        continue;
      }
      const total = sepIdx + sepLen + len;
      if (buffer.length < total) return;
      const bodyStr = buffer.slice(sepIdx + sepLen, total).toString('utf8');
      buffer = buffer.slice(total);
      if (bodyStr.trim()) {
        let parsed;
        try {
          parsed = JSON.parse(bodyStr);
        } catch (parseErr) {
          sendResponse({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Parse error: ${parseErr.message}` }
          });
          continue;
        }
        await dispatchMessage(parsed);
      }
    } else {
      const nlIdx = buffer.indexOf('\n');
      if (nlIdx === -1) return;
      const line = buffer.slice(0, nlIdx).toString('utf8').trim();
      buffer = buffer.slice(nlIdx + 1);
      if (line) {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (parseErr) {
          sendResponse({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Parse error: ${parseErr.message}` }
          });
          continue;
        }
        await dispatchMessage(parsed);
      }
    }
  }
}

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') {
    process.exit(0);
  }
});

let processing = Promise.resolve();
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processing = processing.then(() => processBuffer()).catch((err) => {
    process.stderr.write(`[harness-forge-mcp] parse error: ${err.message}\n`);
  });
});

process.stdin.on('end', () => {
  processing.finally(() => {
    process.stdout.write('', () => process.exit(0));
  });
});
