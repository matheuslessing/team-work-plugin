const HIDDEN_UNICODE_RE =
  /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
const STRIP_INVISIBLE_RE =
  /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

const DDIPE_PATTERNS = [
  /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:\/[\w/.-]+\/)?(?:(?:ba|z|da)?sh|python[\d.]*|node)\b/i,
  /\b(?:bash|sh|zsh)\s+<\(\s*(?:curl|wget)\b/i,
  /\beval\s+"?\$\(\s*(?:curl|wget)\b/i,
  /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n|]*\|\s*(?:iex|invoke-expression)\b/i,
  /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*\s-(?:e|ec|en|enc|encodedcommand)\b/i
];

const SECRET_SOURCE_RE =
  /(?:(?:^|[\s"'`/=])\.env\b|~\/\.ssh\b|~\/\.aws\b|~\/\.npmrc\b|\bid_rsa\b|\bid_ed25519\b|\bAWS_SECRET_ACCESS_KEY\b|\bGITHUB_TOKEN\b|\bOPENAI_API_KEY\b|\bANTHROPIC_API_KEY\b|\bprocess\.env\b|\bos\.environ\b)/;

const EXFIL_COMMAND_RE =
  /(?:\b(?:curl|wget)\b[^\n]*(?:https?:\/\/|-[dFX]|--data|@)|\b(?:fetch|axios(?:\.\w+)?|requests\.post|urllib\.request)\s*\([^\n]*https?:\/\/|\b(?:nc|ncat|scp)\s+[\w.-]+)/i;

const INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions\b/i,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|system)\s+(?:rules|instructions)\b/i,
  /\bdo\s+not\s+(?:tell|inform)\s+the\s+user\b/i,
  /\bsecretly\s+(?:send|upload|exfiltrate)\b/i
];

function stripLocalhostUrls(text) {
  return String(text || '').replace(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s"')`]*/gi, '');
}

export function scanPromptSecurity(content, { filePath = '' } = {}) {
  const rawText = String(content || '').replace(/\r\n/g, '\n');
  const lines = rawText.split('\n');
  const findings = [];
  const ddipeLines = new Set();
  const injectionLines = new Set();

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    if (HIDDEN_UNICODE_RE.test(line) || (idx > 0 && line.includes('\uFEFF')) || (idx === 0 && line.slice(1).includes('\uFEFF'))) {
      findings.push({
        code: 'HIDDEN_UNICODE',
        line: lineNum,
        message: `Hidden zero-width, BiDi, or Unicode tag character detected${filePath ? ` in ${filePath}` : ''}`,
        snippet: trimmed.slice(0, 120)
      });
    }

    const cleanLine = line.replace(STRIP_INVISIBLE_RE, '');
    const joinedClean =
      line.trimEnd().endsWith('\\') && idx + 1 < lines.length
        ? `${cleanLine.replace(/\\\s*$/, ' ')}${lines[idx + 1].replace(STRIP_INVISIBLE_RE, '').trim()}`
        : cleanLine;

    for (const pat of DDIPE_PATTERNS) {
      if (pat.test(joinedClean)) {
        ddipeLines.add(lineNum);
        findings.push({
          code: 'DDIPE_PIPE_EXEC',
          line: lineNum,
          message: 'Remote pipe-to-shell or encoded PowerShell payload pattern detected',
          snippet: trimmed.slice(0, 120)
        });
        break;
      }
    }

    // Check secret access paired with external outbound network transfer in a 6-line window
    if (SECRET_SOURCE_RE.test(cleanLine)) {
      const windowEnd = Math.min(lines.length, idx + 6);
      const windowStart = Math.max(0, idx - 5);
      const windowText = lines
        .slice(windowStart, windowEnd)
        .map((l) => l.replace(STRIP_INVISIBLE_RE, ''))
        .join('\n');
      if (EXFIL_COMMAND_RE.test(stripLocalhostUrls(windowText))) {
        findings.push({
          code: 'CREDENTIAL_EXFILTRATION',
          line: lineNum,
          message: 'Sensitive credential/env read paired with outbound network transfer',
          snippet: trimmed.slice(0, 120)
        });
      }
    }

    const nextPair = `${cleanLine} ${idx + 1 < lines.length ? lines[idx + 1].replace(STRIP_INVISIBLE_RE, '') : ''}`;
    for (const pat of INJECTION_PATTERNS) {
      if (pat.test(cleanLine) || (!injectionLines.has(lineNum) && pat.test(nextPair))) {
        injectionLines.add(lineNum);
        findings.push({
          code: 'PROMPT_INJECTION_OVERRIDE',
          line: lineNum,
          message: 'Prompt injection / instruction hijacking directive detected',
          snippet: trimmed.slice(0, 120)
        });
        break;
      }
    }
  });

  // Also detect DDIPE if split across multiline backslash continuation of >2 lines
  const collapsed = rawText.replace(STRIP_INVISIBLE_RE, '').replace(/\\\s*\n\s*/g, ' ');
  for (const pat of DDIPE_PATTERNS) {
    if (pat.test(collapsed) && ddipeLines.size === 0) {
      findings.push({
        code: 'DDIPE_PIPE_EXEC',
        line: 1,
        message: 'Multiline remote pipe-to-shell or encoded PowerShell payload pattern detected',
        snippet: collapsed.trim().slice(0, 120)
      });
      break;
    }
  }

  return {
    ok: findings.length === 0,
    findings
  };
}
