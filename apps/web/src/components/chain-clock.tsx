'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { getBlock } from 'viem/actions';
import { usePublicClient } from 'wagmi';
import { CHAIN_ID, config } from '@/lib/config';
import { ClockOffsetContext } from '@/lib/hooks';

/** Offsets below this are latency and block time, not a clock disagreement. */
const MIN_OFFSET_SECONDS = 5;

export function clockOffset(latestBlockTimestamp: number, localSeconds: number): number {
  const offset = Math.round(latestBlockTimestamp - localSeconds);
  return Math.abs(offset) < MIN_OFFSET_SECONDS ? 0 : offset;
}

/** Measures the chain clock once a minute and shares the offset with useNow (life and death use block.timestamp). */
export function ChainClockProvider({ children }: { children: ReactNode }) {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { data } = useQuery({
    queryKey: ['chain-clock', CHAIN_ID],
    enabled: !!client && !!config.arcPet,
    refetchInterval: 60_000,
    queryFn: async () => {
      const block = await getBlock(client!, { blockTag: 'latest' });
      return clockOffset(Number(block.timestamp), Date.now() / 1000);
    },
  });
  return <ClockOffsetContext.Provider value={data ?? 0}>{children}</ClockOffsetContext.Provider>;
}
