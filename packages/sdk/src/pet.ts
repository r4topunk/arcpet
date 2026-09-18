// TypeScript mirror of PetLib.sol. Every function must return exactly what the contract returns (SPEC §3-§5).
import type { Address, Hex } from 'viem';
import { z } from 'zod';
import {
  BASE_HUNGER_WINDOW,
  BASE_PLAY_WINDOW,
  BPS,
  LOW_STAT_THRESHOLD,
  MAX_NAME_LENGTH,
  MIN_MULTIPLIER_BPS,
  MULTIPLIER_SPAN_BPS,
  STAT_MAX,
} from './constants.js';

/** Solidity IArcPet.Status. */
export const Status = { None: 0, Egg: 1, Alive: 2, Dead: 3, Buried: 4 } as const;
export type Status = (typeof Status)[keyof typeof Status];

/** Solidity IArcPet.Mood. */
export const Mood = { Egg: 0, Happy: 1, Hungry: 2, Sad: 3, Tomb: 4 } as const;
export type Mood = (typeof Mood)[keyof typeof Mood];

const uint = z.bigint().nonnegative();
const u8 = z.number().int().min(0).max(255);

/** IArcPet.PetInfo as decoded by viem (uint64/uint256 -> bigint, uint8/uint32 -> number). */
export const PetInfoSchema = z.object({
  id: uint,
  owner: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((s) => s as Address),
  name: z.string(),
  genes: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .transform((s) => s as Hex),
  requestId: uint,
  laidAt: uint,
  bornAt: uint,
  lastFed: uint,
  lastPlayed: uint,
  diedAt: uint,
  hungerWindow: z.number().int().nonnegative(),
  playWindow: z.number().int().nonnegative(),
  asOf: uint,
  status: z
    .number()
    .int()
    .min(0)
    .max(4)
    .transform((n) => n as Status),
  mood: z
    .number()
    .int()
    .min(0)
    .max(4)
    .transform((n) => n as Mood),
  deathAt: uint,
  age: uint,
  hunger: u8,
  happiness: u8,
  species: u8,
  palette: u8,
  eyes: u8,
});
export type PetInfo = z.output<typeof PetInfoSchema>;

export interface DecodedGenes {
  species: number;
  palette: number;
  eyes: number;
  hungerWindow: number;
  playWindow: number;
}

const multiplierBps = (gene: bigint): bigint =>
  BigInt(MIN_MULTIPLIER_BPS) + (gene * BigInt(MULTIPLIER_SPAN_BPS)) / 255n;

/** Gene layout D10 (SPEC §4). `genes` is the 0x-prefixed bytes32. */
export function decodeGenes(genes: `0x${string}`): DecodedGenes {
  const g = BigInt(genes);
  return {
    species: Number(g & 0x3n),
    palette: Number((g >> 2n) & 0x7n),
    eyes: Number((g >> 5n) & 0x3n),
    hungerWindow: Number((BigInt(BASE_HUNGER_WINDOW) * multiplierBps((g >> 8n) & 0xffn)) / BigInt(BPS)),
    playWindow: Number((BigInt(BASE_PLAY_WINDOW) * multiplierBps((g >> 16n) & 0xffn)) / BigInt(BPS)),
  };
}

/** PetLib.statAt: 100 - floor(100 * elapsed / window), 0 once elapsed >= window. */
export function statAt(last: bigint, window: number, now: bigint): number {
  if (now <= last) return STAT_MAX;
  const elapsed = now - last;
  if (elapsed >= BigInt(window)) return 0;
  return STAT_MAX - Number((BigInt(STAT_MAX) * elapsed) / BigInt(window));
}

/** PetLib.deathAt: min(lastFed + TH, lastPlayed + TP). */
export function deathAt(lastFed: bigint, lastPlayed: bigint, th: number, tp: number): bigint {
  const a = lastFed + BigInt(th);
  const b = lastPlayed + BigInt(tp);
  return a < b ? a : b;
}

/** PetLib.moodOf. */
export function moodOf(status: Status, hunger: number, happiness: number): Mood {
  if (status === Status.Egg || status === Status.None) return Mood.Egg;
  if (status !== Status.Alive) return Mood.Tomb;
  if (hunger < LOW_STAT_THRESHOLD) return Mood.Hungry;
  if (happiness < LOW_STAT_THRESHOLD) return Mood.Sad;
  return Mood.Happy;
}

/** PetLib.isValidName: 1..20 bytes of 0x20..0x7E except `"` `&` `<` `>` `\`. */
export function isValidName(name: string): boolean {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length === 0 || bytes.length > MAX_NAME_LENGTH) return false;
  for (const c of bytes) {
    if (c < 0x20 || c > 0x7e) return false;
    if (c === 0x22 || c === 0x26 || c === 0x3c || c === 0x3e || c === 0x5c) return false;
  }
  return true;
}
