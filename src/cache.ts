const TTL = 60 * 60 * 1000 // 1 hour
const MAX_ENTRIES = 5000

// Insertion-ordered Map used as a bounded LRU: reading refreshes recency by
// re-inserting, and writes evict the oldest entries once over capacity. Keys
// are attacker-influenced (address / fingerprint / ENS name), so the cache must
// not be allowed to grow without bound.
const store = new Map<string, { data: any; expires: number }>()

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    store.delete(key)
    return null
  }
  // Refresh recency.
  store.delete(key)
  store.set(key, entry)
  return entry.data as T
}

export function cacheSet(key: string, data: any): void {
  store.delete(key)
  store.set(key, { data, expires: Date.now() + TTL })
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}
