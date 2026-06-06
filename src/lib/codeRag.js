/**
 * Code RAG — indexes cloned repo files using code-aware compression,
 * then retrieves relevant chunks via TF-IDF scoring against a query.
 */
import { compressCode, isCodeFile, detectContentType } from './codeCompressor.js'

const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','of','in','on',
  'at','to','for','with','by','from','as','into','about','and','or','but','not',
  'it','its','this','that','they','their','he','she','we','you','i','can','also',
])

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9_\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w))
}

// In-memory index: Array<{ path, compressed, tokens, originalSize, compressedSize }>
let _index = []

export function clearIndex() {
  _index = []
}

export function getIndexStats() {
  return {
    files: _index.length,
    totalOriginal: _index.reduce((s, e) => s + e.originalSize, 0),
    totalCompressed: _index.reduce((s, e) => s + e.compressedSize, 0),
  }
}

/**
 * Index a single file into the RAG store.
 * Code files get compressed signatures; others are chunked raw.
 */
export function indexFile(path, content) {
  if (!content || content.length < 30) return
  // Skip binary-looking files
  if (/[\x00-\x08\x0e-\x1f]/.test(content.slice(0, 200))) return

  const type = detectContentType(content)
  const compressed = type === 'code' ? compressCode(content) : chunkText(content)

  _index.push({
    path,
    compressed: typeof compressed === 'string' ? compressed : compressed.join('\n\n'),
    tokens: tokenize(compressed ?? content),
    originalSize: content.length,
    compressedSize: (compressed ?? content).length,
  })
}

function chunkText(text, maxChars = 800) {
  const paras = text.split(/\n{2,}/).filter(p => p.trim())
  const chunks = []
  let cur = ''
  for (const p of paras) {
    if ((cur + p).length > maxChars && cur) {
      chunks.push(cur.trim())
      cur = p
    } else {
      cur += '\n\n' + p
    }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks.join('\n\n---\n\n')
}

/**
 * TF-IDF retrieval: score each indexed entry against query terms,
 * return top-K most relevant, with compressed content.
 */
export function retrieveContext(query, topK = 4) {
  if (_index.length === 0) return []

  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return []

  const N = _index.length

  // IDF: log(N / df)
  const df = {}
  for (const entry of _index) {
    const wordSet = new Set(entry.tokens)
    for (const qt of queryTerms) {
      if (wordSet.has(qt)) df[qt] = (df[qt] ?? 0) + 1
    }
  }
  const idf = {}
  for (const qt of queryTerms) {
    idf[qt] = Math.log((N + 1) / ((df[qt] ?? 0) + 1)) + 1
  }

  // Score each entry
  const scored = _index.map(entry => {
    const len = Math.max(entry.tokens.length, 1)
    let score = 0
    for (const qt of queryTerms) {
      const tf = entry.tokens.filter(w => w === qt).length / len
      score += tf * (idf[qt] ?? 1)
    }
    return { ...entry, score }
  })

  return scored
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * Build the context block to inject into the LLM prompt.
 */
export function buildContextBlock(query, topK = 4) {
  const hits = retrieveContext(query, topK)
  if (hits.length === 0) return ''

  const blocks = hits.map(h => {
    const ratio = h.originalSize > 0
      ? Math.round((1 - h.compressedSize / h.originalSize) * 100)
      : 0
    return `### ${h.path} (${ratio}% compressed)\n\`\`\`\n${h.compressed}\n\`\`\``
  })

  return `## Relevant codebase context (retrieved via TF-IDF)\n\n${blocks.join('\n\n')}`
}
