import { arcMainnet, deployedAddress, resolveDeployment } from '@arcpet/sdk';
import { type Address, type Chain, defineChain } from 'viem';
import { anvil } from 'viem/chains';
import deploymentJson from '../../../../deployments/arc-mainnet.json';

/** Chains the app can be built for: Arc mainnet (default) and a local anvil for development. */
export const SUPPORTED_CHAIN_IDS = [5042, 31337] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/** The NEXT_PUBLIC_* values the app reads. Every field is optional; defaults come from deployments/arc-mainnet.json. */
export interface PublicEnv {
  NEXT_PUBLIC_CHAIN_ID?: string | undefined;
  NEXT_PUBLIC_RPC_URL?: string | undefined;
  NEXT_PUBLIC_ARCPET_ADDRESS?: string | undefined;
  NEXT_PUBLIC_COORDINATOR_ADDRESS?: string | undefined;
  NEXT_PUBLIC_EXPLORER_URL?: string | undefined;
  NEXT_PUBLIC_SITE_URL?: string | undefined;
  NEXT_PUBLIC_REPO_URL?: string | undefined;
  NEXT_PUBLIC_BASE_PATH?: string | undefined;
}

export interface AppConfig {
  chainId: SupportedChainId;
  chain: Chain;
  chainLabel: string;
  rpcUrl: string;
  explorerUrl: string | null;
  /** ArcPet address, or null while it is not deployed (empty, zero or placeholder address): the UI says so. */
  arcPet: Address | null;
  coordinator: Address;
  /** Public site root without a trailing slash (share links, .ics URLs). */
  siteUrl: string;
  repoUrl: string;
  basePath: string;
  problems: string[];
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');
const httpUrl = (v: string | undefined) =>
  v && /^https?:\/\/\S+$/.test(v.trim()) ? trimSlash(v.trim()) : null;

/** Pure: build-time env + deployments JSON -> config. An env address overrides the JSON (local anvil runs). */
export function parseConfig(env: PublicEnv, deployment: unknown = deploymentJson): AppConfig {
  const problems: string[] = [];
  const d = resolveDeployment(deployment);
  let chainId: SupportedChainId = 5042;
  const rawChain = env.NEXT_PUBLIC_CHAIN_ID?.trim();
  if (rawChain) {
    const n = Number(rawChain);
    if ((SUPPORTED_CHAIN_IDS as readonly number[]).includes(n)) chainId = n as SupportedChainId;
    else problems.push(`NEXT_PUBLIC_CHAIN_ID=${rawChain} is not supported (use 5042 or 31337).`);
  }
  const local = chainId === 31337;
  const rpcUrl = httpUrl(env.NEXT_PUBLIC_RPC_URL) ?? (local ? 'http://127.0.0.1:8545' : d.rpc);
  const explorerUrl = httpUrl(env.NEXT_PUBLIC_EXPLORER_URL) ?? (local ? null : d.explorer);
  const base = local ? anvil : arcMainnet;
  const chain = defineChain({
    ...base,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: explorerUrl ? { default: { name: 'Explorer', url: explorerUrl } } : undefined,
  });
  const envPet = deployedAddress(env.NEXT_PUBLIC_ARCPET_ADDRESS);
  const envCoord = deployedAddress(env.NEXT_PUBLIC_COORDINATOR_ADDRESS);
  if (local && !envPet) problems.push('Local chain selected but NEXT_PUBLIC_ARCPET_ADDRESS is unset.');
  return {
    chainId,
    chain,
    chainLabel: local ? 'Local anvil' : 'Arc',
    rpcUrl,
    explorerUrl,
    arcPet: envPet ?? (local ? null : d.arcPet),
    coordinator: envCoord ?? d.coordinator,
    siteUrl: httpUrl(env.NEXT_PUBLIC_SITE_URL) ?? 'https://r4topunk.github.io/arcpet',
    repoUrl: httpUrl(env.NEXT_PUBLIC_REPO_URL) ?? 'https://github.com/r4topunk/arcpet',
    basePath: trimSlash(env.NEXT_PUBLIC_BASE_PATH?.trim() ?? ''),
    problems,
  };
}

// Next inlines NEXT_PUBLIC_* only for literal `process.env.NAME` references, so each one is spelled out here.
export const config = parseConfig({
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_ARCPET_ADDRESS: process.env.NEXT_PUBLIC_ARCPET_ADDRESS,
  NEXT_PUBLIC_COORDINATOR_ADDRESS: process.env.NEXT_PUBLIC_COORDINATOR_ADDRESS,
  NEXT_PUBLIC_EXPLORER_URL: process.env.NEXT_PUBLIC_EXPLORER_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_REPO_URL: process.env.NEXT_PUBLIC_REPO_URL,
  NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
});

export const CHAIN_ID = config.chainId;
export const chain = config.chain;

export const explorerTx = (hash: string) => (config.explorerUrl ? `${config.explorerUrl}/tx/${hash}` : null);
export const explorerAddress = (a: string) =>
  config.explorerUrl ? `${config.explorerUrl}/address/${a}` : null;
/** In-app route of a pet's public page (query param: static export has no dynamic segments). */
export const petPath = (id: bigint | number | string) => `/app/pet/?id=${id}`;
/** Absolute share link of a pet's public page. */
export const petUrl = (id: bigint | number | string) => `${config.siteUrl}${petPath(id)}`;
