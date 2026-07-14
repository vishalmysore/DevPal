import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  base: '/DevPal/',
  plugins: [react(), tailwindcss(), nodePolyfills({ include: ['buffer', 'process'] })],
  worker: {
    format: 'es',
    plugins: () => [nodePolyfills({ include: ['buffer', 'process'] })],
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm', '@huggingface/transformers'],
    // Pre-bundle the lazy-loaded tokenizer so its first use doesn't trigger a
    // dev-server reload.
    include: ['gpt-tokenizer'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
