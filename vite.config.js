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
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
