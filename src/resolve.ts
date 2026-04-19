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

const RPC_URL = process.env.ALCHEMY_RPC_URL || 'https://ethereum-rpc.publicnode.com'

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
})

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
  cacheSet(`addr:${address.toLowerCase()}`, result)
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

  // Find addresses that claimed this fingerprint via event logs
  const event = parseAbiItem(
    'event Attested(address indexed ethAddress, string indexed fingerprintHash, string fingerprint, string pgpSignature, string pgpPublicKey, uint256 index, uint256 timestamp)',
  )

  const LOG_CHUNK_SIZE = 49999n
  const latest = await client.getBlockNumber()
  let address: string | null = null

  for (let start = CONTRACT_DEPLOY_BLOCK; start <= latest; start += LOG_CHUNK_SIZE) {
    const end = start + LOG_CHUNK_SIZE - 1n > latest ? latest : start + LOG_CHUNK_SIZE - 1n
    const logs = await client.getLogs({
      address: REGISTRY_ADDRESS as `0x${string}`,
      event,
      fromBlock: start,
      toBlock: end,
    })

    for (const log of logs) {
      if (log.args.fingerprint?.toUpperCase() === fingerprint.toUpperCase()) {
        // Check if not revoked
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
    }
    if (address) break
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
      ensAvatar = await client.getEnsAvatar({ name: normalize(ensName) })
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

    for (let i = totalClaims - 1; i >= 0; i--) {
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

function emptyIdentity(): ResolvedIdentity {
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
