'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/** False during the static render and the first client render, true after mount (avoids hydration mismatches). */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Seconds to add to the local clock to get the chain's clock. ArcPet decides life and death with block.timestamp, so
 * bars and countdowns follow the chain when the two disagree. 0 by default.
 */
export const ClockOffsetContext = createContext(0);

/** Current unix time (seconds, chain clock) as bigint, ticking every `intervalMs`. Null until mounted. */
export function useNow(intervalMs = 1_000): bigint | null {
  const offset = useContext(ClockOffsetContext);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now === null ? null : BigInt(now + offset);
}
