import { Hono } from 'hono'
import { resolveByAddress, resolveByEns, resolveByFingerprint } from './resolve'
import { renderOgHtml } from './html'
import { renderOgImage, renderCardImage } from './image'

const app = new Hono()

// ─── HTML routes (OG meta tags + rel="me") ───────────────────────────────────

app.get('/eth/:address', async (c) => {
  const identity = await resolveByAddress(c.req.param('address'))
  const html = renderOgHtml(identity, `/eth/${c.req.param('address')}`)
  return c.html(html)
})

app.get('/pgp/:fingerprint', async (c) => {
  const identity = await resolveByFingerprint(c.req.param('fingerprint'))
  const html = renderOgHtml(identity, `/pgp/${c.req.param('fingerprint')}`)
  return c.html(html)
})

app.get('/ens/:name', async (c) => {
  const identity = await resolveByEns(c.req.param('name'))
  const html = renderOgHtml(identity, `/ens/${c.req.param('name')}`)
  return c.html(html)
})

// ─── Image routes (share card PNGs) ──────────────────────────────────────────

app.get('/og/eth/:address', async (c) => {
  try {
    const address = c.req.param('address').replace(/\.png$/, '')
    const identity = await resolveByAddress(address)
    const png = await renderOgImage(identity)
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    console.error('OG image error:', err)
    return c.text(err.message, 500)
  }
})

app.get('/og/pgp/:fingerprint', async (c) => {
  try {
    const fingerprint = c.req.param('fingerprint').replace(/\.png$/, '')
    const identity = await resolveByFingerprint(fingerprint)
    const png = await renderOgImage(identity)
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    console.error('OG image error:', err)
    return c.text(err.message, 500)
  }
})

app.get('/og/ens/:name', async (c) => {
  try {
    const name = c.req.param('name').replace(/\.png$/, '')
    const identity = await resolveByEns(name)
    const png = await renderOgImage(identity)
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    console.error('OG image error:', err)
    return c.text(err.message, 500)
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
    console.error('Card image error:', err)
    return c.text(err.message, 500)
  }
})

app.get('/card/pgp/:fingerprint', async (c) => {
  try {
    const fingerprint = c.req.param('fingerprint').replace(/\.png$/, '')
    const identity = await resolveByFingerprint(fingerprint)
    const png = await renderCardImage(identity)
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    console.error('Card image error:', err)
    return c.text(err.message, 500)
  }
})

app.get('/card/ens/:name', async (c) => {
  try {
    const name = c.req.param('name').replace(/\.png$/, '')
    const identity = await resolveByEns(name)
    const png = await renderCardImage(identity)
    return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' })
  } catch (err: any) {
    console.error('Card image error:', err)
    return c.text(err.message, 500)
  }
})

// ─── Health check ────────────────────────────────────────────────────────────

app.get('/health', (c) => c.text('ok'))

// ─── Start ───────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || '3333')
console.log(`scry-og listening on :${port}`)

export default {
  port,
  fetch: app.fetch,
}
