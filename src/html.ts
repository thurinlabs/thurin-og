import type { ResolvedIdentity } from './resolve'

const THURIN_BASE = 'https://thurin.id'

export function renderOgHtml(identity: ResolvedIdentity, path: string, imagePath: string = path): string {
  const title = identity.ensName
    ? `Thurin.id: ${identity.ensName}`
    : identity.address
      ? `Thurin.id: ${identity.address.slice(0, 6)}…${identity.address.slice(-4)}`
      : identity.fingerprint
        ? `Thurin.id: ${identity.fingerprint.slice(0, 8)}…`
        : 'Thurin.id'

  const description = identity.fingerprint
    ? `PGP key ${identity.fingerprint.slice(0, 4)}…${identity.fingerprint.slice(-4)}: ${identity.status.label}`
    : identity.address
      ? `No PGP key claimed on Ethereum yet`
      : 'PGP keys on Ethereum, checkable by anyone'

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
  <noscript><a href="${escapeHtml(canonicalUrl)}">View on Thurin.id</a></noscript>
</body>
</html>`
}

// Generic site card for non-identity pages: /, /attest, and any unmatched path.
export function renderSiteOgHtml(path: string): string {
  const normalized = path.replace(/\/+$/, '') || '/'
  const title = normalized === '/attest'
    ? 'Thurin.id: add your key'
    : 'Thurin.id: PGP keys on Ethereum'
  const description =
    "Look up anyone's PGP key, or put yours on your Ethereum address. Anyone can check it, and none of it depends on us."

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
${redirect}  <noscript><a href="${escapeHtml(canonicalUrl)}">View on Thurin.id</a></noscript>
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
