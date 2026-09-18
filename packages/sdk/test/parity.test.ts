// Parity: the TypeScript mirror against outputs of the real Solidity (PetLib + ArcPet.petInfo), recorded by
// contracts/script/SdkVectors.s.sol into test/fixtures/parity.json. Regenerate with `pnpm contracts:vectors`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hexToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  deathAt,
  decodeGenes,
  isAliveAt,
  isValidName,
  moodOf,
  type PetInfo,
  PetInfoSchema,
  petStateAt,
  type Status,
  statAt,
} from '../src/index.js';

type Row = Record<string, string>;
const fx = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/parity.json'), 'utf8')) as {
  genes: Row[];
  statAt: Row[];
  deathAt: Row[];
  mood: Row[];
  names: { bytes: `0x${string}`; valid: boolean }[];
  petInfo: Row[];
};

function toPetInfo(r: Row): PetInfo {
  return PetInfoSchema.parse({
    id: BigInt(r.id!),
    owner: r.owner,
    name: r.name,
    genes: r.genes,
    requestId: BigInt(r.requestId!),
    laidAt: BigInt(r.laidAt!),
    bornAt: BigInt(r.bornAt!),
    lastFed: BigInt(r.lastFed!),
    lastPlayed: BigInt(r.lastPlayed!),
    diedAt: BigInt(r.diedAt!),
    hungerWindow: Number(r.hungerWindow),
    playWindow: Number(r.playWindow),
    asOf: BigInt(r.asOf!),
    status: Number(r.status),
    mood: Number(r.mood),
    deathAt: BigInt(r.deathAt!),
    age: BigInt(r.age!),
    hunger: Number(r.hunger),
    happiness: Number(r.happiness),
    species: Number(r.species),
    palette: Number(r.palette),
    eyes: Number(r.eyes),
  });
}

describe('parity with Solidity (contracts/script/SdkVectors.s.sol)', () => {
  it('has vectors', () => {
    expect(fx.genes.length).toBeGreaterThan(50);
    expect(fx.statAt.length).toBeGreaterThan(100);
    expect(fx.mood.length).toBe(125);
    expect(fx.petInfo.length).toBeGreaterThan(20);
  });

  it.each(fx.genes)('decodeGenes($genes)', (v) => {
    const g = decodeGenes(v.genes as `0x${string}`);
    expect(g).toEqual({
      species: Number(v.species),
      palette: Number(v.palette),
      eyes: Number(v.eyes),
      hungerWindow: Number(v.hungerWindow),
      playWindow: Number(v.playWindow),
    });
  });

  it('statAt', () => {
    for (const v of fx.statAt) {
      expect(statAt(BigInt(v.last!), Number(v.window), BigInt(v.now!)), JSON.stringify(v)).toBe(
        Number(v.value),
      );
    }
  });

  it('deathAt', () => {
    for (const v of fx.deathAt) {
      expect(deathAt(BigInt(v.lastFed!), BigInt(v.lastPlayed!), Number(v.th), Number(v.tp))).toBe(
        BigInt(v.deathAt!),
      );
    }
  });

  it('moodOf', () => {
    for (const v of fx.mood) {
      expect(
        moodOf(Number(v.status) as Status, Number(v.hunger), Number(v.happiness)),
        JSON.stringify(v),
      ).toBe(Number(v.mood));
    }
  });

  it('isValidName', () => {
    for (const v of fx.names) {
      const s = new TextDecoder().decode(hexToBytes(v.bytes));
      expect(isValidName(s), v.bytes).toBe(v.valid);
    }
  });

  it('petStateAt(raw, asOf) reproduces every petInfo snapshot of a scripted life', () => {
    const statuses = new Set<number>();
    for (const r of fx.petInfo) {
      const onchain = toPetInfo(r);
      statuses.add(onchain.status);
      const { isAlive, ...state } = petStateAt(onchain, onchain.asOf);
      expect({ ...onchain, ...state }, `pet ${r.id} at ${r.asOf}`).toEqual(onchain);
      expect(isAlive).toBe(r.isAlive === 'true');
      expect(isAliveAt(onchain, onchain.asOf)).toBe(r.isAlive === 'true');
    }
    // The scripted life covers Egg, Alive, Dead and Buried.
    expect([...statuses].sort()).toEqual([1, 2, 3, 4]);
  });
});
