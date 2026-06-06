# DevPal 🤖

**Privacy-first, zero-infrastructure AI coding agent that runs 100% in your browser.**

DevPal uses WebGPU for local LLM inference and a virtual file system over IndexedDB to let you clone repositories, prompt an AI agent to write code modifications, preview diffs, and export standard `.patch` files — without your code ever leaving your machine.

---

## Features

- **100% client-side** — no server, no API keys, no data leaves your browser
- **WebGPU inference** — runs quantized LLMs (Llama, Qwen Coder, Phi, Gemma) locally via [WebLLM](https://webllm.mlc.ai/)
- **Git workspace** — shallow-clones any public GitHub/GitLab repo via CORS proxy using [isomorphic-git](https://isomorphic-git.org/) + [LightningFS](https://github.com/isomorphic-git/lightning-fs)
- **Code RAG** — indexes the full codebase with a code-aware compressor (stubs function bodies, keeps signatures) then retrieves relevant context per-query via TF-IDF, injected into every prompt
- **SEARCH/REPLACE patches** — structured output format keeps model output precise and patchable
- **VSCode-style UI** — activity bar, file explorer, line-numbered viewer, split diff preview, DevPal Chat panel
- **Offline after first load** — model weights cached in the browser's Cache API

---

## Supported Models

| Model | Size | Notes |
|-------|------|-------|
| Llama 3.2 1B | ~0.9 GB | Fastest, low-VRAM devices |
| Qwen Coder 1.5B | ~1 GB | Code-specialized, recommended default |
| Gemma 2 2B | ~1.5 GB | Strong instruction following |
| Llama 3.2 3B | ~2 GB | Good quality step-up |
| Phi-3.5 Mini | ~2.2 GB | Highest reasoning quality |
| Qwen Coder 7B | ~4.5 GB | Best code edits, needs 6 GB+ VRAM |

---

## Getting Started

### Requirements
- Chrome 113+ or any Chromium-based browser with WebGPU support
- Node.js 18+ (for local dev)

### Run locally

```bash
git clone https://github.com/vishalmysore/DevPal.git
cd DevPal
npm install
npm run dev
```

Open `http://localhost:5182` in Chrome.

### Usage

1. **Load AI Engine** — select a model from the dropdown in the title bar and click "↓ Load Engine". Weights download once and are cached in the browser.
2. **Clone a repo** — paste any public GitHub URL and click Clone. DevPal builds a virtual file system and indexes all files for RAG.
3. **Open a file** — click any file in the Explorer sidebar to open it in the code viewer.
4. **Ask DevPal** — type your change request in the DevPal Chat panel and press Enter. The agent generates SEARCH/REPLACE blocks using your file content plus relevant codebase context.
5. **Review & apply** — inspect the diff, click **✓ Apply** to write it to the virtual FS, or **↓ .patch** to download a standard patch file.

---

## Architecture

```
[ Title Bar: Repo URL + Model Selector ]
        │
[ Activity Bar ] ── [ Explorer Sidebar ]
        │
[ File Viewer / Diff Viewer ] ── [ DevPal Chat ]
        │
[ Status Bar ]

Storage:   LightningFS → IndexedDB  (virtual git workspace)
Inference: WebLLM → WebGPU          (dedicated Web Worker)
RAG:       Code compressor + TF-IDF (in-memory index)
```

### Code RAG Pipeline

After cloning, every file is indexed:
- **Code files** (JS/TS/Python/Go/Rust/etc.) — compressed via a regex-based AST approximator that stubs function bodies and keeps signatures, imports, and class definitions (~40–70% token reduction)
- **Text/config files** — chunked as-is

On each chat message, TF-IDF scores all indexed chunks against the query and the top-4 results are injected into the system prompt. Total context is budget-capped to fit the model's context window (4 096 tokens), with the target file compressed first if needed.

---

## Tech Stack

| Layer | Library |
|-------|---------|
| UI framework | React 19 + Vite |
| Styling | Tailwind CSS v4 |
| Git | isomorphic-git + LightningFS |
| LLM inference | @mlc-ai/web-llm |
| Diff rendering | diff2html |
| Node polyfills | vite-plugin-node-polyfills |

---

## License

Apache 2.0 — see [LICENSE](./LICENSE)

The code-aware compressor is inspired by [headroom](https://github.com/chopratejas/headroom) (Apache-2.0).
