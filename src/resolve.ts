import { createPublicClient, http } from 'viem'
import { mainnet, sepolia, foundry } from 'viem/chains'
import { normalize } from 'viem/ens'
import {
  getRegistry,
  isNetworkName,
  normalizeFingerprint,
  parsePgpKey,
  identifyProof,
  readClaims,
  keyStanding,
  findOwners,
  CLAIM_CHECK_LABEL,
  type Attestation,
  type PGPKeyInfo,
  type Proof,
} from '@thurinlabs/identity-kit'
import { cacheGet, cacheSet } from './cache'
import { normalizeAvatarUrl } from './safe'

// NETWORK=mainnet (default) | sepolia | local; the registry has the same address on all three.
// REGISTRY_ADDRESS and RPC_URL override the defaults; reads are plain eth_calls, so any RPC works.
const NETWORK = isNetworkName(process.env.NETWORK) ? process.env.NETWORK : 'mainnet'
const REGISTRY = getRegistry(NETWORK, process.env.REGISTRY_ADDRESS)
const CHAIN = NETWORK === 'sepolia' ? sepolia : NETWORK === 'local' ? foundry : mainnet
const RPC_URL = process.env.RPC_URL || REGISTRY.defaultRpcUrl

const client = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
})

const registry = { registry: REGISTRY.address }

/** Where the identity's key stands, in the words the card shows. */
export interface KeyStatus {
  /** verified: a claim that counts · not-counted: an active claim that doesn't verify (label says why) ·
   *  inactive: only ended claims · none: never claimed. */
  kind: 'verified' | 'not-counted' | 'inactive' | 'none'
  label: string
  /** When the verified claim was made, Unix seconds. */
  since: number | null
}

export interface ResolvedIdentity {
  address: string | null
  ensName: string | null
  ensAvatar: string | null
  /** The key the card shows: the verified claim's, else the newest active claim's. */
  fingerprint: string | null
  status: KeyStatus
  pgpKeyInfo: PGPKeyInfo | null
  mastodonUrls: string[]
}

export async function resolveByAddress(address: string): Promise<ResolvedIdentity> {
  const cacheKey = `addr:${address.toLowerCase()}`
  const cached = cacheGet<ResolvedIdentity>(cacheKey)
  if (cached) return cached

  const result = await buildIdentity(address)
  cacheSet(cacheKey, result)
  return result
}

export async function resolveByEns(name: string): Promise<ResolvedIdentity> {
  const cacheKey = `ens:${name.toLowerCase()}`
  const cached = cacheGet<ResolvedIdentity>(cacheKey)
  if (cached) return cached

  let normalized: string
  try {
    normalized = normalize(name)
  } catch {
    return emptyIdentity()
  }

  const address = await client.getEnsAddress({ name: normalized })
  if (!address) return emptyIdentity()

  const result = await buildIdentity(address, name)
  cacheSet(cacheKey, result)
  // Never seed the addr: cache from a name: anyone can point a name at any address, and /eth and
  // /card would show the spoofed name for that address until the cache expires.
  return result
}

export async function resolveByFingerprint(input: string): Promise<ResolvedIdentity> {
  // A 16-char key ID resolves through the registry's own index; a key ID can match several keys.
  const isKeyId = /^[0-9a-fA-F]{16}$/.test(input)
  const fp = isKeyId ? null : normalizeFingerprint(input)
  if (!isKeyId && !fp) return emptyIdentity()
  if (fp) {
    const cached = cacheGet<ResolvedIdentity>(`fpr:${fp}`)
    if (cached) return cached
  }

  // Every owner that ever claimed the key; show the first with an active claim for it.
  let owners: { owner: string; fingerprint: string }[] = []
  try { owners = await findOwners(client, isKeyId ? { keyId: input } : { fingerprint: fp! }, registry) } catch { /* registry read optional */ }
  if (isKeyId && !owners.length) return emptyIdentity()
  const shown = fp ?? owners[0].fingerprint
  let result: ResolvedIdentity | null = null
  for (const { owner, fingerprint } of owners) {
    let claims: Attestation[]
    try { claims = await readClaims(client, owner as `0x${string}`, registry) } catch { continue }
    if (claims.some(c => !c.revoked && c.fingerprint === fingerprint)) {
      result = await buildIdentity(owner, undefined, fingerprint, claims)
      break
    }
  }

  // No active claim anywhere: nothing to show beyond the fingerprint itself.
  result ??= { ...emptyIdentity(), fingerprint: shown.toUpperCase(), status: { kind: 'inactive' as const, label: 'no active claim', since: null } }
  cacheSet(`fpr:${result.fingerprint?.toLowerCase() ?? shown}`, result)
  return result
}

async function buildIdentity(
  address: string,
  ensNameHint?: string,
  fingerprintHint?: string,
  known?: Attestation[],
): Promise<ResolvedIdentity> {
  let ensName = ensNameHint || null
  let ensAvatar: string | null = null
  try {
    if (!ensName) {
      ensName = await client.getEnsName({ address: address as `0x${string}` })
    }
    if (ensName) {
      // The raw record, filtered by normalizeAvatarUrl. getEnsAvatar would fetch NFT token URIs
      // the name's owner controls (SSRF).
      const avatarRecord = await client.getEnsText({ name: normalize(ensName), key: 'avatar' })
      ensAvatar = normalizeAvatarUrl(avatarRecord)
    }
  } catch { /* ENS resolution is optional */ }

  // The key the card shows, by identity-kit's rule, optionally pinned to one fingerprint.
  let claims = known ?? []
  if (!known) try { claims = await readClaims(client, address as `0x${string}`, registry) } catch { /* contract read optional */ }
  const wanted = fingerprintHint ? normalizeFingerprint(fingerprintHint) : null
  const { kind, claim } = keyStanding(wanted ? claims.filter(c => c.fingerprint === wanted) : claims)
  const status: KeyStatus =
    kind === 'verified' ? { kind, label: 'verified on Ethereum', since: claim.createdAt }
    : kind === 'not-counted' ? { kind, label: claim.verification?.kind ? CLAIM_CHECK_LABEL[claim.verification.kind] : "doesn't verify", since: null }
    : kind === 'inactive' ? { kind, label: claim.revokeReason === 'compromised' ? 'key compromised' : 'no active claim', since: null }
    : { kind, label: 'no claim yet', since: null }
  const shown = kind === 'verified' || kind === 'not-counted' ? claim : null
  const fingerprint = shown ? shown.fingerprint.toUpperCase() : null
  const armoredKey = shown?.pgpPublicKey ?? null

  // The key and its proofs come from the chain, never a keyserver.
  let pgpKeyInfo: PGPKeyInfo | null = null
  let mastodonUrls: string[] = []

  if (armoredKey) {
    pgpKeyInfo = await parsePgpKey(armoredKey)
    if (pgpKeyInfo) {
      const proofs = pgpKeyInfo.notations
        .map((n) => identifyProof(n))
        .filter((p): p is Proof => p !== null)

      mastodonUrls = proofs
        .filter((p) => p.provider === 'mastodon')
        .map((p) => `https://${p.instance}/@${p.user}`)
    }
  }

  return {
    address,
    ensName,
    ensAvatar,
    fingerprint,
    status,
    pgpKeyInfo,
    mastodonUrls,
  }
}

export function emptyIdentity(): ResolvedIdentity {
  return {
    address: null,
    ensName: null,
    ensAvatar: null,
    fingerprint: null,
    status: { kind: 'none', label: 'no claim yet', since: null },
    pgpKeyInfo: null,
    mastodonUrls: [],
  }
}
