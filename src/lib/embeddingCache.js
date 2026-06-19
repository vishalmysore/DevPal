/**
 * Persistent cache for code embeddings (IndexedDB).
 *
 * Embedding vectors are expensive to compute but deterministic for a given
 * (model, text) pair, so we cache them keyed by a content hash. Re-cloning the
 * same repo — or re-indexing unchanged files after a patch — then reuses the
 * stored vectors instead of re-running the embedding model. Float32Array values
 * survive IndexedDB's structured clone, so we store them directly.
 */

const DB_NAME = 'devpal-rag'
const STORE   = 'embeddings'
let _dbPromise = null

function openDB() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
  return _dbPromise
}

/** FNV-1a 32-bit hash → hex string. Cheap, stable, good enough for cache keys. */
export function hashKey(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/** Bulk fetch cached vectors. Returns Map<key, Float32Array> (misses omitted). */
export async function getCachedVectors(keys) {
  const out = new Map()
  if (keys.length === 0) return out
  let db
  try { db = await openDB() } catch { return out }

  return new Promise((resolve) => {
    const tx    = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    let pending = keys.length
    const done  = () => { if (--pending === 0) resolve(out) }
    for (const k of keys) {
      const r = store.get(k)
      r.onsuccess = () => { if (r.result) out.set(k, r.result); done() }
      r.onerror   = done
    }
  })
}

/** Bulk store vectors. `entries` is an iterable of [key, Float32Array]. */
export async function putCachedVectors(entries) {
  let db
  try { db = await openDB() } catch { return }

  return new Promise((resolve) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const [k, v] of entries) store.put(v, k)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => resolve()
  })
}
