import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import type { ResolvedIdentity } from './resolve'
import { fetchImageAsDataUri } from './safe'

const C = {
  bg: '#1a1a12',
  surface: '#252518',
  surfaceDeep: '#151510',
  border: '#3a3a2a',
  text: '#faf9f5',
  muted: '#a8a598',
  heading: '#7c9a3e',
  primary: '#7c9a3e',
  secondary: '#c9a227',
  success: '#7c9a3e',
}

let fontRegular: ArrayBuffer | null = null
let fontBold: ArrayBuffer | null = null

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
  return [
    { name: 'Inter', data: fontRegular, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: fontBold, weight: 700 as const, style: 'normal' as const },
  ]
}

function Badge({ label, verified }: { label: string; verified: boolean }) {
  return (
    <div style={{
      display: 'flex',
      fontSize: 22,
      padding: '10px 22px',
      borderRadius: 6,
      border: `1.5px solid ${verified ? C.success : C.border}`,
      color: verified ? C.success : C.muted,
    }}>
      {label}
    </div>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '28px 52px',
      backgroundColor: C.surfaceDeep,
      borderRadius: 8,
      minWidth: 170,
    }}>
      <span style={{ fontSize: 56, fontWeight: 700, color: C.heading }}>{value}</span>
      <span style={{ fontSize: 16, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
    </div>
  )
}

function StatInline({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
      <span style={{ fontSize: 30, fontWeight: 700, color: C.heading }}>{value}</span>
      <span style={{ fontSize: 13, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</span>
    </div>
  )
}

function Thumbprint({ size, opacity = 1 }: { size: number; opacity?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ opacity }}>
      <path d="M25 80 Q25 25 50 25 Q75 25 75 50" fill="none" stroke={C.primary} stroke-width="5" stroke-linecap="round"/>
      <path d="M33 75 Q33 35 50 35 Q67 35 67 52" fill="none" stroke={C.primary} stroke-width="5" stroke-linecap="round"/>
      <path d="M41 70 Q41 45 50 45 Q59 45 59 55" fill="none" stroke={C.secondary} stroke-width="5" stroke-linecap="round"/>
      <path d="M50 65 L50 53" fill="none" stroke={C.secondary} stroke-width="5" stroke-linecap="round"/>
    </svg>
  )
}

// Compact card sized for inline embeds (GitHub READMEs, Farcaster, etc.)
export async function renderCardImage(identity: ResolvedIdentity): Promise<Buffer> {
  const name = identity.ensName || identity.address || identity.fingerprint || 'Unknown'
  const subtitle = identity.ensName && identity.address
    ? `${identity.address.slice(0, 6)}…${identity.address.slice(-4)}`
    : identity.fingerprint && !identity.ensName
      ? `${identity.fingerprint.slice(0, 4)} … ${identity.fingerprint.slice(-4)}`
      : ''

  const attestations = identity.activeClaims
  const proofCount = identity.proofs.length
  const followers = identity.efp?.followers ?? 0

  let avatarUri: string | null = null
  if (identity.ensAvatar) avatarUri = await fetchImageAsDataUri(identity.ensAvatar)

  const fonts = await getFonts()
  const W = 640, H = 200

  const svg = await satori(
    <div style={{
      display: 'flex',
      width: W,
      height: H,
      backgroundColor: C.bg,
      border: `2px solid ${C.border}`,
      padding: '26px 30px',
      alignItems: 'center',
    }}>
      {avatarUri ? (
        <img src={avatarUri} width={104} height={104} style={{ borderRadius: 52, border: `3px solid ${C.border}`, marginRight: 26 }} />
      ) : (
        <div style={{
          display: 'flex', width: 104, height: 104, borderRadius: 52,
          backgroundColor: C.surfaceDeep, border: `3px solid ${C.border}`,
          alignItems: 'center', justifyContent: 'center', marginRight: 26,
        }}>
          <Thumbprint size={76} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden', height: '100%', justifyContent: 'center' }}>
        <span style={{ fontSize: identity.ensName ? 38 : 22, fontWeight: 700, color: C.heading }}>{name}</span>
        {subtitle ? <span style={{ fontSize: 18, color: C.muted, marginTop: 2 }}>{subtitle}</span> : null}
        <div style={{ display: 'flex', marginTop: 18, gap: 10, alignItems: 'baseline' }}>
          <StatInline value={attestations} label="Attestations" />
          <span style={{ color: C.border, fontSize: 22 }}>·</span>
          <StatInline value={proofCount} label="Proofs" />
          <span style={{ color: C.border, fontSize: 22 }}>·</span>
          <StatInline value={followers} label="Followers" />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginLeft: 18 }}>
        <Thumbprint size={60} opacity={0.7} />
        <span style={{ fontSize: 16, color: C.muted, marginTop: 6 }}>thurin.id</span>
      </div>
    </div>,
    { width: W, height: H, fonts },
  )

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: W } })
  return Buffer.from(resvg.render().asPng())
}

// Generic site card for non-identity pages (/, /attest, unmatched paths)
export async function renderSiteImage(): Promise<Buffer> {
  const fonts = await getFonts()

  const svg = await satori(
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: 1200,
      height: 630,
      backgroundColor: C.bg,
      border: `2px solid ${C.border}`,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
    }}>
      <Thumbprint size={220} opacity={0.8} />
      <span style={{ fontSize: 64, fontWeight: 700, color: C.heading }}>Thurin</span>
      <span style={{ fontSize: 32, color: C.muted }}>Identity Explorer</span>
      <span style={{ fontSize: 26, color: C.secondary, fontStyle: 'italic', marginTop: 16 }}>Prove more. Reveal less.</span>
      <span style={{ fontSize: 24, color: C.muted }}>thurin.id</span>
    </div>,
    { width: 1200, height: 630, fonts },
  )

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } })
  return Buffer.from(resvg.render().asPng())
}

export async function renderOgImage(identity: ResolvedIdentity): Promise<Buffer> {
  const name = identity.ensName || identity.address || identity.fingerprint || 'Unknown'

  const subtitle = (identity.ensName && identity.address) ? identity.address : ''
  const proofCount = identity.proofs.length
  const followers = identity.efp?.followers ?? 0
  const hasVerifiedPgp = identity.activeClaims > 0

  // Fetch avatar
  let avatarUri: string | null = null
  if (identity.ensAvatar) {
    avatarUri = await fetchImageAsDataUri(identity.ensAvatar)
  }

  const fonts = await getFonts()

  const displayName = name
  const displayAddr = subtitle

  const svg = await satori(
    <div style={{
      display: 'flex',
      width: 1200,
      height: 630,
      backgroundColor: C.bg,
      border: `2px solid ${C.border}`,
    }}>
      {/* Left content area */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        padding: '72px 48px 44px 64px',
      }}>
        {/* Header: avatar + name */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 56 }}>
          {avatarUri ? (
            <img
              src={avatarUri}
              width={96}
              height={96}
              style={{ borderRadius: 48, border: `3px solid ${C.border}`, marginRight: 24 }}
            />
          ) : (
            <div style={{
              display: 'flex',
              width: 96,
              height: 96,
              borderRadius: 48,
              backgroundColor: C.surfaceDeep,
              border: `3px solid ${C.border}`,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 24,
            }}>
              <svg viewBox="0 0 100 100" width="72" height="72">
                <path d="M25 80 Q25 25 50 25 Q75 25 75 50" fill="none" stroke={C.primary} stroke-width="5" stroke-linecap="round"/>
                <path d="M33 75 Q33 35 50 35 Q67 35 67 52" fill="none" stroke={C.primary} stroke-width="5" stroke-linecap="round"/>
                <path d="M41 70 Q41 45 50 45 Q59 45 59 55" fill="none" stroke={C.secondary} stroke-width="5" stroke-linecap="round"/>
                <path d="M50 65 L50 53" fill="none" stroke={C.secondary} stroke-width="5" stroke-linecap="round"/>
              </svg>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: identity.ensName ? 56 : 32, fontWeight: 700, color: C.heading }}>{displayName}</span>
            <span style={{ fontSize: 22, color: C.muted }}>{displayAddr}</span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 48, justifyContent: 'center' }}>
          <Stat value={identity.activeClaims} label="Attestations" />
          <Stat value={proofCount} label="Proofs" />
          <Stat value={followers} label="Followers" />
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', maxWidth: 700, justifyContent: 'center' }}>
          {hasVerifiedPgp && <Badge label="PGP Verified" verified={true} />}
          {identity.efp?.hasEfp && <Badge label="EFP" verified={true} />}
          {identity.proofs.slice(0, 8).map((p, i) => (
            <Badge key={i} label={p.label.slice(0, 32)} verified={true} />
          ))}
        </div>

      </div>

      {/* Right side: Thurin thumbprint + footer */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: 380,
        gap: 16,
      }}>
        <svg viewBox="0 0 100 100" width="340" height="340" style={{ opacity: 0.6 }}>
          <path d="M25 80 Q25 25 50 25 Q75 25 75 50" fill="none" stroke={C.primary} stroke-width="3" stroke-linecap="round"/>
          <path d="M33 75 Q33 35 50 35 Q67 35 67 52" fill="none" stroke={C.primary} stroke-width="3" stroke-linecap="round"/>
          <path d="M41 70 Q41 45 50 45 Q59 45 59 55" fill="none" stroke={C.secondary} stroke-width="3" stroke-linecap="round"/>
          <path d="M50 65 L50 53" fill="none" stroke={C.secondary} stroke-width="3" stroke-linecap="round"/>
        </svg>
        <span style={{ fontSize: 24, color: C.secondary, fontStyle: 'italic' }}>Prove more. Reveal less.</span>
        <span style={{ fontSize: 26, color: C.muted }}>thurin.id</span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts,
    },
  )

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } })
  return Buffer.from(resvg.render().asPng())
}
