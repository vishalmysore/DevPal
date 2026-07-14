/**
 * Code RAG — indexes cloned repo files using code-aware compression, then
 * retrieves relevant chunks via hybrid scoring: lexical TF-IDF blended with
 * semantic cosine similarity over sentence embeddings. TF-IDF catches exact
 * term overlap; embeddings catch conceptually-related code that shares no
 * literal tokens. Embeddings are optional — if no embedder is wired up (or it
 * hasn't finished yet) retrieval gracefully degrades to pure TF-IDF.
 */
import { compressCode, isCodeFile, detectContentType } from './codeCompressor.js'
import { hashKey, getCachedVectors, putCachedVectors } from './embeddingCache.js'

// Namespaces cache keys so swapping the embedding model invalidates old vectors.
const EMBED_TAG = 'minilm-l6-v2'
// Embedding models truncate long inputs anyway; bound the text we send them.
const EMBED_MAX_CHARS = 1600

// Injected by the app: (texts: string[]) => Promise<Float32Array[]>
let _embedder = null
export function setEmbedder(fn) { _embedder = fn }
export function hasEmbedder() { return !!_embedder }

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

// In-memory index. Each entry:
//   { path, compressed, tokens, originalSize, compressedSize,
//     embedText, embedKey, embedding: Float32Array | null }
let _index = []

export function clearIndex() {
  _index = []
}

export function getIndexStats() {
  return {
    files: _index.length,
    totalOriginal: _index.reduce((s, e) => s + e.originalSize, 0),
    totalCompressed: _index.reduce((s, e) => s + e.compressedSize, 0),
    embedded: _index.filter(e => e.embedding).length,
  }
}

// Read-only view of the indexed entries, for context strategies that operate
// over the whole repo (e.g. the repo-map skeleton) rather than a retrieval.
export function getEntries() { return _index }

// Token counting. Defaults to a ~4-chars/token heuristic, but the app injects
// a real tokenizer (gpt-tokenizer, o200k_base) once it lazy-loads, so the
// savings readout becomes exact. Injection is optional and browser-only.
let _tokenCounter = null
export function setTokenCounter(fn) { _tokenCounter = fn }
export function hasTokenCounter() { return !!_tokenCounter }

export function estimateTokens(text) {
  if (_tokenCounter) {
    try { return _tokenCounter(text ?? '') } catch { /* fall through to heuristic */ }
  }
  return Math.ceil((text?.length ?? 0) / 4)
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
  const raw = type === 'code' ? compressCode(content) : chunkText(content)
  const compressed = typeof raw === 'string' ? raw : raw.join('\n\n')

  // Embed the file path alongside its compressed body so directory/name
  // semantics ("auth", "worker", "test") inform the vector too.
  const embedText = `${path}\n${compressed}`.slice(0, EMBED_MAX_CHARS)
  const embedKey  = `${EMBED_TAG}:${hashKey(embedText)}`

  const entry = {
    path,
    content,               // raw source — used by the tree-sitter strategy for AST parsing
    compressed,
    tokens: tokenize(compressed ?? content),
    originalSize: content.length,
    compressedSize: (compressed ?? content).length,
    embedText,
    embedKey,
    embedding: null,
  }

  // Replace any prior entry for this path (e.g. re-index after applying a patch)
  // so the index never holds a stale copy of a file.
  const existing = _index.findIndex(e => e.path === path)
  if (existing !== -1) _index[existing] = entry
  else _index.push(entry)
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
 * Compute embeddings for every indexed entry that lacks one, reusing the
 * IndexedDB cache for vectors we've seen before and only calling the embedder
 * for genuine misses. Safe to call repeatedly (e.g. after re-indexing a patched
 * file) — already-embedded entries are skipped. No-op without an embedder.
 *
 * @param {(done:number,total:number)=>void} [onProgress]
 */
export async function embedIndex(onProgress) {
  if (!_embedder) return
  const pending = _index.filter(e => !e.embedding)
  if (pending.length === 0) return

  const total = pending.length
  let done = 0

  // 1. Fill from cache.
  const cached = await getCachedVectors(pending.map(e => e.embedKey))
  const misses = []
  for (const e of pending) {
    const v = cached.get(e.embedKey)
    if (v) { e.embedding = v; done++ }
    else misses.push(e)
  }
  onProgress?.(done, total)

  // 2. Embed the rest in batches, persisting new vectors as we go.
  const BATCH = 16
  for (let i = 0; i < misses.length; i += BATCH) {
    const batch = misses.slice(i, i + BATCH)
    let vectors
    try {
      vectors = await _embedder(batch.map(e => e.embedText))
    } catch {
      // Embedder failed (e.g. WebGPU lost) — stop; TF-IDF still works.
      return
    }
    const toCache = []
    batch.forEach((e, j) => {
      const v = vectors[j]
      if (v) { e.embedding = v; toCache.push([e.embedKey, v]); done++ }
    })
    if (toCache.length) putCachedVectors(toCache)
    onProgress?.(done, total)
  }
}

function dotProduct(a, b) {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

// TF-IDF scores for each entry, normalized to [0,1] by the max. Map<idx, score>.
function tfidfScores(query) {
  const out = new Map()
  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return out

  const N = _index.length
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

  let max = 0
  const raw = _index.map(entry => {
    const len = Math.max(entry.tokens.length, 1)
    let score = 0
    for (const qt of queryTerms) {
      const tf = entry.tokens.filter(w => w === qt).length / len
      score += tf * (idf[qt] ?? 1)
    }
    if (score > max) max = score
    return score
  })
  if (max > 0) raw.forEach((s, i) => { if (s > 0) out.set(i, s / max) })
  return out
}

/**
 * TF-IDF retrieval (synchronous): score each indexed entry against query terms,
 * return the top-K most relevant. Retained for callers that can't await.
 */
export function retrieveContext(query, topK = 4) {
  const scores = tfidfScores(query)
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([i, score]) => ({ ..._index[i], score }))
}

/**
 * Hybrid retrieval: blend normalized TF-IDF with semantic cosine similarity.
 * Falls back to pure TF-IDF when embeddings aren't available. Returns the
 * top-K entries with a `score` field.
 */
export async function retrieveContextHybrid(query, topK = 4, { alpha = 0.6 } = {}) {
  if (_index.length === 0) return []

  const lexical = tfidfScores(query)

  // Semantic component — only if we have an embedder and embedded entries.
  let semantic = null
  if (_embedder && _index.some(e => e.embedding)) {
    try {
      const [qVec] = await _embedder([query])
      if (qVec) {
        semantic = new Map()
        _index.forEach((e, i) => {
          if (e.embedding) {
            // Vectors are L2-normalized, so dot product == cosine in [-1,1].
            semantic.set(i, Math.max(0, dotProduct(qVec, e.embedding)))
          }
        })
      }
    } catch {
      semantic = null // fall back to lexical only
    }
  }

  if (!semantic) {
    return [...lexical.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([i, score]) => ({ ..._index[i], score }))
  }

  // Blend: alpha weights semantic, (1-alpha) weights lexical.
  const blended = new Map()
  for (let i = 0; i < _index.length; i++) {
    const sem = semantic.get(i) ?? 0
    const lex = lexical.get(i) ?? 0
    const score = alpha * sem + (1 - alpha) * lex
    if (score > 0) blended.set(i, score)
  }

  return [...blended.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([i, score]) => ({ ..._index[i], score }))
}

/**
 * Build the context block to inject into the LLM prompt (hybrid retrieval).
 */
export async function buildContextBlock(query, topK = 4) {
  const hits = await retrieveContextHybrid(query, topK)
  if (hits.length === 0) return ''

  const blocks = hits.map(h => {
    const ratio = h.originalSize > 0
      ? Math.round((1 - h.compressedSize / h.originalSize) * 100)
      : 0
    return `### ${h.path} (${ratio}% compressed)\n\`\`\`\n${h.compressed}\n\`\`\``
  })

  const method = _index.some(e => e.embedding) ? 'hybrid TF-IDF + semantic' : 'TF-IDF'
  return `## Relevant codebase context (retrieved via ${method})\n\n${blocks.join('\n\n')}`
}
