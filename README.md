# thurin-og

Open Graph metadata and share card service for [thurin.id](https://thurin.id). Generates per-identity OG tags, share card images, and `rel="me"` links for social crawlers.

A [Thurin Labs](https://thurinlabs.id) project.

## What it does

When Twitter, Farcaster, Mastodon, or any other platform crawls a thurin.id link, this service returns:

- **OG meta tags** — per-identity title, description, and image for rich link previews
- **Share card images** — dynamically generated PNG cards showing ENS name, avatar, attestation count, proofs, EFP followers, and provider badges
- **`rel="me"` links** — enables Mastodon profile verification for users with Mastodon proof notations in their PGP key

## How it works

nginx sits in front of thurin.id's IPFS deployment. It detects crawler User-Agents and proxies those requests to thurin-og instead of IPFS. Real browsers get the SPA from IPFS as usual.

```
Browser  → nginx → IPFS (thurin.id SPA)
Crawler  → nginx → thurin-og (OG tags + image)
```

## Routes

### HTML (OG meta tags + rel="me")

```
GET /eth/:address
GET /pgp/:fingerprint
GET /ens/:name
```

Returns minimal HTML with `og:title`, `og:description`, `og:image`, `twitter:card`, and `link rel="me"` tags. Redirects real browsers to thurin.id.

### Images (share card PNGs)

```
GET /og/eth/:address.png
GET /og/pgp/:fingerprint.png
GET /og/ens/:name.png
```

Returns a 1200x630 PNG share card generated on the fly.

### Card images (compact PNGs for inline embeds)

```
GET /card/eth/:address.png
GET /card/pgp/:fingerprint.png
GET /card/ens/:name.png
```

Returns a compact 640x200 PNG card for inline use — GitHub READMEs, forum posts,
emails. The trailing `.png` is optional. Same live data as the `/og/` cards.

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

Responses are cached in memory (bounded LRU) for 1 hour. Path params are validated at
the route boundary, and avatar fetches are SSRF-guarded: https-only, private/link-local
IPs rejected, size- and timeout-capped, and content-type sniffed from magic bytes.

## Setup

Requires [Bun](https://bun.sh).

```bash
bun install
```

### Environment

```
PORT=3333                    # default
HOST=127.0.0.1               # default — binds loopback (it sits behind nginx)
ALCHEMY_RPC_URL=https://...  # optional: any RPC works (v2 registry reads are plain eth_calls); defaults to publicnode
NETWORK=mainnet              # mainnet (default) | sepolia | local (anvil at 127.0.0.1:8545)
REGISTRY_ADDRESS=0x...       # optional override of the PGPRegistry v2 address
```

### Run

```bash
bun run dev     # watch mode
bun run start   # production
```

## Deployment

Runs on the VPS as a systemd service behind nginx (not part of the IPFS `deploy.sh`
flow). Deploy by pulling and restarting on the VPS:

```bash
ssh <vps> "cd /opt/thurin-og && git pull && ~/.bun/bin/bun install && sudo systemctl restart thurin-og"
```

Rate limiting for `/og/` and `/card/` is best handled in the nginx config (`limit_req`).

## Stack

- [Bun](https://bun.sh) — runtime
- [Hono](https://hono.dev) — HTTP framework
- [satori](https://github.com/vercel/satori) — JSX to SVG
- [@resvg/resvg-js](https://github.com/nicolo-ribaudo/resvg-js) — SVG to PNG
- [viem](https://viem.sh) — Ethereum RPC
- [@thurinlabs/identity-kit](https://www.npmjs.com/package/@thurinlabs/identity-kit) — identity data

## License

MIT

## Links

- [Thurin](https://thurin.id)
- [Documentation](https://docs.thurin.id)
- [GitHub](https://github.com/thurinlabs)
- [Codeberg](https://codeberg.org/thurinlabs) (mirror)
