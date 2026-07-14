/**
 * Context strategies — pluggable ways to "crunch" the cloned repo into a
 * compact context block before it's fed to the model, trading fidelity for
 * tokens. Every strategy answers the same call and returns the same shape so
 * the app can swap them freely and show a consistent before/after savings
 * readout.
 *
 *   rag        — hybrid TF-IDF + semantic retrieval; only the top-K files
 *                relevant to the prompt, compressed. (task-scoped)
 *   repomap    — whole-repo signature skeleton: paths + top-level
 *                functions/classes/exports. (task-independent birds-eye view)
 *   treesitter — [Phase 2] AST-precise signatures via web-tree-sitter.
 *   summary    — [Phase 3] short natural-language summaries from the local
 *                model over the RAG-selected files.
 *
 * Baseline for "tokens saved" is always the whole indexed repo fed raw, so the
 * percentage answers the real question: "how much smaller than just dumping
 * the codebase at the agent?"
 */
import { getEntries, getIndexStats, estimateTokens, hasTokenCounter, buildContextBlock, retrieveContextHybrid } from './codeRag.js'
import { extractSignatures, extractHeadings } from './codeCompressor.js'
import { extractSignaturesAST, isTreeSitterSupported } from './treeSitter.js'
import { redactSecrets } from './secretScan.js'

// Registry. `needsModel` gates the option until a local model is loaded;
// `phase` marks strategies wired up in a later build increment.
export const STRATEGIES = {
  rag: {
    id: 'rag',
    label: '🎯 RAG (task-scoped)',
    description: 'Hybrid TF-IDF + semantic retrieval. Includes only the files most relevant to your prompt, compressed. Best default.',
    needsModel: false,
  },
  repomap: {
    id: 'repomap',
    label: '🗺 Repo map',
    description: 'Whole-repo signature skeleton — every file\'s path plus its top-level functions, classes and exports (regex-extracted). A birds-eye map, independent of the prompt.',
    needsModel: false,
  },
  treesitter: {
    id: 'treesitter',
    label: '🌳 Tree-sitter map',
    description: 'Like the repo map, but signatures come from a real AST parse (tree-sitter) for 12 languages — accurate multi-line signatures, generics, decorators and class methods. Falls back to regex for other files.',
    needsModel: false,
  },
  summary: {
    id: 'summary',
    label: '📝 Model summary',
    description: 'Retrieves the files most relevant to your prompt, then has the loaded local model write a 2–3 sentence summary of each. The most compact — but spends local inferences (cached per file). Requires a loaded model.',
    needsModel: true,
  },
}

// Strategies currently offered in the picker, in display order.
export const AVAILABLE_STRATEGIES = ['rag', 'repomap', 'treesitter', 'summary']

const DOC_RE = /\.(md|markdown|mdx|txt|rst|adoc)$/i

function section(path, sigs) {
  return sigs.length
    ? `### ${path}\n${sigs.map(s => `- ${s}`).join('\n')}`
    : `### ${path}`
}

/**
 * Whole-repo signature skeleton via the regex extractor. For each indexed file,
 * emit its path and the top-level declarations pulled from its compressed body
 * (docs list their headings instead). Files with nothing extractable list just
 * the path, which still tells the model the file exists and where.
 */
function buildRepoMap() {
  const entries = getEntries()
  if (entries.length === 0) return ''
  const sections = entries.map(e =>
    section(e.path, DOC_RE.test(e.path) ? extractHeadings(e.compressed) : extractSignatures(e.compressed))
  )
  return `## Repo map — signature skeleton (${entries.length} files)\n\n${sections.join('\n\n')}`
}

/**
 * Whole-repo skeleton via tree-sitter: AST-accurate signatures for supported
 * languages, regex fallback for the rest (and headings for docs). Async because
 * grammars load on demand.
 */
async function buildTreeSitterMap() {
  const entries = getEntries()
  if (entries.length === 0) return ''
  let astFiles = 0
  const sections = await Promise.all(entries.map(async e => {
    if (DOC_RE.test(e.path)) return section(e.path, extractHeadings(e.compressed))
    if (isTreeSitterSupported(e.path) && e.content) {
      const sigs = await extractSignaturesAST(e.path, e.content)
      if (sigs) { astFiles++; return section(e.path, sigs) }
    }
    // Unsupported language or parse failure — fall back to the regex extractor.
    return section(e.path, extractSignatures(e.compressed))
  }))
  return `## Repo map — tree-sitter AST skeleton (${entries.length} files, ${astFiles} parsed)\n\n${sections.join('\n\n')}`
}

// Whole-repo strategies are task-independent, so cache their (potentially
// expensive) output and rebuild only when the index actually changes. The
// baseline token count is cached here too (summing the real tokenizer over
// every file is worth doing once, not per prompt).
let _cache = { key: null, repomap: null, treesitter: null, baseline: null }
function repoKey() {
  const s = getIndexStats()
  return `${s.files}:${s.totalOriginal}:${s.totalCompressed}:${hasTokenCounter() ? 'x' : 'h'}`
}

// Baseline = tokens if the whole indexed repo were pasted in raw.
function repoBaselineTokens() {
  if (_cache.baseline == null) {
    _cache.baseline = getEntries().reduce(
      (sum, e) => sum + estimateTokens(e.content ?? e.compressed ?? ''), 0)
  }
  return _cache.baseline
}

// Per-file summary cache, keyed by the content-stable embedKey so a file is
// only summarized once (until it's edited and re-indexed).
const _summaryCache = new Map()

/**
 * Summarize the top-K prompt-relevant files with the local model. Each file's
 * compressed body is summarized once and cached. Requires a `summarize`
 * function (main thread → inference worker); without it, falls back to RAG.
 */
async function buildSummaryContext(query, topK, summarize) {
  if (!summarize) return buildContextBlock(query, topK)
  const hits = await retrieveContextHybrid(query, topK)
  if (hits.length === 0) return ''

  const parts = []
  for (const h of hits) {
    let summary = _summaryCache.get(h.embedKey)
    if (!summary) {
      const prompt = `File: ${h.path}\n\n\`\`\`\n${h.compressed.slice(0, 1200)}\n\`\`\``
      try {
        summary = (await summarize(prompt)).trim()
      } catch {
        summary = '(summary unavailable)'
      }
      _summaryCache.set(h.embedKey, summary)
    }
    parts.push(`### ${h.path}\n${summary}`)
  }
  return `## Summarized context — ${hits.length} files (local model)\n\n${parts.join('\n\n')}`
}

/**
 * Build the context block for the given strategy.
 * @returns {Promise<{block:string, method:string, originalTokens:number,
 *   crunchedTokens:number, savedPct:number, exact:boolean, redacted:number}>}
 */
export async function buildContext(strategyId, query, opts = {}) {
  const topK = opts.topK ?? 4

  const key = repoKey()
  if (_cache.key !== key) _cache = { key, repomap: null, treesitter: null }

  let block
  let method
  switch (strategyId) {
    case 'repomap':
      block = _cache.repomap ??= buildRepoMap()
      method = 'repo-map skeleton'
      break
    case 'treesitter':
      block = _cache.treesitter ??= await buildTreeSitterMap()
      method = 'tree-sitter AST skeleton'
      break
    case 'summary':
      block = await buildSummaryContext(query, topK, opts.summarize)
      method = 'local-model summaries'
      break
    case 'rag':
    default:
      block = await buildContextBlock(query, topK)
      method = 'hybrid RAG'
      break
  }

  // Strip any secrets before the context leaves for the model.
  const { text: safeBlock, count: redacted } = redactSecrets(block)

  const originalTokens = repoBaselineTokens()
  const crunchedTokens = estimateTokens(safeBlock)
  const savedPct = originalTokens > 0
    ? Math.max(0, Math.round((1 - crunchedTokens / originalTokens) * 100))
    : 0

  return {
    block: safeBlock, method, originalTokens, crunchedTokens, savedPct,
    exact: hasTokenCounter(), redacted,
  }
}
