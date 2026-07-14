/**
 * Code-aware compressor — JS port of code-compressor.ts from
 * headroom-demo (headroom, Apache-2.0). Preserves signatures,
 * imports, class/type defs; stubs function bodies.
 */

const KEEP_PATTERNS = [
  /^(import |from |export |require\()/,
  /^(class |def |async def |function |const |let |var |type |interface |struct |enum |impl )/,
  /^\s*(public |private |protected |static |async |export )*(function |class |def |async def )/,
  /^\s*(@\w+)/,
  /^\s*(return |raise |throw )/,
]

const DEF_RE = /^(\s*)(async\s+)?def\s+\w+|^(\s*)(public|private|protected|static|\s)*(async\s+)?function\s+\w+/
const COMMENT_RE = /\s+#(?! type:)[^\n]*/g

export function compressCode(text) {
  const lines = text.split('\n')
  const n = lines.length
  if (n <= 30) return text

  const output = []
  let i = 0
  let bodyIndent = ''
  let inBody = false
  let bodyLineCount = 0

  while (i < n) {
    const line = lines[i]
    const trimmed = line.trimStart()
    const indent = line.slice(0, line.length - trimmed.length)

    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') output.push('')
      i++; continue
    }

    if (inBody) {
      if (indent.length <= bodyIndent.length && trimmed) {
        inBody = false
        bodyLineCount = 0
      } else {
        if (bodyLineCount === 0) {
          const bodyLen = estimateBodyLines(lines, i, bodyIndent)
          output.push(`${bodyIndent}    ... // [${bodyLen} lines omitted]`)
        }
        bodyLineCount++
        i++; continue
      }
    }

    if (DEF_RE.test(line)) {
      output.push(line.replace(COMMENT_RE, ''))
      inBody = true
      bodyIndent = indent
      bodyLineCount = 0
      i++; continue
    }

    if (KEEP_PATTERNS.some(re => re.test(line))) {
      output.push(line.replace(COMMENT_RE, ''))
      i++; continue
    }

    if (/^(\s*)(class )\w+/.test(line)) {
      output.push(line)
      i++; continue
    }

    if (/^\s*("""|\'\'\')/.test(trimmed)) {
      output.push(line)
      const quote = trimmed.startsWith('"""') ? '"""' : "'''"
      if (!trimmed.slice(3).includes(quote)) {
        i++
        while (i < n && !lines[i].includes(quote)) i++
        if (i < n) i++
        continue
      }
      i++; continue
    }

    if (indent === '' && /^[A-Z_][A-Z0-9_]*\s*=/.test(trimmed)) {
      output.push(line)
      i++; continue
    }

    i++
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function estimateBodyLines(lines, startIdx, baseIndent) {
  let count = 0
  for (let i = startIdx; i < lines.length; i++) {
    const t = lines[i].trimStart()
    if (!t) { count++; continue }
    const ind = lines[i].slice(0, lines[i].length - t.length)
    if (ind.length <= baseIndent.length) break
    count++
  }
  return count
}

// Top-level declaration patterns for the repo-map skeleton. We only keep
// declarations at (or near) column 0 so a "map" stays to public surface —
// exports, classes, functions, types — not every nested helper.
const SIGNATURE_RE = /^(export\b|import\b|from\b|module\.exports|class\s|abstract\s+class\s|(export\s+)?(default\s+)?(async\s+)?function\b|(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)\s*=>|def\s|async\s+def\s|public\s|private\s|protected\s|interface\s|type\s+\w+\s*=|enum\s|struct\s|impl\s|trait\s|func\s|fn\s)/

/**
 * Extract a compact signature skeleton from source: top-level declarations
 * only, with trailing block-open braces and bodies stripped. Used by the
 * repo-map context strategy to render a whole-repo "table of contents".
 * Returns an array of one-line signature strings (may be empty).
 */
export function extractSignatures(text, maxLines = 40) {
  const out = []
  for (const raw of text.split('\n')) {
    if (out.length >= maxLines) { out.push('  …'); break }
    const trimmed = raw.trimStart()
    if (!trimmed) continue
    const indent = raw.length - trimmed.length
    if (indent > 2) continue // keep it top-level; skip nested members
    if (!SIGNATURE_RE.test(trimmed)) continue
    // Import/require lines are kept whole — their braces are the payload
    // (which symbols come from where), not a body to strip.
    const isImport = /^(import\b|from\b|const\s+.*=\s*require\(|module\.exports)/.test(trimmed)
    const sig = isImport
      ? trimmed.replace(/;\s*$/, '').replace(/\s*\/\/.*$/, '').trimEnd()
      : trimmed
          .replace(/\s*\{[\s\S]*$/, '')       // strip from first "{" onward
          .replace(/\s*=>\s*[\s\S]*$/, ' => …')
          .replace(/;\s*$/, '')
          .replace(/\/\/.*$/, '')
          .trimEnd()
    if (sig && sig !== 'import') out.push(sig)
  }
  return out
}

/** Markdown heading extractor for docs so the map still lists their topics. */
export function extractHeadings(text, maxLines = 12) {
  const out = []
  for (const line of text.split('\n')) {
    if (out.length >= maxLines) break
    if (/^#{1,4}\s+\S/.test(line)) out.push(line.trim())
  }
  return out
}

const CODE_EXTS = new Set([
  'js','jsx','ts','tsx','py','java','cs','go','rs','rb','php','cpp','c','h',
  'swift','kt','scala','sh','bash','yaml','yml','json','toml','md','html','css',
])

export function isCodeFile(filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  return CODE_EXTS.has(ext ?? '')
}

export function detectContentType(content) {
  const t = content.trimStart()
  if (/^(import |from |export |require\()/m.test(content)) return 'code'
  if (/^(def |async def |class |function |const |let )/m.test(content)) return 'code'
  return 'text'
}
