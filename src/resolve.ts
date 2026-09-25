import { createPublicClient, http } from 'viem'
import { mainnet, sepolia, foundry } from 'viem/chains'
import { normalize } from 'viem/ens'
import {
  REGISTRY_ABI,
  getRegistry,
  isNetworkName,
  bytesToFingerprint,
  fingerprintToBytes,
  keyIdToBytes,
  normalizeFingerprint,
  parsePgpKey,
  verifyAttestation,
  payloadText,
  identifyProof,
  CLAIM_CHECK_LABEL,
  type PGPKeyInfo,
  type Proof,
} from '@thurinlabs/identity-kit'
import { cacheGet, cacheSet } from './cache'
import { normalizeAvatarUrl } from './safe'

// NETWORK=mainnet (default) | sepolia | local. The registry has the same address on
// mainnet, Sepolia, and local; REGISTRY_ADDRESS overrides it. Reads are plain eth_calls, so any RPC
// works: RPC_URL overrides the keyless public default.
const NETWORK = isNetworkName(process.env.NETWORK) ? process.env.NETWORK : 'mainnet'
const REGISTRY = getRegistry(NETWORK, process.env.REGISTRY_ADDRESS)
const CHAIN = NETWORK === 'sepolia' ? sepolia : NETWORK === 'local' ? foundry : mainnet
const RPC_URL = process.env.RPC_URL || REGISTRY.defaultRpcUrl

const client = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
})

const registry = { address: REGISTRY.address, abi: REGISTRY_ABI } as const

// Cap how many claims we verify per address so an address that self-attests many
// times can't turn one request into an unbounded run of signature checks.
const MAX_VERIFY = 50

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
  activeClaims: number
  totalClaims: number
  pgpKeyInfo: PGPKeyInfo | null
  proofs: Proof[]
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
  // Do NOT populate the addr: cache from an ENS lookup. Forward resolution is
  // attacker-controlled (anyone can point their ENS name at any address), so
  // writing it here would let /eth and /card render a spoofed name for that
  // address for the whole cache TTL.
  return result
}

export async function resolveByFingerprint(fingerprint: string): Promise<ResolvedIdentity> {
  // A 16-char key ID resolves to a fingerprint through the registry's own index.
  if (/^[0-9a-fA-F]{16}$/.test(fingerprint)) {
    const keyId = keyIdToBytes(fingerprint)
    if (!keyId) return emptyIdentity()
    try {
      const fps = await client.readContract({ ...registry, functionName: 'fingerprintsForKeyId', args: [keyId] })
      if (fps.length === 0) return emptyIdentity()
      fingerprint = bytesToFingerprint(fps[0])
    } catch {
      return emptyIdentity()
    }
  }

  const fp = normalizeFingerprint(fingerprint)
  if (!fp) return emptyIdentity()

  const cacheKey = `fpr:${fp}`
  const cached = cacheGet<ResolvedIdentity>(cacheKey)
  if (cached) return cached

  // Every owner that ever attested this fingerprint; pick the first with an active claim for it.
  let address: string | null = null
  try {
    const owners = await client.readContract({
      ...registry,
      functionName: 'ownersOf',
      args: [fingerprintToBytes(fp)],
    })
    for (const owner of owners) {
      const rows = await client.readContract({ ...registry, functionName: 'claimsOf', args: [owner] })
      if (rows.some((r) => Number(r.revokedAt) === 0 && bytesToFingerprint(r.fingerprint) === fp)) {
        address = owner
        break
      }
    }
  } catch { /* registry read optional */ }

  // No active claim anywhere: nothing to show beyond the fingerprint itself.
  const result = address
    ? await buildIdentity(address, undefined, fp)
    : { ...emptyIdentity(), fingerprint: fp.toUpperCase(), status: { kind: 'inactive' as const, label: 'no active claim', since: null } }
  cacheSet(cacheKey, result)
  return result
}

async function buildIdentity(
  address: string,
  ensNameHint?: string,
  fingerprintHint?: string,
): Promise<ResolvedIdentity> {
  // Resolve ENS
  let ensName = ensNameHint || null
  let ensAvatar: string | null = null
  try {
    if (!ensName) {
      ensName = await client.getEnsName({ address: address as `0x${string}` })
    }
    if (ensName) {
      // Read the raw avatar record and accept only https/ipfs/data image URLs.
      // getEnsAvatar would also resolve NFT (eip155) avatars by fetching an
      // attacker-controlled token URI — an SSRF path we avoid entirely.
      const avatarRecord = await client.getEnsText({ name: normalize(ensName), key: 'avatar' })
      ensAvatar = normalizeAvatarUrl(avatarRecord)
    }
  } catch { /* ENS resolution is optional */ }

  // Claims: the full history in one call, then the stored key of the current claim.
  // "Current" = the latest active claim whose stored signature verifies for this
  // address (the same rule identity-kit uses), optionally pinned to a fingerprint.
  let totalClaims = 0
  let activeClaims = 0
  let fingerprint: string | null = null
  let armoredKey: string | null = null
  let status: KeyStatus = { kind: 'none', label: 'no claim yet', since: null }
  const wanted = fingerprintHint ? normalizeFingerprint(fingerprintHint) : null

  try {
    const rows = await client.readContract({ ...registry, functionName: 'claimsOf', args: [address as `0x${string}`] })
    totalClaims = rows.length
    activeClaims = rows.filter((r) => Number(r.revokedAt) === 0).length
    if (totalClaims && !activeClaims) {
      const last = rows[rows.length - 1]
      status = { kind: 'inactive', label: last.revokeReason === 'compromised' ? 'key compromised' : 'no active claim', since: null }
    }

    let checked = 0
    for (let i = rows.length - 1; i >= 0 && checked < MAX_VERIFY; i--) {
      const row = rows[i]
      if (Number(row.revokedAt) !== 0) continue
      const fp = bytesToFingerprint(row.fingerprint)
      if (wanted && fp !== wanted) continue
      checked++
      const args = [address as `0x${string}`, BigInt(i)] as const
      const [keyHex, sigHex] = await Promise.all([
        client.readContract({ ...registry, functionName: 'keyBytes', args }),
        client.readContract({ ...registry, functionName: 'signatureBytes', args }),
      ])
      const pgpPublicKey = await payloadText(keyHex, 'key')
      const pgpSignature = await payloadText(sigHex, 'signature')
      if (!pgpPublicKey || !pgpSignature) continue
      const v = await verifyAttestation({ pgpPublicKey, pgpSignature, fingerprint: fp, ethAddress: address })
      if (v.verified) {
        fingerprint = fp.toUpperCase()
        armoredKey = pgpPublicKey
        status = { kind: 'verified', label: 'verified on Ethereum', since: Number(row.createdAt) }
        break
      }
      // The newest active claim that doesn't count: show its key and why.
      if (status.kind !== 'not-counted') {
        fingerprint = fp.toUpperCase()
        armoredKey = pgpPublicKey
        status = { kind: 'not-counted', label: v.kind ? CLAIM_CHECK_LABEL[v.kind] : "doesn't verify", since: null }
      }
    }
  } catch { /* contract read optional */ }

  // PGP key + proofs come from the on-chain key. No keyserver.
  let pgpKeyInfo: PGPKeyInfo | null = null
  let proofs: Proof[] = []
  let mastodonUrls: string[] = []

  if (armoredKey) {
    pgpKeyInfo = await parsePgpKey(armoredKey)
    if (pgpKeyInfo) {
      proofs = pgpKeyInfo.notations
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
    activeClaims,
    totalClaims,
    pgpKeyInfo,
    proofs,
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
    activeClaims: 0,
    totalClaims: 0,
    pgpKeyInfo: null,
    proofs: [],
    mastodonUrls: [],
  }
}
