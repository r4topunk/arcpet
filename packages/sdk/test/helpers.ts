import { type Address, zeroAddress } from 'viem';
import { type PetInfo, PetInfoSchema, petStateAt } from '../src/index.js';

/** A pet born at `bornAt` with windows th/tp, last fed/played at the given times, evaluated at `asOf`. */
export function makePet(o: {
  id: bigint;
  bornAt?: bigint;
  lastFed?: bigint;
  lastPlayed?: bigint;
  diedAt?: bigint;
  th?: number;
  tp?: number;
  asOf?: bigint;
  owner?: Address;
  name?: string;
}): PetInfo {
  const bornAt = o.bornAt ?? 0n;
  const raw = {
    genes: `0x${'00'.repeat(31)}${bornAt === 0n ? '00' : '2d'}` as const,
    bornAt,
    diedAt: o.diedAt ?? 0n,
    lastFed: o.lastFed ?? bornAt,
    lastPlayed: o.lastPlayed ?? bornAt,
    hungerWindow: bornAt === 0n ? 0 : (o.th ?? 86_400),
    playWindow: bornAt === 0n ? 0 : (o.tp ?? 172_800),
  };
  const asOf = o.asOf ?? bornAt;
  const { isAlive: _a, ...state } = petStateAt(raw, asOf);
  return PetInfoSchema.parse({
    id: o.id,
    owner: o.owner ?? zeroAddress,
    name: o.name ?? `pet${o.id}`,
    requestId: o.id,
    laidAt: bornAt === 0n ? asOf : bornAt - 12n,
    ...raw,
    ...state,
  });
}
