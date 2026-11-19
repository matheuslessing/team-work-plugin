import fs from 'node:fs';
import path from 'node:path';
import { getTeamworkRoot } from './state-machine.mjs';

export function getBoardPath(workdir) {
  return path.join(getTeamworkRoot(workdir), 'board.jsonl');
}

export function getBoardMetaPath(workdir) {
  return path.join(getTeamworkRoot(workdir), 'board-meta.json');
}

function readAllEntries(workdir) {
  const boardPath = getBoardPath(workdir);
  if (!fs.existsSync(boardPath)) return [];
  const raw = fs.readFileSync(boardPath, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadBoardMeta(workdir) {
  const metaPath = getBoardMetaPath(workdir);
  if (!fs.existsSync(metaPath)) {
    return { channels: { main: { topic: 'Cross-area decisions and final status', archived: false } }, members: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return { channels: { main: { topic: 'Cross-area decisions and final status', archived: false } }, members: {} };
  }
}

function saveBoardMeta(workdir, meta) {
  const metaPath = getBoardMetaPath(workdir);
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  const tmp = `${metaPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8');
  fs.renameSync(tmp, metaPath);
}

export function parseMentions(text) {
  const mentions = new Set();
  const channelMentions = new Set();
  for (const m of String(text || '').matchAll(/@(#?[a-z0-9_-]+)/gi)) {
    const token = m[1].toLowerCase();
    if (token.startsWith('#')) channelMentions.add(token.slice(1));
    else mentions.add(token);
  }
  return {
    mentions: [...mentions],
    channelMentions: [...channelMentions]
  };
}

export function createChannel(workdir, channel, topic = '') {
  const name = String(channel || '').replace(/^#/, '').toLowerCase();
  if (!name) throw new Error('Channel name cannot be empty');
  const meta = loadBoardMeta(workdir);
  meta.channels[name] = { topic, archived: false, created_at: new Date().toISOString() };
  saveBoardMeta(workdir, meta);
  return meta.channels[name];
}

export function registerBoardMember(workdir, member, { role = 'worker', channels = ['main'], status = 'waiting' } = {}) {
  const meta = loadBoardMeta(workdir);
  meta.members[member] = {
    ...(meta.members[member] || {}),
    role,
    channels: [...new Set(['main', ...channels.map((c) => c.replace(/^#/, '').toLowerCase())])],
    status,
    last_read_seq: meta.members[member]?.last_read_seq || 0,
    last_post_seq: meta.members[member]?.last_post_seq || 0,
    updated_at: new Date().toISOString()
  };
  saveBoardMeta(workdir, meta);
  return meta.members[member];
}

export function postMessage(workdir, { from = 'coordinator', channel = 'main', text, kind = 'message', refs = [] }) {
  if (!text || !String(text).trim()) {
    throw new Error('Board message text cannot be empty');
  }
  const boardPath = getBoardPath(workdir);
  fs.mkdirSync(path.dirname(boardPath), { recursive: true });

  const entries = readAllEntries(workdir);
  const seq = entries.length > 0 ? entries[entries.length - 1].seq + 1 : 1;
  const cleanChannel = String(channel || 'main').replace(/^#/, '').toLowerCase();
  const parsed = parseMentions(text);
  const ts = new Date().toISOString();

  const entry = {
    seq,
    timestamp: ts,
    from,
    channel: cleanChannel,
    kind,
    mentions: parsed.mentions,
    channel_mentions: parsed.channelMentions,
    refs: Array.isArray(refs) ? refs : [],
    done: /\[done\]/i.test(text),
    text: String(text).trim()
  };

  fs.appendFileSync(boardPath, JSON.stringify(entry) + '\n', 'utf8');

  const meta = loadBoardMeta(workdir);
  if (!meta.channels[cleanChannel]) {
    meta.channels[cleanChannel] = { topic: '', archived: false };
  }
  if (!meta.members[from]) {
    meta.members[from] = { role: from === 'coordinator' ? 'coordinator' : 'worker', channels: ['main', cleanChannel], last_read_seq: 0, last_post_seq: 0 };
  }
  meta.members[from].last_post_seq = seq;
  meta.members[from].last_read_seq = Math.max(meta.members[from].last_read_seq || 0, seq);
  meta.members[from].last_post_time = ts;
  meta.members[from].status = entry.done ? 'waiting' : 'working';
  saveBoardMeta(workdir, meta);

  return entry;
}

export function readBoard(workdir, { since = 0, channel = null, reader = null, limit = 200 } = {}) {
  const entries = readAllEntries(workdir);
  const cleanChannel = channel && channel !== '*' ? String(channel).replace(/^#/, '').toLowerCase() : null;

  let filtered = entries.filter((e) => e.seq > Number(since || 0));
  if (cleanChannel) {
    filtered = filtered.filter((e) => e.channel === cleanChannel || e.channel === 'main');
  }
  if (limit && filtered.length > limit) {
    filtered = filtered.slice(0, limit);
  }

  if (reader && filtered.length > 0) {
    const meta = loadBoardMeta(workdir);
    meta.members[reader] = meta.members[reader] || { role: 'worker', channels: ['main'], last_read_seq: 0, last_post_seq: 0 };
    meta.members[reader].last_read_seq = Math.max(
      meta.members[reader].last_read_seq || 0,
      filtered[filtered.length - 1].seq
    );
    saveBoardMeta(workdir, meta);
  }

  return filtered;
}

export function getBoardStatus(workdir) {
  const entries = readAllEntries(workdir);
  const meta = loadBoardMeta(workdir);
  const headSeq = entries.length > 0 ? entries[entries.length - 1].seq : 0;
  return {
    head_seq: headSeq,
    total_messages: entries.length,
    channels: meta.channels,
    members: meta.members
  };
}
