import { Hono } from 'hono'
import { resolveByAddress, resolveByEns, resolveByFingerprint, emptyIdentity, type ResolvedIdentity } from './resolve'
import { renderOgHtml, renderSiteOgHtml } from './html'
import { renderOgImage, renderCardImage, renderSiteImage, type Theme } from './image'

// ?theme=light draws the card in the sites' light mode; anything else is dark.
const themeOf = (c: { req: { query: (k: string) => string | undefined } }): Theme => (c.req.query('theme') === 'light' ? 'light' : 'dark')
import { isValidAddress, isValidFingerprint, isValidEnsName } from './safe'

const app = new Hono()

const RPC_URL = process.env.RPC_URL || ''

// viem attaches the full RPC URL — API key included — to error messages and
// stacks, so raw errors must never reach the journal. Redact the configured
// URL literally, then common provider key-URL shapes as a fallback.
function redactKeys(s: string): string {
  let out = s
  if (RPC_URL) out = out.split(RPC_URL).join('[redacted-rpc]')
  return out
    .replace(/\/v2\/[A-Za-z0-9_-]+/g, '/v2/***')
    .replace(/\/v3\/[A-Za-z0-9_-]+/g, '/v3/***')
    .replace(/([?&](?:apikey|api_key|auth|key|token)=)[^&\s]+/gi, '$1***')
}

function logError(prefix: string, err: any): void {
  const detail = [err?.name, err?.shortMessage || err?.message, err?.stack]
    .filter(Boolean)
    .join('\n')
  console.error(prefix, redactKeys(detail))
}

app.onError((err, c) => {
  logError('Unhandled error:', err)
  return c.text('Internal error', 500)
})

// ─── Site routes (generic card for non-identity pages) ───────────────────────

app.get('/', (c) => c.html(renderSiteOgHtml('/')))

app.get('/og/site.png', async (c) => {
  try {
    const png = await renderSiteImage()
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' })
  } catch (err: any) {
    logError('Site image error:', err)
    return c.text('Internal error', 500)
  }
})

// ─── HTML routes (OG meta tags + rel="me") ───────────────────────────────────

// A crawler that gets a 500 shows no preview at all, so RPC failures degrade to
// a sparse card seeded with the requested identifier.

// Identity pages have tabs as routes (/ens/<name>/claims, /records, /encrypt). A shared tab URL
// gets the same identity card as the overview: the image is keyed by the base path, the
// canonical URL keeps the tab. Anything else after the identifier is not an identity page.
const TABS = new Set(['claims', 'records', 'encrypt'])
function tabOf(c: { req: { param: (k: string) => string | undefined } }): string | null {
  const tab = c.req.param('tab')
  if (tab === undefined || tab === '') return ''
  return TABS.has(tab) ? `/${tab}` : null
}

app.get('/eth/:address/:tab?', async (c) => {
  const address = c.req.param('address')
  const tab = tabOf(c)
  if (!isValidAddress(address) || tab === null) return c.html(renderSiteOgHtml(`/eth/${address}`))
  let identity: ResolvedIdentity
  try {
    identity = await resolveByAddress(address)
  } catch (err) {
    logError('Resolve error (/eth):', err)
    identity = { ...emptyIdentity(), address }
  }
  return c.html(renderOgHtml(identity, `/eth/${address}${tab}`, `/eth/${address}`))
})

app.get('/pgp/:fingerprint/:tab?', async (c) => {
  const fingerprint = c.req.param('fingerprint')
  const tab = tabOf(c)
  if (!isValidFingerprint(fingerprint) || tab === null) return c.html(renderSiteOgHtml(`/pgp/${fingerprint}`))
  let identity: ResolvedIdentity
  try {
    identity = await resolveByFingerprint(fingerprint)
  } catch (err) {
    logError('Resolve error (/pgp):', err)
    identity = { ...emptyIdentity(), fingerprint }
  }
  return c.html(renderOgHtml(identity, `/pgp/${fingerprint}${tab}`, `/pgp/${fingerprint}`))
})

app.get('/ens/:name/:tab?', async (c) => {
  const name = c.req.param('name')
  const tab = tabOf(c)
  if (!isValidEnsName(name) || tab === null) return c.html(renderSiteOgHtml(`/ens/${name}`))
  let identity: ResolvedIdentity
  try {
    identity = await resolveByEns(name)
  } catch (err) {
    logError('Resolve error (/ens):', err)
    identity = { ...emptyIdentity(), ensName: name }
  }
  return c.html(renderOgHtml(identity, `/ens/${name}${tab}`, `/ens/${name}`))
})

// ─── Image routes (share card PNGs) ──────────────────────────────────────────

app.get('/og/eth/:address', async (c) => {
  try {
    const address = c.req.param('address').replace(/\.png$/, '')
    if (!isValidAddress(address)) return c.text('Not Found', 404)
    const identity = await resolveByAddress(address)
    const png = await renderOgImage(identity, themeOf(c))
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('OG image error:', err)
    return c.text('Internal error', 500)
  }
})

app.get('/og/pgp/:fingerprint', async (c) => {
  try {
    const fingerprint = c.req.param('fingerprint').replace(/\.png$/, '')
    if (!isValidFingerprint(fingerprint)) return c.text('Not Found', 404)
    const identity = await resolveByFingerprint(fingerprint)
    const png = await renderOgImage(identity, themeOf(c))
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('OG image error:', err)
    return c.text('Internal error', 500)
  }
})

app.get('/og/ens/:name', async (c) => {
  try {
    const name = c.req.param('name').replace(/\.png$/, '')
    if (!isValidEnsName(name)) return c.text('Not Found', 404)
    const identity = await resolveByEns(name)
    const png = await renderOgImage(identity, themeOf(c))
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('OG image error:', err)
    return c.text('Internal error', 500)
  }
})

// ─── Card routes (compact PNGs for inline embeds — GitHub READMEs, etc.) ─────

app.get('/card/eth/:address', async (c) => {
  try {
    const address = c.req.param('address').replace(/\.png$/, '')
    if (!isValidAddress(address)) return c.text('Not Found', 404)
    const identity = await resolveByAddress(address)
    const png = await renderCardImage(identity, themeOf(c))
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('Card image error:', err)
    return c.text('Internal error', 500)
  }
})

app.get('/card/pgp/:fingerprint', async (c) => {
  try {
    const fingerprint = c.req.param('fingerprint').replace(/\.png$/, '')
    if (!isValidFingerprint(fingerprint)) return c.text('Not Found', 404)
    const identity = await resolveByFingerprint(fingerprint)
    const png = await renderCardImage(identity, themeOf(c))
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('Card image error:', err)
    return c.text('Internal error', 500)
  }
})

app.get('/card/ens/:name', async (c) => {
  try {
    const name = c.req.param('name').replace(/\.png$/, '')
    if (!isValidEnsName(name)) return c.text('Not Found', 404)
    const identity = await resolveByEns(name)
    const png = await renderCardImage(identity, themeOf(c))
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('Card image error:', err)
    return c.text('Internal error', 500)
  }
})

// ─── Health check ────────────────────────────────────────────────────────────

app.get('/health', (c) => c.text('ok'))

// ─── Catch-all ───────────────────────────────────────────────────────────────
// nginx forwards every crawler-UA request here, so unmatched paths must serve
// a card, not a 404 — otherwise new SPA routes silently lose their previews.
// Image/asset-like paths stay 404: a 200 HTML response where a PNG is expected
// would poison caches and hide broken og:image URLs.

app.notFound((c) => {
  const pathname = new URL(c.req.url).pathname
  const assetLike = pathname.startsWith('/og/')
    || pathname.startsWith('/card/')
    || /\.(png|jpe?g|gif|svg|ico|webp|css|js|map|txt|xml|json)$/i.test(pathname)
  if (assetLike) return c.text('Not Found', 404)
  return c.html(renderSiteOgHtml(pathname), 200)
})

// ─── Start ───────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || '3333')
console.log(`thurin-og listening on :${port}`)

export default {
  port,
  // Bind loopback by default — the service sits behind nginx, so it should not
  // be reachable directly. Override with HOST if a different bind is needed.
  hostname: process.env.HOST || '127.0.0.1',
  fetch: app.fetch,
}
