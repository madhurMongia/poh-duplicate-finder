import { describe, expect, it } from 'vitest';
import { InMemoryBlobStore } from '../src/blobstore.js';
import { encodeIndex } from '../src/codec.js';
import { DEFAULT_INDEX_BLOB_KEY } from '../src/constants.js';
import {
  createCachedIndexLoader,
  LookupError,
  parseProfileRef,
  performLookup,
  type LookupDeps,
} from '../src/lookup.js';
import type { FaceIndex } from '../src/types.js';
import {
  buildIndex,
  FakeIpfs,
  FakePipeline,
  FakeSubgraph,
  makeEntry,
  unitVector,
} from './helpers.js';

const H1 = '0x' + 'a'.repeat(40);
const H2 = '0x' + 'b'.repeat(40);
const H3 = '0x' + 'c'.repeat(40);

function registryIndex(): FaceIndex {
  return buildIndex(
    [
      makeEntry({ humanityId: H1, requestId: '0xr1' }),
      makeEntry({ humanityId: H2, requestId: '0xr2', status: 'expired', name: 'Bob' }),
      makeEntry({ humanityId: H3, requestId: '0xr3', chain: 'mainnet' }),
    ],
    [unitVector(0), unitVector(1), unitVector(2)],
    { builtAt: 1_750_000_000, checkpoints: { gnosis: 300 } },
  );
}

function setup(withIndex = true) {
  const subgraph = new FakeSubgraph(['gnosis']);
  const ipfs = new FakeIpfs();
  const pipeline = new FakePipeline();
  const deps: LookupDeps = {
    loadIndex: async () => (withIndex ? registryIndex() : null),
    subgraph,
    ipfs,
    pipeline,
  };
  return { deps, subgraph, ipfs, pipeline };
}

const photo = (key: string) => new TextEncoder().encode(key);

describe('performLookup with a photo', () => {
  it('ranks the registry against the uploaded photo', async () => {
    const { deps, pipeline } = setup();
    pipeline.onEmbedding('query', unitVector(1));

    const res = await performLookup(deps, { kind: 'photo', bytes: photo('query') });
    expect(res.ok).toBe(true);
    expect(res.matches).toHaveLength(3);
    expect(res.matches[0]).toMatchObject({
      humanityId: H2,
      name: 'Bob',
      status: 'expired',
      band: 'likely-same',
      profileUrl: `https://v2.proofofhumanity.id/${H2}`,
    });
    expect(res.matches[0].score).toBeGreaterThan(0.999);
    expect(res.matches[1].band).toBe('different');
    expect(res.query).toEqual({ humanityId: undefined, faceCount: 1, detScore: 0.9 });
    expect(res.index).toEqual({ count: 3, builtAt: 1_750_000_000 });
  });

  it('propagates embedding failures as typed errors', async () => {
    const { deps } = setup();
    await expect(
      performLookup(deps, { kind: 'photo', bytes: photo('unmapped') }),
    ).rejects.toMatchObject({ code: 'NO_FACE' });
  });
});

describe('performLookup with a profile reference', () => {
  it('resolves the profile photo and excludes the profile itself from matches', async () => {
    const { deps, subgraph, ipfs, pipeline } = setup();
    subgraph.profiles.set(H2, {
      humanityId: H2,
      chain: 'gnosis',
      evidenceUri: '/ipfs/evq',
    });
    ipfs.setJson('/ipfs/evq', { photo: '/ipfs/photoq' }).setBytes('/ipfs/photoq', 'query');
    pipeline.onEmbedding('query', unitVector(1));

    const res = await performLookup(deps, { kind: 'profile', ref: H2.toUpperCase() });
    expect(res.query.humanityId).toBe(H2);
    expect(res.matches.every((m) => m.humanityId !== H2)).toBe(true);
  });

  it('fails typed for unknown profiles, malformed refs, and broken photos', async () => {
    const { deps, subgraph } = setup();
    await expect(
      performLookup(deps, { kind: 'profile', ref: '0x' + 'e'.repeat(40) }),
    ).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });

    await expect(performLookup(deps, { kind: 'profile', ref: 'hello' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    subgraph.profiles.set(H1, { humanityId: H1, chain: 'gnosis', evidenceUri: null });
    await expect(performLookup(deps, { kind: 'profile', ref: H1 })).rejects.toMatchObject({
      code: 'PHOTO_FETCH_FAILED',
    });
  });
});

describe('performLookup index handling', () => {
  it('fails when the loader has no index', async () => {
    const { deps } = setup(false);
    const err = await performLookup(deps, { kind: 'photo', bytes: photo('q') }).catch((e) => e);
    expect(err).toBeInstanceOf(LookupError);
    expect(err.code).toBe('INDEX_UNAVAILABLE');
  });

  it('fails typed when the index was built with an old model', async () => {
    const staleIndex = registryIndex();
    staleIndex.header.modelId = 'old-model@1';
    const { deps } = setup();
    deps.loadIndex = async () => staleIndex;

    const err = await performLookup(deps, { kind: 'photo', bytes: photo('q') }).catch((e) => e);
    expect(err).toBeInstanceOf(LookupError);
    expect(err).toMatchObject({
      code: 'INDEX_UNAVAILABLE',
      message: expect.stringContaining('run indexer bootstrap'),
    });
  });
});

describe('createCachedIndexLoader', () => {
  it('returns null until the blob exists, then caches the decode for ttlMs', async () => {
    const blobs = new InMemoryBlobStore();
    let t = 0;
    const loader = createCachedIndexLoader(blobs, { ttlMs: 100, now: () => t });

    expect(await loader()).toBeNull(); // missing blob is never cached

    await blobs.set(DEFAULT_INDEX_BLOB_KEY, encodeIndex(registryIndex()));
    expect((await loader())?.header.count).toBe(3);

    const updated = registryIndex();
    updated.header.builtAt = 9_999;
    await blobs.set(DEFAULT_INDEX_BLOB_KEY, encodeIndex(updated));
    t = 50; // cache still fresh -> old build
    expect((await loader())?.header.builtAt).toBe(1_750_000_000);
    t = 150; // ttl expired -> refetch
    expect((await loader())?.header.builtAt).toBe(9_999);
  });
});

describe('parseProfileRef', () => {
  it('extracts a pohId/address from raw input or profile URLs', () => {
    expect(parseProfileRef(`https://v2.proofofhumanity.id/${H1}`)).toBe(H1);
    expect(
      parseProfileRef(`https://v2.proofofhumanity.id/${H1.slice(2).toUpperCase()}/gnosis/0`),
    ).toBe(H1);
    expect(parseProfileRef(H2.toUpperCase())).toBe(H2);
    expect(parseProfileRef(H3.slice(2).toUpperCase())).toBe(H3);
    expect(parseProfileRef('not a ref')).toBeNull();
  });
});
