import { describe, expect, it } from 'vitest';
import {
  graveyard,
  LOW_STAT_THRESHOLD,
  livePet,
  Mood,
  rankOldestAlive,
  Status,
  secondsToDeath,
  statAt,
  statBelowAt,
  statusAt,
} from '../src/index.js';
import { makePet } from './helpers.js';

const T0 = 1_789_625_579n;

describe('petStateAt / livePet', () => {
  it('egg: full stats, no death, no age, not alive', () => {
    const egg = livePet(makePet({ id: 1n, asOf: T0 }), T0 + 10_000_000n);
    expect(egg.status).toBe(Status.Egg);
    expect(egg.mood).toBe(Mood.Egg);
    expect([egg.hunger, egg.happiness, egg.deathAt, egg.age]).toEqual([100, 100, 0n, 0n]);
  });

  it('dies exactly at deathAt (no grace second) and freezes age', () => {
    const p = makePet({ id: 1n, bornAt: T0, th: 1000, tp: 5000 });
    const d = T0 + 1000n;
    expect(livePet(p, d - 1n).status).toBe(Status.Alive);
    expect(livePet(p, d - 1n).hunger).toBe(1);
    const dead = livePet(p, d);
    expect(dead.status).toBe(Status.Dead);
    expect(dead.mood).toBe(Mood.Tomb);
    expect(dead.age).toBe(1000n);
    expect(livePet(p, d + 99_999n).age).toBe(1000n);
    expect(secondsToDeath(p, d - 5n)).toBe(5n);
    expect(secondsToDeath(p, d)).toBe(0n);
  });

  it('buried wins over the clock', () => {
    const p = makePet({ id: 1n, bornAt: T0, th: 1000, diedAt: T0 + 1000n, asOf: T0 + 2000n });
    expect(statusAt(p, T0 + 1n)).toBe(Status.Buried);
  });
});

describe('statBelowAt', () => {
  it('is the first second the stat drops below the threshold (brute force)', () => {
    for (const window of [100, 777, 69_120, 103_680, 207_360]) {
      for (const thr of [1, 30, 50, 100]) {
        const t = statBelowAt(T0, window, thr);
        expect(statAt(T0, window, t), `w=${window} thr=${thr}`).toBeLessThan(thr);
        expect(statAt(T0, window, t - 1n), `w=${window} thr=${thr}`).toBeGreaterThanOrEqual(thr);
      }
    }
    // Hungry threshold default; threshold 1 is exactly death of that stat.
    expect(statBelowAt(T0, 1000)).toBe(statBelowAt(T0, 1000, LOW_STAT_THRESHOLD));
    expect(statBelowAt(T0, 1000, 1)).toBe(T0 + 1000n);
  });
});

describe('ranking and graveyard', () => {
  const now = T0 + 500_000n;
  const pets = [
    makePet({ id: 1n, bornAt: T0, lastFed: now - 10n, lastPlayed: now - 10n }), // alive, oldest
    makePet({ id: 2n, bornAt: T0 + 100n, lastFed: now - 10n, lastPlayed: now - 10n }), // alive
    makePet({ id: 3n, bornAt: T0, th: 1000 }), // dead (unburied), age 1000
    makePet({ id: 4n, bornAt: T0, th: 5000, diedAt: T0 + 5000n }), // buried, age 5000
    makePet({ id: 5n, asOf: now }), // egg
    makePet({ id: 6n, bornAt: T0 + 100n, lastFed: now - 10n, lastPlayed: now - 10n }), // alive, ties with 2
  ];

  it('oldest alive first, ties by id', () => {
    expect(rankOldestAlive(pets, now).map((p) => p.id)).toEqual([1n, 2n, 6n]);
  });

  it('graveyard: dead and buried, longest life first', () => {
    const g = graveyard(pets, now);
    expect(g.map((p) => p.id)).toEqual([4n, 3n]);
    expect(g.map((p) => p.status)).toEqual([Status.Buried, Status.Dead]);
  });
});
