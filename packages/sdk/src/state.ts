// TypeScript mirror of ArcPet.petInfo's derived fields (ArcPet.sol `petInfo`, `_status`, `_deathAt`; SPEC §2-§3).
// Lets the front end tick bars every second from one petInfo read, without trusting any state of its own:
// `petStateAt(info, t)` equals what `petInfo` would return in a block with timestamp `t`.
import { LOW_STAT_THRESHOLD, STAT_MAX } from './constants.js';
import { deathAt as deathAtOf, Mood, moodOf, type PetInfo, Status, statAt } from './pet.js';

/** The stored (raw) part of PetInfo: everything petInfo does not derive from `block.timestamp`. */
export type PetRaw = Pick<
  PetInfo,
  'genes' | 'bornAt' | 'diedAt' | 'lastFed' | 'lastPlayed' | 'hungerWindow' | 'playWindow'
>;

/** The fields petInfo derives at a timestamp. */
export interface PetState {
  asOf: bigint;
  status: Status;
  mood: Mood;
  /** 0 for eggs. */
  deathAt: bigint;
  /** Seconds. 0 for eggs; frozen at `deathAt - bornAt` once dead. */
  age: bigint;
  hunger: number;
  happiness: number;
  species: number;
  palette: number;
  eyes: number;
  /** `status === Alive` (ArcPet.isAlive). */
  isAlive: boolean;
}

/** ArcPet `_status`: Egg until genes, Buried once `diedAt` is written, else Alive strictly before deathAt. */
export function statusAt(p: PetRaw, now: bigint): Status {
  if (p.bornAt === 0n) return Status.Egg;
  if (p.diedAt !== 0n) return Status.Buried;
  return now < deathAtOf(p.lastFed, p.lastPlayed, p.hungerWindow, p.playWindow) ? Status.Alive : Status.Dead;
}

/** ArcPet.petInfo's derived fields at unix time `now` (seconds). */
export function petStateAt(p: PetRaw, now: bigint): PetState {
  const status = statusAt(p, now);
  if (status === Status.Egg) {
    return {
      asOf: now,
      status,
      mood: Mood.Egg,
      deathAt: 0n,
      age: 0n,
      hunger: STAT_MAX,
      happiness: STAT_MAX,
      species: 0,
      palette: 0,
      eyes: 0,
      isAlive: false,
    };
  }
  const d = deathAtOf(p.lastFed, p.lastPlayed, p.hungerWindow, p.playWindow);
  const hunger = statAt(p.lastFed, p.hungerWindow, now);
  const happiness = statAt(p.lastPlayed, p.playWindow, now);
  const g = BigInt(p.genes);
  return {
    asOf: now,
    status,
    mood: moodOf(status, hunger, happiness),
    deathAt: d,
    age: (status === Status.Alive ? now : d) - p.bornAt,
    hunger,
    happiness,
    species: Number(g & 0x3n),
    palette: Number((g >> 2n) & 0x7n),
    eyes: Number((g >> 5n) & 0x3n),
    isAlive: status === Status.Alive,
  };
}

/** A PetInfo re-evaluated at `now`: raw fields kept, derived fields recomputed. */
export function livePet(info: PetInfo, now: bigint): PetInfo {
  const { isAlive: _ignored, ...state } = petStateAt(info, now);
  return { ...info, ...state };
}

/** ArcPet.isAlive at `now`. */
export function isAliveAt(p: PetRaw, now: bigint): boolean {
  return statusAt(p, now) === Status.Alive;
}

/**
 * First unix second at which `statAt(last, window, t) < threshold`, e.g. when a pet turns Hungry (threshold 30).
 * statAt < thr  <=>  floor(100 * e / w) >= 101 - thr  <=>  e >= ceil((101 - thr) * w / 100).
 */
export function statBelowAt(last: bigint, window: number, threshold = LOW_STAT_THRESHOLD): bigint {
  if (threshold > STAT_MAX) return last + 1n;
  if (threshold <= 0) throw new RangeError('threshold must be > 0 (a stat is never below 0)');
  const num = BigInt(STAT_MAX + 1 - threshold) * BigInt(window);
  const e = (num + BigInt(STAT_MAX) - 1n) / BigInt(STAT_MAX);
  // statAt returns 100 for t <= last, so the earliest candidate is last + 1.
  return last + (e < 1n ? 1n : e);
}

/** Seconds left until death at `now` (0 when already dead or an egg). */
export function secondsToDeath(p: PetRaw, now: bigint): bigint {
  if (statusAt(p, now) !== Status.Alive) return 0n;
  return deathAtOf(p.lastFed, p.lastPlayed, p.hungerWindow, p.playWindow) - now;
}

/** Ranking "oldest alive" (D12): Alive pets at `now`, oldest first, ties by lower id. */
export function rankOldestAlive(pets: readonly PetInfo[], now: bigint): PetInfo[] {
  return pets
    .map((p) => livePet(p, now))
    .filter((p) => p.status === Status.Alive)
    .sort(byAgeDescThenId);
}

/** Graveyard (D12): Dead or Buried pets at `now`, longest life first, ties by lower id. */
export function graveyard(pets: readonly PetInfo[], now: bigint): PetInfo[] {
  return pets
    .map((p) => livePet(p, now))
    .filter((p) => p.status === Status.Dead || p.status === Status.Buried)
    .sort(byAgeDescThenId);
}

function byAgeDescThenId(a: PetInfo, b: PetInfo): number {
  if (a.age !== b.age) return a.age > b.age ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
