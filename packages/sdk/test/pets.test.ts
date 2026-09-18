import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTokenUri, idChunks, listPets, readPet, svgFromMetadata } from '../src/index.js';
import { makePet } from './helpers.js';
import { ARCPET, mockClient, mockState } from './mockChain.js';

const T0 = 1_789_625_579n;

describe('idChunks', () => {
  it('splits inclusive ranges', () => {
    expect(idChunks(1n, 5n, 2)).toEqual([[1n, 2n], [3n, 4n], [5n]]);
    expect(idChunks(1n, 0n, 100)).toEqual([]);
    expect(() => idChunks(1n, 3n, 0)).toThrow();
  });
});

describe('listPets (R5: tokenId iteration via multicall)', () => {
  const pets = Array.from({ length: 23 }, (_, i) =>
    makePet({ id: BigInt(i + 1), bornAt: T0 + BigInt(i), asOf: T0 + 100n }),
  );

  it('reads every id in chunks and validates each struct', async () => {
    const s = mockState(pets);
    const progress: number[] = [];
    const out = await listPets(mockClient(s), {
      arcPet: ARCPET,
      chunkSize: 10,
      onProgress: (n) => progress.push(n),
    });
    expect(out.map((p) => p.id)).toEqual(pets.map((p) => p.id));
    expect(out[4]).toEqual(pets[4]);
    expect(s.calls.filter((c) => c.to === 'multicall')).toHaveLength(3);
    expect(s.calls.filter((c) => c.fn === 'totalSupply')).toHaveLength(1);
    expect(progress).toEqual([10, 20, 23]);
  });

  it('empty collection makes one read', async () => {
    const s = mockState([]);
    expect(await listPets(mockClient(s), { arcPet: ARCPET })).toEqual([]);
    expect(s.calls).toHaveLength(1);
  });

  it('readPet', async () => {
    expect(await readPet(mockClient(mockState(pets)), { arcPet: ARCPET, id: 3n })).toEqual(pets[2]);
  });
});

describe('tokenURI decoding', () => {
  it('decodes the renderer sample (docs/samples/metadata-sample.json)', () => {
    const json = readFileSync(
      resolve(import.meta.dirname, '../../../docs/samples/metadata-sample.json'),
      'utf8',
    );
    const uri = `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
    const meta = decodeTokenUri(uri);
    expect(meta.name).toMatch(/#\d+$/);
    expect(meta.attributes.find((a) => a.trait_type === 'Status')).toBeDefined();
    expect(svgFromMetadata(meta)).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });

  it('rejects other URIs', () => {
    expect(() => decodeTokenUri('ipfs://x')).toThrow();
  });
});
