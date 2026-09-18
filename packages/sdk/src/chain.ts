import { type Address, defineChain, getAddress, isAddress, zeroAddress } from 'viem';
import { arc } from 'viem/chains';
import { z } from 'zod';
import { ARC_MAINNET_CHAIN_ID, ARCDRAW_COORDINATOR } from './constants.js';

/** Multicall3, deployed at its canonical address on Arc mainnet. */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

/** Arc mainnet (chain 5042): viem's `arc` plus the public RPC, explorer and Multicall3. */
export const arcMainnet = defineChain({
  ...arc,
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

/**
 * An address that is actually set: valid, non-zero and not a placeholder such as "" or "[ADDRESS]".
 * Returns the checksummed address or null, so UIs can show "not deployed yet" instead of calling address(0).
 */
export function deployedAddress(value: string | null | undefined): Address | null {
  const v = value?.trim();
  if (!v || !isAddress(v) || v.toLowerCase() === zeroAddress) return null;
  return getAddress(v);
}

/** Shape of deployments/arc-mainnet.json (only the fields the SDK and web app read). */
export const DeploymentSchema = z.object({
  network: z.string(),
  chainId: z.number().int().positive(),
  rpc: z.url(),
  explorer: z.url(),
  external: z.object({
    ArcDrawCoordinator: z.object({ address: z.string(), deployBlock: z.number().int().nonnegative() }),
  }),
  contracts: z.object({
    ArcPet: z.object({
      address: z.string(),
      deployBlock: z.number().int().nonnegative().nullable(),
      deployTx: z.string(),
      verified: z.boolean(),
    }),
  }),
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export interface ResolvedDeployment {
  chainId: number;
  /** null until ArcPet is deployed (empty / zero / placeholder address in the JSON). */
  arcPet: Address | null;
  coordinator: Address;
  explorer: string;
  rpc: string;
}

/** Parses a deployments JSON and resolves the addresses, with the zero-address/placeholder guard. */
export function resolveDeployment(json: unknown): ResolvedDeployment {
  const d = DeploymentSchema.parse(json);
  return {
    chainId: d.chainId,
    arcPet: deployedAddress(d.contracts.ArcPet.address),
    coordinator:
      deployedAddress(d.external.ArcDrawCoordinator.address) ??
      (d.chainId === ARC_MAINNET_CHAIN_ID ? ARCDRAW_COORDINATOR : zeroAddress),
    explorer: d.explorer.replace(/\/+$/, ''),
    rpc: d.rpc,
  };
}
