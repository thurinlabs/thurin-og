import type { ResolvedIdentity } from './resolve'

const THURIN_BASE = 'https://thurin.id'

export function renderOgHtml(identity: ResolvedIdentity, path: string, imagePath: string = path): string {
  const title = identity.ensName
    ? `${identity.ensName} — Thurin.id`
    : identity.address
      ? `${identity.address.slice(0, 8)}...${identity.address.slice(-4)} — Thurin.id`
      : identity.fingerprint
        ? `${identity.fingerprint.slice(0, 8)}... — Thurin.id`
        : 'Thurin.id — Identity Explorer'

  const parts: string[] = []
  if (identity.activeClaims > 0) parts.push(`${identity.activeClaims} attestation${identity.activeClaims !== 1 ? 's' : ''}`)
  if (identity.proofs.length > 0) parts.push(`${identity.proofs.length} proof${identity.proofs.length !== 1 ? 's' : ''}`)
  if (identity.efp?.followers) parts.push(`${identity.efp.followers} followers`)
  const description = parts.length > 0
    ? parts.join(' · ')
    : 'Look up any Ethereum identity on Thurin'

  const canonicalUrl = `${THURIN_BASE}${path}`
  const imageUrl = `${THURIN_BASE}/og${imagePath}.png`   // the card is keyed by the base path; a tab URL shares it

  const relMeLinks = identity.mastodonUrls
    .map((url) => `  <link rel="me" href="${escapeHtml(url)}" />`)
    .join('\n')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="profile" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
${relMeLinks}
</head>
<body>
  <script>window.location.href = ${escapeJsString(canonicalUrl)};</script>
  <noscript><a href="${escapeHtml(canonicalUrl)}">View on Thurin</a></noscript>
</body>
</html>`
}

// Generic site card for non-identity pages: /, /attest, and any unmatched path.
export function renderSiteOgHtml(path: string): string {
  const normalized = path.replace(/\/+$/, '') || '/'
  const title = normalized === '/attest'
    ? 'Thurin.id — Attest'
    : 'Thurin.id — Identity Explorer'
  const description =
    'Explore and verify the Thurin identity graph. Look up Ethereum addresses, ENS names, and PGP fingerprints.'

  const canonicalUrl = `${THURIN_BASE}${path === '/' ? '/' : path}`
  const imageUrl = `${THURIN_BASE}/og/site.png`

  // Redirecting / to itself would loop if a browser ever hit this route directly.
  const redirect = normalized === '/'
    ? ''
    : `  <script>window.location.href = ${escapeJsString(canonicalUrl)};</script>\n`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
</head>
<body>
${redirect}  <noscript><a href="${escapeHtml(canonicalUrl)}">View on Thurin</a></noscript>
</body>
</html>`
}

function escapeJsString(str: string): string {
  return JSON.stringify(str).replace(/</g, '\\u003c')
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
