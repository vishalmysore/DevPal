/**
 * Lightweight secret redaction — a browser-native stand-in for repomix's
 * Secretlint pass. Scans text for common credential shapes and replaces them
 * before the context reaches the model (or an export), so keys don't leak into
 * a prompt. Regex-based and deliberately conservative: it targets
 * high-confidence patterns to avoid mangling ordinary code.
 */

const PATTERNS = [
  { name: 'AWS access key id',   re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'AWS secret key',      re: /\baws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi },
  { name: 'GitHub token',        re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'GitHub fine-grained', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: 'Slack token',         re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Google API key',      re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { name: 'OpenAI/Anthropic key',re: /\b(?:sk|sk-ant)-[A-Za-z0-9\-_]{20,}\b/g },
  { name: 'Stripe key',          re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'Private key block',   re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'JWT',                 re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: 'Generic secret assign', re: /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?token)\s*[=:]\s*['"][A-Za-z0-9\-_.]{16,}['"]/gi },
]

const PLACEHOLDER = '‹REDACTED-SECRET›'

/**
 * @returns {{ text: string, count: number }} the redacted text and how many
 * secrets were replaced.
 */
export function redactSecrets(text) {
  if (!text) return { text: text ?? '', count: 0 }
  let count = 0
  let out = text
  for (const { re } of PATTERNS) {
    out = out.replace(re, () => { count++; return PLACEHOLDER })
  }
  return { text: out, count }
}
