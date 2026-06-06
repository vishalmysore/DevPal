import { CreateMLCEngine } from '@mlc-ai/web-llm'

let engine         = null
let currentModelId = null
let loadAborted    = false
let currentGen     = -1

function post(msg) {
  self.postMessage({ gen: currentGen, ...msg })
}

async function disposeCurrent() {
  if (engine) {
    try { await engine.unload() } catch (_) {}
    engine         = null
    currentModelId = null
  }
}

self.onmessage = async (e) => {
  const { action, modelId, messages, gen } = e.data

  // ── Load ────────────────────────────────────────────────────────
  if (action === 'load') {
    loadAborted = false
    currentGen  = gen ?? 0

    await disposeCurrent()

    if (!modelId) {
      post({ status: 'error', error: 'No model ID provided.' })
      return
    }

    try {
      const adapter = await navigator.gpu?.requestAdapter()
      if (!adapter) {
        post({ status: 'error', error: 'WebGPU not available. Use Chrome 113+ on a machine with a GPU.' })
        return
      }
      post({ status: 'device_detected', device: 'webgpu' })
    } catch (err) {
      post({ status: 'error', error: `WebGPU check failed: ${err?.message ?? err}` })
      return
    }

    post({ status: 'phase', phase: 'download' })

    try {
      engine = await CreateMLCEngine(modelId, {
        initProgressCallback: (progress) => {
          if (loadAborted) return
          const text = progress.text ?? ''
          const pct  = Math.round((progress.progress ?? 0) * 100)

          if (text.toLowerCase().includes('fetch') || text.toLowerCase().includes('loading')) {
            post({ status: 'downloading', file: text, progress: pct })
          } else if (text.toLowerCase().includes('compil') || pct > 50) {
            post({ status: 'phase', phase: 'compile',
              note: `${text} — shader compilation (~1–5 min on first load, cached after).` })
          }
        },
      })

      if (loadAborted) { await disposeCurrent(); return }

      currentModelId = modelId
      post({ status: 'ready', modelId })

    } catch (err) {
      if (loadAborted) return
      post({ status: 'error', error: err?.message ?? String(err) })
    }

  // ── Generate ────────────────────────────────────────────────────
  } else if (action === 'generate') {
    if (!engine) {
      post({ status: 'error', error: 'No model loaded.' })
      return
    }
    try {
      const t0     = performance.now()
      const chunks = await engine.chat.completions.create({
        messages,
        stream:      true,
        temperature: 0.1,
        max_tokens:  4096,
      })

      let fullText = ''
      for await (const chunk of chunks) {
        if (loadAborted) break
        const delta = chunk.choices[0]?.delta?.content ?? ''
        if (delta) {
          fullText += delta
          post({ status: 'token', delta })
        }
      }

      const elapsed = performance.now() - t0
      post({
        status:        'success',
        generatedText: fullText,
        elapsedMs:     elapsed,
        tokensPerSec:  fullText.trim().split(/\s+/).length / (elapsed / 1000),
        modelId:       currentModelId,
      })
    } catch (err) {
      post({ status: 'error', error: err?.message ?? String(err) })
    }

  // ── Cancel / Dispose ────────────────────────────────────────────
  } else if (action === 'cancel') {
    loadAborted = true
    await disposeCurrent()
    self.postMessage({ status: 'cancelled' })

  } else if (action === 'dispose') {
    loadAborted = true
    await disposeCurrent()
    self.postMessage({ status: 'disposed' })
  }
}
