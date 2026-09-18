// Reads. The ranking and graveyard (D12, R5) iterate token ids 1..totalSupply with multicall: no logs (eth_getLogs is
// capped at 10k blocks per call on Arc), no indexer.
import type { Address, Client } from 'viem';
import { multicall, readContract } from 'viem/actions';
import { z } from 'zod';
import { arcPetAbi } from './abi/ArcPet.js';
import { MULTICALL3 } from './chain.js';
import { type PetInfo, PetInfoSchema } from './pet.js';

/** Default number of `petInfo` calls per multicall (one eth_call). ~2-3 KB of return data each. */
export const DEFAULT_LIST_CHUNK = 100;

export interface ArcPetTarget {
  /** ArcPet contract address. */
  arcPet: Address;
}

/** Validates a viem-decoded `petInfo` struct against the Zod schema. */
export function parsePetInfo(raw: unknown): PetInfo {
  return PetInfoSchema.parse(raw);
}

export async function readTotalSupply(client: Client, { arcPet }: ArcPetTarget): Promise<bigint> {
  return readContract(client, { address: arcPet, abi: arcPetAbi, functionName: 'totalSupply' });
}

/** `petInfo(id)`; reverts `NonexistentPet` for ids outside 1..totalSupply. */
export async function readPet(
  client: Client,
  { arcPet, id }: ArcPetTarget & { id: bigint },
): Promise<PetInfo> {
  const raw = await readContract(client, {
    address: arcPet,
    abi: arcPetAbi,
    functionName: 'petInfo',
    args: [id],
  });
  return parsePetInfo(raw);
}

/** The wallet's latest pet (any status), or null when it never hatched one. */
export async function readPetOf(client: Client, { arcPet, owner }: ArcPetTarget & { owner: Address }) {
  const id = await readContract(client, {
    address: arcPet,
    abi: arcPetAbi,
    functionName: 'petOf',
    args: [owner],
  });
  return id === 0n ? null : readPet(client, { arcPet, id });
}

/** Splits the inclusive range from..to into chunks of at most `size` ids. */
export function idChunks(from: bigint, to: bigint, size: number): bigint[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('chunk size must be a positive integer');
  const out: bigint[][] = [];
  let cur: bigint[] = [];
  for (let id = from; id <= to; id++) {
    cur.push(id);
    if (cur.length === size) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export interface ListPetsOptions extends ArcPetTarget {
  /** `petInfo` calls per multicall. Default 100. */
  chunkSize?: number;
  /** Known supply (skips the totalSupply read). */
  totalSupply?: bigint;
  /** Multicall3 address when the client's chain does not declare one. Default: the canonical address. */
  multicallAddress?: Address;
  /** Called after each chunk, for progress bars. */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Every pet, ids 1..totalSupply, via chunked Multicall3 `petInfo` calls (R5). Chunks run one after another to stay
 * polite to the public RPC. Each chunk is evaluated at its own block; recompute with `livePet(p, now)` to compare.
 */
export async function listPets(client: Client, o: ListPetsOptions): Promise<PetInfo[]> {
  const total = o.totalSupply ?? (await readTotalSupply(client, o));
  const out: PetInfo[] = [];
  const chunks = idChunks(1n, total, o.chunkSize ?? DEFAULT_LIST_CHUNK);
  for (const ids of chunks) {
    const results = await multicall(client, {
      allowFailure: false,
      multicallAddress: o.multicallAddress ?? client.chain?.contracts?.multicall3?.address ?? MULTICALL3,
      contracts: ids.map((id) => ({
        address: o.arcPet,
        abi: arcPetAbi,
        functionName: 'petInfo' as const,
        args: [id] as const,
      })),
    });
    for (const r of results) out.push(parsePetInfo(r));
    o.onProgress?.(out.length, Number(total));
  }
  return out;
}

export const TokenMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  image: z.string().startsWith('data:image/svg+xml;base64,'),
  attributes: z.array(
    z.object({
      trait_type: z.string(),
      value: z.union([z.string(), z.number()]),
      display_type: z.string().optional(),
      max_value: z.number().optional(),
    }),
  ),
});
export type TokenMetadata = z.infer<typeof TokenMetadataSchema>;

const JSON_PREFIX = 'data:application/json;base64,';

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Decodes ArcPet's `tokenURI` (base64 JSON with a base64 SVG image). */
export function decodeTokenUri(uri: string): TokenMetadata {
  if (!uri.startsWith(JSON_PREFIX)) throw new Error('tokenURI is not a base64 JSON data URI');
  return TokenMetadataSchema.parse(JSON.parse(base64ToUtf8(uri.slice(JSON_PREFIX.length))));
}

/** The raw SVG markup inside a decoded metadata image. */
export function svgFromMetadata(meta: TokenMetadata): string {
  return base64ToUtf8(meta.image.slice('data:image/svg+xml;base64,'.length));
}

export async function readTokenMetadata(
  client: Client,
  { arcPet, id }: ArcPetTarget & { id: bigint },
): Promise<TokenMetadata> {
  const uri = await readContract(client, {
    address: arcPet,
    abi: arcPetAbi,
    functionName: 'tokenURI',
    args: [id],
  });
  return decodeTokenUri(uri);
}
