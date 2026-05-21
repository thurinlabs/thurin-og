# scry-og

Open Graph metadata and share card service for [Scry](https://thurin.id). Generates per-identity OG tags, share card images, and `rel="me"` links for social crawlers.

A [Thurin Labs](https://thurin.id) project.

## What it does

When Twitter, Farcaster, Mastodon, or any other platform crawls a Scry link, this service returns:

- **OG meta tags** — per-identity title, description, and image for rich link previews
- **Share card images** — dynamically generated PNG cards showing ENS name, avatar, seal count, proofs, EFP followers, and provider badges
- **`rel="me"` links** — enables Mastodon profile verification for users with Mastodon proof notations in their PGP key

## How it works

nginx sits in front of Scry's IPFS deployment. It detects crawler User-Agents and proxies those requests to scry-og instead of IPFS. Real browsers get the Scry SPA from IPFS as usual.

```
Browser  → nginx → IPFS (Scry SPA)
Crawler  → nginx → scry-og (OG tags + image)
```

## Routes

### HTML (OG meta tags + rel="me")

```
GET /eth/:address
GET /pgp/:fingerprint
GET /ens/:name
```

Returns minimal HTML with `og:title`, `og:description`, `og:image`, `twitter:card`, and `link rel="me"` tags. Redirects real browsers to Scry.

### Images (share card PNGs)

```
GET /og/eth/:address.png
GET /og/pgp/:fingerprint.png
GET /og/ens/:name.png
```

Returns a 1200x630 PNG share card generated on the fly.

### Health

```
GET /health
```

## Data sources

All data is fetched live using [`@thurinlabs/identity-kit`](https://www.npmjs.com/package/@thurinlabs/identity-kit) core modules:

- **PGPRegistry contract** — on-chain attestation count and status (via viem)
- **keys.openpgp.org** — PGP key and proof notations
- **EFP API** — follower/following counts
- **ENS** — name resolution and avatar (via viem)

Responses are cached in memory for 5 minutes.

## Setup

Requires [Bun](https://bun.sh).

```bash
bun install
```

### Environment

```
PORT=3333                    # default
ALCHEMY_RPC_URL=https://...  # optional, falls back to publicnode
```

### Run

```bash
bun run dev     # watch mode
bun run start   # production
```

## Deployment

Runs on the VPS as a systemd service behind nginx. Deploy via:

```bash
./deploy.sh scry-og
```

## Stack

- [Bun](https://bun.sh) — runtime
- [Hono](https://hono.dev) — HTTP framework
- [satori](https://github.com/vercel/satori) — JSX to SVG
- [@resvg/resvg-js](https://github.com/nicolo-ribaudo/resvg-js) — SVG to PNG
- [viem](https://viem.sh) — Ethereum RPC
- [@thurinlabs/identity-kit](https://www.npmjs.com/package/@thurinlabs/identity-kit) — identity data

## Links

- [Scry](https://thurin.id)
- [Documentation](https://docs.thurin.id)
- [Codeberg](https://codeberg.org/thurinlabs)
