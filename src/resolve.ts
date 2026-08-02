import { createPublicClient, http, parseAbiItem } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'
import {
  REGISTRY_ADDRESS,
  REGISTRY_ABI,
  CONTRACT_DEPLOY_BLOCK,
  fetchKeyByFingerprint,
  fetchKeyByKeyId,
  parsePgpKey,
  identifyProof,
  fetchEFPGraph,
  type PGPKeyInfo,
  type Proof,
  type EFPGraph,
} from '@thurinlabs/identity-kit'
import { cacheGet, cacheSet } from './cache'
import { normalizeAvatarUrl } from './safe'

const RPC_URL = process.env.ALCHEMY_RPC_URL || 'https://ethereum-rpc.publicnode.com'

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
})

const ATTESTED_EVENT = parseAbiItem(
  'event Attested(address indexed ethAddress, string indexed fingerprintHash, string fingerprint, string pgpSignature, string pgpPublicKey, uint256 index, uint256 timestamp)',
)
const LOG_CHUNK_SIZE = 49999n
const LOGS_TTL = 60 * 60 * 1000 // 1 hour

let logsCache: { logs: any[]; expires: number } | null = null
let logsInflight: Promise<any[]> | null = null

// Scan the whole registry log history once per TTL and share the result across
// all fingerprint lookups; concurrent scans collapse into one in-flight promise.
// This turns an unauthenticated per-request full-chain scan (an amplification
// DoS) into at most one scan per hour.
async function getAllAttestedLogs(): Promise<any[]> {
  if (logsCache && Date.now() < logsCache.expires) return logsCache.logs
  if (logsInflight) return logsInflight
  logsInflight = (async () => {
    const latest = await client.getBlockNumber()
    const all: any[] = []
    for (let start = CONTRACT_DEPLOY_BLOCK; start <= latest; start += LOG_CHUNK_SIZE) {
      const end = start + LOG_CHUNK_SIZE - 1n > latest ? latest : start + LOG_CHUNK_SIZE - 1n
      const chunk = await client.getLogs({
        address: REGISTRY_ADDRESS as `0x${string}`,
        event: ATTESTED_EVENT,
        fromBlock: start,
        toBlock: end,
      })
      all.push(...chunk)
    }
    logsCache = { logs: all, expires: Date.now() + LOGS_TTL }
    return all
  })()
  try {
    return await logsInflight
  } finally {
    logsInflight = null
  }
}

export interface ResolvedIdentity {
  address: string | null
  ensName: string | null
  ensAvatar: string | null
  fingerprint: string | null
  activeClaims: number
  totalClaims: number
  pgpKeyInfo: PGPKeyInfo | null
  proofs: Proof[]
  mastodonUrls: string[]
  efp: EFPGraph | null
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
  // If it's a 16-char key ID, resolve to full fingerprint via keyserver
  if (/^[0-9a-fA-F]{16}$/.test(fingerprint)) {
    const armoredKey = await fetchKeyByKeyId(fingerprint)
    if (armoredKey) {
      const keyInfo = await parsePgpKey(armoredKey)
      if (keyInfo) {
        fingerprint = keyInfo.fingerprint
      }
    }
  }

  const cacheKey = `fpr:${fingerprint.toLowerCase()}`
  const cached = cacheGet<ResolvedIdentity>(cacheKey)
  if (cached) return cached

  // Filter the shared, cached log set rather than scanning the chain per request.
  const logs = await getAllAttestedLogs()
  let address: string | null = null

  for (const log of logs) {
    if (log.args.fingerprint?.toUpperCase() !== fingerprint.toUpperCase()) continue
    // Confirm the claim is still active (not revoked) on-chain.
    const att = await client.readContract({
      address: REGISTRY_ADDRESS as `0x${string}`,
      abi: REGISTRY_ABI,
      functionName: 'getAttestation',
      args: [log.args.ethAddress!, BigInt(Number(log.args.index))],
    }) as [string, bigint, boolean]

    if (!att[2]) {
      address = log.args.ethAddress!
      break
    }
  }

  if (!address) {
    // No on-chain claim, but try to fetch key from keyserver anyway
    const result = await buildIdentityFromKey(fingerprint)
    cacheSet(cacheKey, result)
    return result
  }

  const result = await buildIdentity(address, undefined, fingerprint)
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

  // Fetch attestation count
  let totalClaims = 0
  let activeClaims = 0
  let fingerprint = fingerprintHint || null

  try {
    const count = await client.readContract({
      address: REGISTRY_ADDRESS as `0x${string}`,
      abi: REGISTRY_ABI,
      functionName: 'attestationCount',
      args: [address as `0x${string}`],
    }) as bigint

    totalClaims = Number(count)

    // Cap how many attestations we read so an address that self-attests many
    // times can't turn one request into an unbounded run of sequential reads.
    const MAX_SCAN = 50
    for (let i = totalClaims - 1; i >= 0 && totalClaims - 1 - i < MAX_SCAN; i--) {
      const att = await client.readContract({
        address: REGISTRY_ADDRESS as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: 'getAttestation',
        args: [address as `0x${string}`, BigInt(i)],
      }) as [string, bigint, boolean]

      if (!att[2]) {
        activeClaims++
        if (!fingerprint) fingerprint = att[0].toUpperCase()
      }
    }
  } catch { /* contract read optional */ }

  // Fetch PGP key + proofs
  let pgpKeyInfo: PGPKeyInfo | null = null
  let proofs: Proof[] = []
  let mastodonUrls: string[] = []

  if (fingerprint) {
    const armoredKey = await fetchKeyByFingerprint(fingerprint)
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
  }

  // Fetch EFP
  const efp = await fetchEFPGraph(address)

  return {
    address,
    ensName,
    ensAvatar,
    fingerprint,
    activeClaims,
    totalClaims,
    pgpKeyInfo,
    proofs,
    mastodonUrls,
    efp,
  }
}

async function buildIdentityFromKey(fingerprint: string): Promise<ResolvedIdentity> {
  let pgpKeyInfo: PGPKeyInfo | null = null
  let proofs: Proof[] = []
  let mastodonUrls: string[] = []

  const armoredKey = await fetchKeyByFingerprint(fingerprint)
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
    address: null,
    ensName: null,
    ensAvatar: null,
    fingerprint,
    activeClaims: 0,
    totalClaims: 0,
    pgpKeyInfo,
    proofs,
    mastodonUrls,
    efp: null,
  }
}

export function emptyIdentity(): ResolvedIdentity {
  return {
    address: null,
    ensName: null,
    ensAvatar: null,
    fingerprint: null,
    activeClaims: 0,
    totalClaims: 0,
    pgpKeyInfo: null,
    proofs: [],
    mastodonUrls: [],
    efp: null,
  }
}
