/**
 * Embedding worker — runs a small sentence-embedding model (all-MiniLM-L6-v2,
 * 384-dim) entirely in the browser via transformers.js. Kept separate from the
 * WebLLM inference worker so embedding the codebase never contends with token
 * generation. Prefers WebGPU and falls back to WASM; model weights are cached
 * by the browser's Cache API after the first download.
 *
 * Protocol: { id, action: 'embed', texts: string[] }
 *        → { id, status: 'embedded', vectors: Float32Array[], dim }
 *        → { id, status: 'error', error }
 * Plus unsolicited { status: 'model-progress', info } during first-time load.
 */
import { pipeline, env } from '@huggingface/transformers'

// Always fetch from the HF hub (no bundled local models); cache handles repeats.
env.allowLocalModels = false

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

let extractor = null
let loading   = null

async function getExtractor() {
  if (extractor) return extractor
  if (!loading) {
    const onProgress = (info) => self.postMessage({ status: 'model-progress', info })
    loading = pipeline('feature-extraction', MODEL_ID, {
      device: 'webgpu',
      dtype:  'q8',
      progress_callback: onProgress,
    }).catch(() =>
      // WebGPU unavailable or model variant missing → CPU/WASM fallback.
      pipeline('feature-extraction', MODEL_ID, { progress_callback: onProgress })
    )
  }
  extractor = await loading
  return extractor
}

self.onmessage = async (e) => {
  const { id, action, texts } = e.data
  if (action !== 'embed') return

  try {
    const ex  = await getExtractor()
    const out = await ex(texts, { pooling: 'mean', normalize: true })
    const dim = out.dims[out.dims.length - 1]
    const n   = out.dims[0]

    // out.data is a flat Float32Array [n * dim]; split into per-text vectors.
    const vectors = []
    for (let i = 0; i < n; i++) {
      vectors.push(out.data.slice(i * dim, (i + 1) * dim))
    }
    self.postMessage({ id, status: 'embedded', vectors, dim })
  } catch (err) {
    self.postMessage({ id, status: 'error', error: err?.message ?? String(err) })
  }
}
