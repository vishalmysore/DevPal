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
