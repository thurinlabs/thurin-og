import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import type { ResolvedIdentity } from './resolve'
import { fetchImageAsDataUri } from './safe'

// The sites' two modes. A card is drawn in one; pages swap the image when the mode changes.
const DARK = {
  bg: '#1a1a12',
  surfaceDeep: '#151510',
  border: '#3a3a2a',
  text: '#faf9f5',
  muted: '#a8a598',
  heading: '#7c9a3e',
  primary: '#7c9a3e',
  secondary: '#c9a227',
  success: '#7c9a3e',
}
const LIGHT: Palette = {
  bg: '#faf9f5',
  surfaceDeep: '#e8e7e0',
  border: '#d0cfc4',
  text: '#2a2a22',
  muted: '#6b6960',
  heading: '#5a7228',
  primary: '#5a7228',
  secondary: '#a8861e',
  success: '#5a7228',
}
type Palette = typeof DARK
export type Theme = 'dark' | 'light'
const palette = (theme: Theme): Palette => (theme === 'light' ? LIGHT : DARK)

let fontRegular: ArrayBuffer | null = null
let fontBold: ArrayBuffer | null = null
let fontMono: ArrayBuffer | null = null

async function fetchFont(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!resp.ok) throw new Error(`Font fetch failed: ${resp.status}`)
  return resp.arrayBuffer()
}

async function getFonts() {
  // On failure fetchFont throws, leaving the cache null so the next request
  // retries — a bad CDN response is never cached for the process lifetime.
  if (!fontRegular) {
    fontRegular = await fetchFont('https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf')
  }
  if (!fontBold) {
    fontBold = await fetchFont('https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf')
  }
  if (!fontMono) {
    fontMono = await fetchFont('https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-400-normal.ttf')
  }
  return [
    { name: 'Inter', data: fontRegular, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: fontBold, weight: 700 as const, style: 'normal' as const },
    { name: 'Mono', data: fontMono, weight: 400 as const, style: 'normal' as const },
  ]
}

function Thumbprint({ size, opacity = 1, c }: { size: number; opacity?: number; c: Palette }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ opacity }}>
      <path d="M25 80 Q25 25 50 25 Q75 25 75 50" fill="none" stroke={c.primary} stroke-width="5" stroke-linecap="round"/>
      <path d="M33 75 Q33 35 50 35 Q67 35 67 52" fill="none" stroke={c.primary} stroke-width="5" stroke-linecap="round"/>
      <path d="M41 70 Q41 45 50 45 Q59 45 59 55" fill="none" stroke={c.secondary} stroke-width="5" stroke-linecap="round"/>
      <path d="M50 65 L50 53" fill="none" stroke={c.secondary} stroke-width="5" stroke-linecap="round"/>
    </svg>
  )
}

// The key, spaced the way gpg prints it: ten groups of four, a wider gap in the middle.
function spaced(fpr: string): string {
  const g = fpr.match(/.{1,4}/g) ?? []
  return g.length === 10 ? `${g.slice(0, 5).join(' ')}  ${g.slice(5).join(' ')}` : g.join(' ')
}

function monthYear(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** "verified on Ethereum · Ed25519 · since Sep 2026" with a check, or why a claim doesn't count with a cross. */
function statusLine(identity: ResolvedIdentity, c: Palette): { text: string; color: string; mark: 'check' | 'cross' | null } {
  const s = identity.status
  if (s.kind === 'verified') {
    const parts = ['verified on Ethereum']
    if (identity.pgpKeyInfo?.algorithm) parts.push(identity.pgpKeyInfo.algorithm)
    if (s.since) parts.push(`since ${monthYear(s.since)}`)
    return { text: parts.join(' · '), color: c.success, mark: 'check' }
  }
  return { text: s.label, color: c.secondary, mark: s.kind === 'not-counted' ? 'cross' : null }
}

// Drawn, not typed: the text fonts have no check or cross.
function Mark({ kind, size, color }: { kind: 'check' | 'cross'; size: number; color: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} style={{ marginRight: Math.round(size * 0.45) }}>
      {kind === 'check'
        ? <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke={color} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        : <path d="M4 4 L12 12 M12 4 L4 12" fill="none" stroke={color} stroke-width="2.2" stroke-linecap="round" />}
    </svg>
  )
}

function Avatar({ uri, size, c }: { uri: string | null; size: number; c: Palette }) {
  return uri ? (
    <img src={uri} width={size} height={size} style={{ borderRadius: size / 2, border: `2px solid ${c.border}` }} />
  ) : (
    <div style={{
      display: 'flex', width: size, height: size, borderRadius: size / 2,
      backgroundColor: c.surfaceDeep, border: `2px solid ${c.border}`, alignItems: 'center', justifyContent: 'center',
    }}>
      <Thumbprint size={Math.round(size * 0.72)} c={c} />
    </div>
  )
}

function Wordmark({ size, c }: { size: number; c: Palette }) {
  return (
    <div style={{ display: 'flex', fontSize: size, fontWeight: 700 }}>
      <span style={{ color: c.text }}>Thurin</span><span style={{ color: c.primary }}>.id</span>
    </div>
  )
}

/** Name, address, key, status: the same content at any size. */
function IdentityCard({ identity, avatarUri, scale, c, mark = true }: { identity: ResolvedIdentity; avatarUri: string | null; scale: number; c: Palette; mark?: boolean }) {
  const px = (n: number) => Math.round(n * scale)
  // The address in full, in the key's type: with a name it sits under it; without one it is the heading.
  const addr = identity.address ?? ''
  const status = statusLine(identity, c)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: px(26) }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Avatar uri={avatarUri} size={px(56)} c={c} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: px(16), marginRight: px(12) }}>
          {identity.ensName
            ? <span style={{ fontSize: px(26), fontWeight: 700, color: c.heading }}>{identity.ensName}</span>
            : null}
          {identity.ensName
            ? <span style={{ fontFamily: 'Mono', fontSize: px(13), color: c.muted, marginTop: px(3) }}>{addr}</span>
            : <span style={{ fontFamily: 'Mono', fontSize: px(15), color: c.heading }}>{addr || 'Unknown'}</span>}
        </div>
        {mark ? <Wordmark size={px(18)} c={c} /> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <span style={{ fontSize: px(13), color: c.muted, width: px(72), textTransform: 'uppercase', letterSpacing: 1 }}>PGP key</span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span style={{ fontFamily: 'Mono', fontSize: px(16), color: c.text, whiteSpace: 'pre' }}>{identity.fingerprint ? spaced(identity.fingerprint) : '—'}</span>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: px(6) }}>
            {status.mark ? <Mark kind={status.mark} size={px(15)} color={status.color} /> : null}
            <span style={{ fontSize: px(15), color: status.color }}>{status.text}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Compact card for READMEs and posts: 640×200, the same URLs as always.
export async function renderCardImage(identity: ResolvedIdentity, theme: Theme = 'dark'): Promise<Buffer> {
  const c = palette(theme)
  const avatarUri = identity.ensAvatar ? await fetchImageAsDataUri(identity.ensAvatar) : null
  const fonts = await getFonts()
  const W = 640, H = 200
  const svg = await satori(
    <div style={{ display: 'flex', width: W, height: H, backgroundColor: c.bg, border: `2px solid ${c.border}`, padding: '22px 26px' }}>
      <IdentityCard identity={identity} avatarUri={avatarUri} scale={1} c={c} />
    </div>,
    { width: W, height: H, fonts },
  )
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: W } })
  return Buffer.from(resvg.render().asPng())
}

// Generic site card for non-identity pages (/, /attest, unmatched paths)
export async function renderSiteImage(): Promise<Buffer> {
  const c = DARK
  const fonts = await getFonts()

  const svg = await satori(
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: 1200,
      height: 630,
      backgroundColor: c.bg,
      border: `2px solid ${c.border}`,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
    }}>
      <Thumbprint size={220} opacity={0.8} c={c} />
      <Wordmark size={64} c={c} />
      <span style={{ fontSize: 32, color: c.muted }}>PGP keys on Ethereum</span>
      <span style={{ fontSize: 26, color: c.secondary, fontStyle: 'italic', marginTop: 16 }}>Old trust – new ground</span>
      <span style={{ fontSize: 24, color: c.muted }}>thurin.id</span>
    </div>,
    { width: 1200, height: 630, fonts },
  )

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } })
  return Buffer.from(resvg.render().asPng())
}

// Link previews (1200×630): the card's content, larger, with the mark.
export async function renderOgImage(identity: ResolvedIdentity, theme: Theme = 'dark'): Promise<Buffer> {
  const c = palette(theme)
  const avatarUri = identity.ensAvatar ? await fetchImageAsDataUri(identity.ensAvatar) : null
  const fonts = await getFonts()
  const svg = await satori(
    <div style={{ display: 'flex', width: 1200, height: 630, backgroundColor: c.bg, border: `2px solid ${c.border}` }}>
      <div style={{ display: 'flex', flex: 1, padding: '60px 32px 60px 64px' }}>
        <IdentityCard identity={identity} avatarUri={avatarUri} scale={1.45} c={c} mark={false} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 300, gap: 16 }}>
        <Wordmark size={40} c={c} />
        <Thumbprint size={200} opacity={0.6} c={c} />
        <span style={{ fontSize: 22, color: c.secondary, fontStyle: 'italic' }}>Old trust – new ground</span>
      </div>
    </div>,
    { width: 1200, height: 630, fonts },
  )
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } })
  return Buffer.from(resvg.render().asPng())
}
