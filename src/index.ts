import { Hono } from 'hono'
import { resolveByAddress, resolveByEns, resolveByFingerprint, emptyIdentity, type ResolvedIdentity } from './resolve'
import { renderOgHtml, renderSiteOgHtml } from './html'
import { renderOgImage, renderCardImage, renderSiteImage } from './image'

const app = new Hono()

// viem attaches the full RPC URL — API key included — to error messages and
// stacks, so raw errors must never reach the journal.
function redactKeys(s: string): string {
  return s.replace(/\/v2\/[A-Za-z0-9_-]+/g, '/v2/***')
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

app.get('/eth/:address', async (c) => {
  const address = c.req.param('address')
  let identity: ResolvedIdentity
  try {
    identity = await resolveByAddress(address)
  } catch (err) {
    logError('Resolve error (/eth):', err)
    identity = { ...emptyIdentity(), address }
  }
  return c.html(renderOgHtml(identity, `/eth/${address}`))
})

app.get('/pgp/:fingerprint', async (c) => {
  const fingerprint = c.req.param('fingerprint')
  let identity: ResolvedIdentity
  try {
    identity = await resolveByFingerprint(fingerprint)
  } catch (err) {
    logError('Resolve error (/pgp):', err)
    identity = { ...emptyIdentity(), fingerprint }
  }
  return c.html(renderOgHtml(identity, `/pgp/${fingerprint}`))
})

app.get('/ens/:name', async (c) => {
  const name = c.req.param('name')
  let identity: ResolvedIdentity
  try {
    identity = await resolveByEns(name)
  } catch (err) {
    logError('Resolve error (/ens):', err)
    identity = { ...emptyIdentity(), ensName: name }
  }
  return c.html(renderOgHtml(identity, `/ens/${name}`))
})

// ─── Image routes (share card PNGs) ──────────────────────────────────────────

app.get('/og/eth/:address', async (c) => {
  try {
    const address = c.req.param('address').replace(/\.png$/, '')
    const identity = await resolveByAddress(address)
    const png = await renderOgImage(identity)
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('OG image error:', err)
    return c.text('Internal error', 500)
  }
})

app.get('/og/pgp/:fingerprint', async (c) => {
  try {
    const fingerprint = c.req.param('fingerprint').replace(/\.png$/, '')
    const identity = await resolveByFingerprint(fingerprint)
    const png = await renderOgImage(identity)
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('OG image error:', err)
    return c.text('Internal error', 500)
  }
})

app.get('/og/ens/:name', async (c) => {
  try {
    const name = c.req.param('name').replace(/\.png$/, '')
    const identity = await resolveByEns(name)
    const png = await renderOgImage(identity)
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
    const identity = await resolveByAddress(address)
    const png = await renderCardImage(identity)
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('Card image error:', err)
    return c.text('Internal error', 500)
  }
})

app.get('/card/pgp/:fingerprint', async (c) => {
  try {
    const fingerprint = c.req.param('fingerprint').replace(/\.png$/, '')
    const identity = await resolveByFingerprint(fingerprint)
    const png = await renderCardImage(identity)
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    logError('Card image error:', err)
    return c.text('Internal error', 500)
  }
})

app.get('/card/ens/:name', async (c) => {
  try {
    const name = c.req.param('name').replace(/\.png$/, '')
    const identity = await resolveByEns(name)
    const png = await renderCardImage(identity)
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
console.log(`scry-og listening on :${port}`)

export default {
  port,
  fetch: app.fetch,
}
