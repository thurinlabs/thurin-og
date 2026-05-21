import type { ResolvedIdentity } from './resolve'

const THURIN_BASE = 'https://thurin.id'

export function renderOgHtml(identity: ResolvedIdentity, path: string): string {
  const title = identity.ensName
    ? `${identity.ensName} — Thurin`
    : identity.address
      ? `${identity.address.slice(0, 8)}...${identity.address.slice(-4)} — Thurin`
      : identity.fingerprint
        ? `${identity.fingerprint.slice(0, 8)}... — Thurin`
        : 'Thurin — Identity Explorer'

  const parts: string[] = []
  if (identity.activeClaims > 0) parts.push(`${identity.activeClaims} seal${identity.activeClaims !== 1 ? 's' : ''}`)
  if (identity.proofs.length > 0) parts.push(`${identity.proofs.length} proof${identity.proofs.length !== 1 ? 's' : ''}`)
  if (identity.efp?.followers) parts.push(`${identity.efp.followers} followers`)
  const description = parts.length > 0
    ? parts.join(' · ')
    : 'Look up any Ethereum identity on Thurin'

  const canonicalUrl = `${THURIN_BASE}${path}`
  const imageUrl = `${THURIN_BASE}/og${path}.png`

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
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:type" content="profile" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${imageUrl}" />
${relMeLinks}
</head>
<body>
  <script>window.location.href = "${canonicalUrl}";</script>
  <noscript><a href="${canonicalUrl}">View on Thurin</a></noscript>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
