import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

// ─── Input validation ────────────────────────────────────────────────────────

export function isValidAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v)
}

export function isValidFingerprint(v: string): boolean {
  return /^[0-9A-Fa-f]{16}$/.test(v) || /^[0-9A-Fa-f]{40}$/.test(v)
}

export function isValidEnsName(v: string): boolean {
  if (v.length === 0 || v.length > 253) return false
  return /^[a-z0-9._-]+$/i.test(v) && v.includes('.')
}

// ─── SSRF-safe outbound image fetch ──────────────────────────────────────────

function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const p = ip.split('.').map(Number)
    if (p.some((n) => Number.isNaN(n))) return true
    const [a, b] = p
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  if (kind === 6) {
    const s = ip.toLowerCase()
    if (s === '::1' || s === '::') return true
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true
    const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return false
  }
  return true // not an IP literal
}

async function hostIsPublic(host: string): Promise<boolean> {
  if (isIP(host)) return !isPrivateAddress(host)
  try {
    const results = await lookup(host, { all: true })
    return results.length > 0 && results.every((r) => !isPrivateAddress(r.address))
  } catch {
    return false
  }
}

// Convert an ENS avatar record into a fetchable https URL, or null. Handles
// https, ipfs, and inline data image URIs; deliberately drops NFT (eip155:)
// records, which otherwise make the resolver fetch attacker-controlled token
// URIs with no content-type gate.
export function normalizeAvatarUrl(record: string | null | undefined): string | null {
  if (!record) return null
  if (record.startsWith('https://')) return record
  if (record.startsWith('ipfs://')) {
    return 'https://ipfs.io/ipfs/' + record.slice('ipfs://'.length).replace(/^ipfs\//, '')
  }
  if (record.startsWith('data:image/')) return record
  return null
}

const IMAGE_MAGIC: { type: string; bytes: number[] }[] = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
]

// Determine the image type from the leading bytes rather than trusting the
// remote Content-Type header (which can carry an SVG-injection payload that
// satori would serialize into the output image unescaped).
function sniffImageType(buf: Uint8Array): string | null {
  for (const { type, bytes } of IMAGE_MAGIC) {
    if (bytes.every((b, i) => buf[i] === b)) return type
  }
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024 // 2 MB
const FETCH_TIMEOUT_MS = 3000
const MAX_REDIRECTS = 4

// Fetch an image URL with SSRF, timeout, size, redirect, and content-type
// protections, returning a data URI whose type is sniffed (trusted) — or null.
export async function fetchImageAsDataUri(rawUrl: string): Promise<string | null> {
  if (rawUrl.startsWith('data:image/')) return rawUrl

  let url = rawUrl
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    let u: URL
    try { u = new URL(url) } catch { return null }
    if (u.protocol !== 'https:') return null
    if (!(await hostIsPublic(u.hostname))) return null

    let resp: Response
    try {
      resp = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    } catch {
      return null
    }

    // Follow redirects manually so every hop is re-validated against SSRF rules.
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location')
      if (!loc) return null
      url = new URL(loc, url).toString()
      continue
    }
    if (!resp.ok) return null

    const declared = resp.headers.get('content-length')
    if (declared && Number(declared) > MAX_AVATAR_BYTES) return null

    // Stream with a hard cap so a missing/lying Content-Length can't exhaust memory.
    const reader = resp.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_AVATAR_BYTES) { await reader.cancel(); return null }
      chunks.push(value)
    }
    const buf = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) { buf.set(c, offset); offset += c.byteLength }

    const type = sniffImageType(buf)
    if (!type) return null // not a recognized raster image — reject

    return `data:${type};base64,${Buffer.from(buf).toString('base64')}`
  }
  return null // too many redirects
}
