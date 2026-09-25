const TTL = 60 * 60 * 1000
const MAX_ENTRIES = 5000

// A Map in insertion order as a bounded LRU: reads re-insert, writes evict the oldest. Keys come
// from requests, so it must not grow without bound.
const store = new Map<string, { data: any; expires: number }>()

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    store.delete(key)
    return null
  }
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
