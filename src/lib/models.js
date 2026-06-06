export const MODELS = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    label: 'Llama 3.2 1B — Fastest',
    size: '~0.9 GB',
    description: 'Best for quick edits on low-VRAM devices',
  },
  {
    id: 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC',
    label: 'Qwen Coder 1.5B — Fast',
    size: '~1 GB',
    description: 'Code-specialized, fast load (recommended)',
  },
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    label: 'Gemma 2 2B — Balanced',
    size: '~1.5 GB',
    description: 'Google model, strong general instruction following',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B — Good',
    size: '~2 GB',
    description: 'Solid quality step up from 1B',
  },
  {
    id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    label: 'Phi-3.5 Mini — Best quality',
    size: '~2.2 GB',
    description: 'Microsoft model, highest reasoning quality',
  },
  {
    id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
    label: 'Qwen Coder 7B — Max quality',
    size: '~4.5 GB',
    description: 'Best code edits, needs 6GB+ VRAM',
  },
]
