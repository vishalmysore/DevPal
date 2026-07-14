/**
 * .gitignore-aware filtering for indexing — repomix's Git-aware behaviour, done
 * browser-side with the pure-JS `ignore` package. We seed a default deny-list of
 * dependency/build/binary noise (so a repo with no .gitignore still indexes
 * cleanly) and layer the repo's own .gitignore on top.
 */
import ignore from 'ignore'

// Noise that should never be indexed even without a .gitignore.
const DEFAULT_IGNORES = [
  'node_modules/', '.git/', 'dist/', 'build/', 'out/', '.next/', '.nuxt/',
  'coverage/', '.cache/', 'vendor/', 'target/', '__pycache__/',
  '*.min.js', '*.min.css', '*.map',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', '*.lock',
  // Binary / non-text assets
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.svg', '*.ico', '*.webp', '*.bmp',
  '*.pdf', '*.zip', '*.gz', '*.tar', '*.7z', '*.rar',
  '*.woff', '*.woff2', '*.ttf', '*.eot', '*.otf',
  '*.mp4', '*.mov', '*.mp3', '*.wav', '*.ogg',
  '*.wasm', '*.exe', '*.dll', '*.so', '*.dylib', '*.bin', '*.class',
]

/**
 * Build a path filter from optional .gitignore text. Returns an object with
 * `ignores(path)` — true when the path should be skipped.
 */
export function buildIgnore(gitignoreText = '') {
  const ig = ignore().add(DEFAULT_IGNORES)
  if (gitignoreText) ig.add(gitignoreText)
  return {
    ignores(path) {
      // `ignore` wants repo-relative POSIX paths with no leading slash.
      const rel = String(path).replace(/^\.?\//, '')
      if (!rel) return false
      try { return ig.ignores(rel) } catch { return false }
    },
  }
}
