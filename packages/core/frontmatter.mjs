import crypto from 'node:crypto';

export function normalizePosix(p) {
  return String(p || '').replace(/\\/g, '/');
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

export function estimateTokens(text) {
  const len = String(text || '').length;
  return Math.max(1, Math.ceil(len / 4));
}

export function normalizeLineEndings(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

export function sha256Hex(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function sha256Text(content) {
  return sha256Hex(normalizeLineEndings(content));
}

function parseScalar(raw) {
  const s = String(raw).trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitInlineArray(inner).map((item) => parseScalar(item));
  }
  return s;
}

function splitInlineArray(inner) {
  const items = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote && ch === '\\' && quote === '"' && i + 1 < inner.length) {
      cur += ch + inner[i + 1];
      i += 1;
      continue;
    }
    if (quote === "'" && ch === "'" && inner[i + 1] === "'") {
      cur += "''";
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (quote === '"') quote = null;
      else if (!quote && (i === 0 || /[\s,]/.test(inner[i - 1]))) quote = '"';
      cur += ch;
    } else if (ch === "'") {
      if (quote === "'") quote = null;
      else if (!quote && (i === 0 || /[\s,]/.test(inner[i - 1]))) quote = "'";
      cur += ch;
    } else if (ch === ',' && !quote) {
      items.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

function stripInlineComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"' && ch === '\\' && i + 1 < line.length) {
      i += 1;
      continue;
    }
    if (quote === "'" && ch === "'" && line[i + 1] === "'") {
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (quote === '"') quote = null;
      else if (!quote && (i === 0 || !/[A-Za-z0-9]/.test(line[i - 1]))) quote = '"';
    } else if (ch === "'") {
      if (quote === "'") quote = null;
      else if (!quote && (i === 0 || !/[A-Za-z0-9]/.test(line[i - 1]))) quote = "'";
    } else if (ch === '#' && !quote && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

export function parseSimpleYaml(yamlText) {
  const lines = String(yamlText || '').split(/\r?\n/);
  const result = {};
  let i = 0;

  while (i < lines.length) {
    const rawLine = stripInlineComment(lines[i]);
    if (!rawLine.trim()) {
      i++;
      continue;
    }

    const topMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!topMatch) {
      i++;
      continue;
    }

    const key = topMatch[1];
    const rest = topMatch[2].trim();

    if (/^[|>][+-]?$/.test(rest)) {
      const folded = rest.startsWith('>');
      const chompStrip = rest.endsWith('-');
      i++;
      const blockLines = [];
      let baseIndent = null;
      while (i < lines.length) {
        const bl = lines[i];
        if (!bl.trim()) {
          blockLines.push('');
          i++;
          continue;
        }
        const mIndent = bl.match(/^(\s+)/);
        if (!mIndent) break;
        if (baseIndent === null) baseIndent = mIndent[1].length;
        else if (mIndent[1].length < baseIndent) break;
        blockLines.push(bl.slice(baseIndent));
        i++;
      }
      while (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') {
        if (chompStrip) blockLines.pop();
        else break;
      }
      const joined = folded ? blockLines.join(' ').replace(/\s+/g, ' ').trim() : blockLines.join('\n');
      result[key] = chompStrip ? joined.replace(/\n+$/, '') : joined;
      continue;
    }

    if (rest !== '') {
      result[key] = parseScalar(rest);
      i++;
      continue;
    }

    // Block list or nested object/array (supports both indented and 0-indent `- ` lists)
    i++;
    const items = [];
    let isObjectMap = false;
    const objMap = {};

    while (i < lines.length) {
      const nextRaw = stripInlineComment(lines[i]);
      if (!nextRaw.trim()) {
        i++;
        continue;
      }
      const indentMatch = nextRaw.match(/^(\s*)/);
      const nextIndent = indentMatch ? indentMatch[1].length : 0;
      const trimmed = nextRaw.trim();
      if (nextIndent === 0 && !trimmed.startsWith('- ')) break;

      if (trimmed.startsWith('- ')) {
        const afterDash = trimmed.slice(2).trim();
        const itemKv = afterDash.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (itemKv) {
          const itemObj = {};
          itemObj[itemKv[1]] = itemKv[2].trim() === '' ? [] : parseScalar(itemKv[2]);
          const baseIndent = nextIndent;
          i++;
          while (i < lines.length) {
            const subRaw = stripInlineComment(lines[i]);
            if (!subRaw.trim()) {
              i++;
              continue;
            }
            const subIndent = (subRaw.match(/^(\s*)/) || ['', ''])[1].length;
            const subTrim = subRaw.trim();
            if (subIndent < baseIndent || (subIndent === baseIndent && subTrim.startsWith('- '))) break;
            if (subIndent === baseIndent && !subTrim.startsWith('- ')) break;
            if (subTrim.startsWith('- ') && itemKv[2].trim() === '') {
              itemObj[itemKv[1]].push(parseScalar(subTrim.slice(2)));
              i++;
              continue;
            }
            const subKv = subTrim.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
            if (subKv) {
              const sk = subKv[1];
              const sv = subKv[2].trim();
              if (sv !== '') {
                itemObj[sk] = parseScalar(sv);
                i++;
              } else {
                const subArr = [];
                const propIndent = subIndent;
                i++;
                while (i < lines.length) {
                  const arrRaw = stripInlineComment(lines[i]);
                  if (!arrRaw.trim()) {
                    i++;
                    continue;
                  }
                  const arrIndent = (arrRaw.match(/^(\s*)/) || ['', ''])[1].length;
                  const arrTrim = arrRaw.trim();
                  if (arrIndent < propIndent || !arrTrim.startsWith('- ')) break;
                  subArr.push(parseScalar(arrTrim.slice(2)));
                  i++;
                }
                itemObj[sk] = subArr;
              }
            } else {
              i++;
            }
          }
          items.push(itemObj);
        } else {
          items.push(parseScalar(afterDash));
          i++;
        }
      } else {
        const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (kv) {
          isObjectMap = true;
          objMap[kv[1]] = parseScalar(kv[2]);
          i++;
        } else {
          i++;
        }
      }
    }

    if (items.length > 0 && !isObjectMap) {
      result[key] = items;
    } else if (isObjectMap) {
      result[key] = objMap;
    } else {
      result[key] = [];
    }
  }

  return result;
}

export function parseFrontmatter(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { hasFrontmatter: false, data: {}, body: normalized, frontmatterLineCount: 0 };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { hasFrontmatter: false, data: {}, body: normalized, frontmatterLineCount: 0 };
  }
  const yamlText = lines.slice(1, endIdx).join('\n');
  const body = lines.slice(endIdx + 1).join('\n');
  const data = parseSimpleYaml(yamlText);
  return {
    hasFrontmatter: true,
    data,
    body,
    frontmatterLineCount: endIdx + 1
  };
}

function formatYamlScalar(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  const str = String(val);
  if (
    /^[\w./-]+$/.test(str) &&
    !/^-?\d+(?:\.\d+)?$/.test(str) &&
    !['true', 'false', 'null', '~'].includes(str)
  ) {
    return str;
  }
  return JSON.stringify(str);
}

export function serializeFrontmatter(data, body = '') {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (value.every((v) => v === null || typeof v !== 'object')) {
        lines.push(`${key}: [${value.map((v) => formatYamlScalar(v)).join(', ')}]`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          if (item && typeof item === 'object') {
            const entries = Object.entries(item).filter(([, v]) => v !== undefined);
            if (entries.length === 0) continue;
            const [firstK, firstV] = entries[0];
            if (Array.isArray(firstV)) {
              lines.push(`  - ${firstK}: [${firstV.map((x) => formatYamlScalar(x)).join(', ')}]`);
            } else {
              lines.push(`  - ${firstK}: ${formatYamlScalar(firstV)}`);
            }
            for (let idx = 1; idx < entries.length; idx++) {
              const [k, v] = entries[idx];
              if (Array.isArray(v)) {
                lines.push(`    ${k}: [${v.map((x) => formatYamlScalar(x)).join(', ')}]`);
              } else {
                lines.push(`    ${k}: ${formatYamlScalar(v)}`);
              }
            }
          } else {
            lines.push(`  - ${formatYamlScalar(item)}`);
          }
        }
      }
    } else if (value && typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [sk, sv] of Object.entries(value)) {
        lines.push(`  ${sk}: ${formatYamlScalar(sv)}`);
      }
    } else {
      lines.push(`${key}: ${formatYamlScalar(value)}`);
    }
  }
  lines.push('---');
  const cleanBody = String(body || '').replace(/^\n+/, '');
  return `${lines.join('\n')}\n\n${cleanBody}${cleanBody.endsWith('\n') ? '' : '\n'}`;
}

export function extractSections(fullText) {
  const normalized = String(fullText || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const { frontmatterLineCount } = parseFrontmatter(normalized);

  const headings = [];
  let inCodeFence = false;

  for (let idx = frontmatterLineCount; idx < lines.length; idx++) {
    const line = lines[idx];
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      headings.push({
        id: slugify(m[2]),
        title: m[2].trim(),
        level: m[1].length,
        startLine: idx + 1
      });
    }
  }

  const sections = [];
  for (let i = 0; i < headings.length; i++) {
    const cur = headings[i];
    let endLine = lines.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= cur.level) {
        endLine = headings[j].startLine - 1;
        break;
      }
    }
    const slice = lines.slice(cur.startLine - 1, endLine).join('\n');
    sections.push({
      id: cur.id,
      title: cur.title,
      level: cur.level,
      lines: [cur.startLine, Math.max(cur.startLine, endLine)],
      token_estimate: estimateTokens(slice)
    });
  }

  return sections;
}
