'use client';

import {
  listPets,
  type PetInfo,
  readHatchStatus,
  readPet,
  readPetOf,
  readTokenMetadata,
  readTotalSupply,
} from '@arcpet/sdk';
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { usePublicClient } from 'wagmi';
import { CHAIN_ID, config } from './config';

export function useClient() {
  return usePublicClient({ chainId: CHAIN_ID });
}

const arcPet = config.arcPet;

/** petInfo(id); refreshed every 30 s (bars tick client-side in between from the raw fields). */
export function usePet(id: bigint | null) {
  const client = useClient();
  return useQuery({
    queryKey: ['pet', arcPet, id?.toString()],
    enabled: !!client && !!arcPet && id !== null,
    refetchInterval: 30_000,
    queryFn: () => readPet(client!, { arcPet: arcPet!, id: id! }),
  });
}

/** The wallet's latest pet (any status) or null. */
export function useMyPet(owner: Address | undefined) {
  const client = useClient();
  return useQuery({
    queryKey: ['petOf', arcPet, owner],
    enabled: !!client && !!arcPet && !!owner,
    refetchInterval: 30_000,
    queryFn: () => readPetOf(client!, { arcPet: arcPet!, owner: owner! }),
  });
}

/** tokenURI; `version` (status + mood + lastFed...) re-renders the art when the pet changes. */
export function useTokenMetadata(id: bigint | null, version: string) {
  const client = useClient();
  return useQuery({
    queryKey: ['tokenURI', arcPet, id?.toString(), version],
    enabled: !!client && !!arcPet && id !== null,
    staleTime: 60_000,
    queryFn: () => readTokenMetadata(client!, { arcPet: arcPet!, id: id! }),
  });
}

/** Hatch phase of an egg; polls every 3 s while enabled. */
export function useHatchStatus(id: bigint | null, enabled: boolean) {
  const client = useClient();
  return useQuery({
    queryKey: ['hatch', arcPet, id?.toString()],
    enabled: enabled && !!client && !!arcPet && id !== null,
    refetchInterval: 3_000,
    queryFn: () => readHatchStatus(client!, { arcPet: arcPet!, coordinator: config.coordinator, id: id! }),
  });
}

/** All pets 1..totalSupply via chunked multicall (R5). */
export function useAllPets(onProgress?: (loaded: number, total: number) => void) {
  const client = useClient();
  return useQuery<{ pets: PetInfo[]; total: bigint }>({
    queryKey: ['allPets', arcPet],
    enabled: !!client && !!arcPet,
    staleTime: 30_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const total = await readTotalSupply(client!, { arcPet: arcPet! });
      const pets = await listPets(client!, {
        arcPet: arcPet!,
        totalSupply: total,
        ...(onProgress ? { onProgress } : {}),
      });
      return { pets, total };
    },
  });
}
