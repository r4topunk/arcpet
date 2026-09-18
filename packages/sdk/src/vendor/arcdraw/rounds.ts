// Vendored from arc-randomness@ad0cc7917a1b1dd7f934a8d3a9b489ca8add502d packages/sdk/src/rounds.ts. Do not edit;
// re-vendor instead (see packages/sdk/README.md). Every byte after this 2-line header matches the source.
import { COORDINATOR_LIMITS, QUICKNET } from "./constants.js";

/** Latest drand round due at unix time `t` (seconds). Mirrors `ArcDrawCoordinator.currentRound()`. */
export function roundAt(t: bigint): bigint {
  return t < QUICKNET.genesisTime ? 0n : (t - QUICKNET.genesisTime) / QUICKNET.period + 1n;
}

/** Unix time (seconds) at which `round` is published. Mirrors `roundTimestamp()`. */
export function roundTime(round: bigint): bigint {
  return round === 0n ? QUICKNET.genesisTime : QUICKNET.genesisTime + (round - 1n) * QUICKNET.period;
}

/** Earliest round a request made at `t` may pin. Mirrors `minRequestRound()`. */
export function minRequestRound(t: bigint): bigint {
  return roundAt(t) + COORDINATOR_LIMITS.minRoundDelay;
}

/** Time after which a Pending request pinned to `round` can be refunded. Mirrors `expiresAt()`. */
export function expiryTime(round: bigint): bigint {
  return roundTime(round) + COORDINATOR_LIMITS.requestTimeout;
}
