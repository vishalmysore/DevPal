/**
 * Accurate token counting via gpt-tokenizer's main entry (cl100k_base BPE — a
 * far better cost proxy than 4-chars/token, and the encoding Vite resolves
 * cleanly). Pure JS, no Node deps, so it runs in the browser. The BPE ranks are
 * ~1–2 MB, so we lazy-load them once and inject the counter into codeRag; until
 * then everything falls back to the heuristic. Idempotent and failure-tolerant
 * — a load error just keeps the heuristic.
 */
import { setTokenCounter } from './codeRag.js'

let _started = false

export async function initTokenizer() {
  if (_started) return
  _started = true
  try {
    const { countTokens } = await import('gpt-tokenizer')
    setTokenCounter(text => countTokens(text))
  } catch {
    // Keep the heuristic — accuracy is a nice-to-have, not required.
    _started = false
  }
}
