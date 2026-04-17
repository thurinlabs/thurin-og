const TTL = 60 * 60 * 1000 // 1 hour

const store = new Map<string, { data: any; expires: number }>()

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    store.delete(key)
    return null
  }
  return entry.data as T
}

export function cacheSet(key: string, data: any): void {
  store.set(key, { data, expires: Date.now() + TTL })
}
