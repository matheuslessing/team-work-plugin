const HIDDEN_UNICODE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\u{E0000}-\u{E007F}]/u;

const DDIPE_PATTERNS = [
  /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba)?sh\b/i,
  /\biwr\b[^\n|]*\|\s*iex\b/i,
  /\bpowershell(?:\.exe)?\b[^\n]*-(?:enc|encodedcommand)\b/i
];

const SECRET_SOURCE_RE = /(?:\.env\b|~\/\.ssh\b|\bid_rsa\b|\bAWS_SECRET_ACCESS_KEY\b|\bGITHUB_TOKEN\b|\bprocess\.env\b)/;
const OUTBOUND_TRANSFER_RE = /(?:\bcurl\b|\bwget\b|\bfetch\s*\(|\bwebhook\b|\bnc\s+[\w.-]+)/i;

const INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions\b/i,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|system)\s+(?:rules|instructions)\b/i,
  /\bdo\s+not\s+(?:tell|inform)\s+the\s+user\b/i,
  /\bsecretly\s+(?:send|upload|exfiltrate)\b/i
];

export function scanPromptSecurity(content, { filePath = '' } = {}) {
  const text = String(content || '');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const findings = [];

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

    for (const pat of DDIPE_PATTERNS) {
      if (pat.test(line)) {
        findings.push({
          code: 'DDIPE_PIPE_EXEC',
          line: lineNum,
          message: 'Remote pipe-to-shell or encoded PowerShell payload pattern detected',
          snippet: trimmed.slice(0, 120)
        });
        break;
      }
    }

    // Check secret access paired with outbound transfer on same line or within 5-line window
    if (SECRET_SOURCE_RE.test(line)) {
      const windowEnd = Math.min(lines.length, idx + 5);
      const windowStart = Math.max(0, idx - 4);
      const windowText = lines.slice(windowStart, windowEnd).join('\n');
      if (OUTBOUND_TRANSFER_RE.test(windowText)) {
        findings.push({
          code: 'CREDENTIAL_EXFILTRATION',
          line: lineNum,
          message: 'Sensitive credential/env read paired with outbound network transfer',
          snippet: trimmed.slice(0, 120)
        });
      }
    }

    for (const pat of INJECTION_PATTERNS) {
      if (pat.test(line)) {
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

  return {
    ok: findings.length === 0,
    findings
  };
}
