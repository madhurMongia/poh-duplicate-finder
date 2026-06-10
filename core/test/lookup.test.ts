import { describe, expect, it } from 'vitest';
import { InMemoryBlobStore } from '../src/blobstore.js';
import { encodeIndex } from '../src/codec.js';
import { DEFAULT_INDEX_BLOB_KEY, EMBEDDING_DIMS } from '../src/constants.js';
import { LookupError, parseProfileRef, performLookup, type LookupDeps } from '../src/lookup.js';
import type { FaceIndex } from '../src/types.js';
import { FakeIpfs, FakePipeline, FakeSubgraph, makeEntry, unitVector } from './helpers.js';

const H1 = '0x' + 'a'.repeat(40);
const H2 = '0x' + 'b'.repeat(40);
const H3 = '0x' + 'c'.repeat(40);

function registryIndex(): FaceIndex {
  const rows = [unitVector(0), unitVector(1), unitVector(2)];
  const vectors = new Float32Array(rows.length * EMBEDDING_DIMS);
  rows.forEach((r, i) => vectors.set(r, i * EMBEDDING_DIMS));
  return {
    header: {
      version: 1,
      modelId: 'fake-model@1',
      dims: EMBEDDING_DIMS,
      count: 3,
      builtAt: 1_750_000_000,
      checkpoints: { gnosis: 300 },
      retries: [],
      entries: [
        makeEntry({ humanityId: H1, requestId: '0xr1' }),
        makeEntry({ humanityId: H2, requestId: '0xr2', status: 'expired', name: 'Bob' }),
        makeEntry({ humanityId: H3, requestId: '0xr3', chain: 'mainnet' }),
      ],
    },
    vectors,
  };
}

async function setup(withIndex = true) {
  const blobs = new InMemoryBlobStore();
  if (withIndex) await blobs.set(DEFAULT_INDEX_BLOB_KEY, encodeIndex(registryIndex()));
  const subgraph = new FakeSubgraph(['gnosis']);
  const ipfs = new FakeIpfs();
  const pipeline = new FakePipeline();
  const deps: LookupDeps = { blobs, subgraph, ipfs, pipeline };
  return { deps, blobs, subgraph, ipfs, pipeline };
}

const photo = (key: string) => new TextEncoder().encode(key);

describe('performLookup with a photo', () => {
  it('ranks the registry against the uploaded photo', async () => {
    const { deps, pipeline } = await setup();
    pipeline.onEmbedding('query', unitVector(1));

    const res = await performLookup(deps, { kind: 'photo', bytes: photo('query') });
    expect(res.ok).toBe(true);
    expect(res.matches).toHaveLength(3);
    expect(res.matches[0]).toMatchObject({
      humanityId: H2,
      name: 'Bob',
      status: 'expired',
      band: 'likely-same',
      renewal: false,
      profileUrl: `https://v2.proofofhumanity.id/${H2}`,
    });
    expect(res.matches[0].score).toBeGreaterThan(0.999);
    expect(res.matches[1].band).toBe('different');
    expect(res.query).toEqual({ humanityId: undefined, faceCount: 1, detScore: 0.9 });
    expect(res.index).toEqual({ count: 3, builtAt: 1_750_000_000 });
  });

  it('propagates embedding failures as typed errors', async () => {
    const { deps } = await setup();
    await expect(
      performLookup(deps, { kind: 'photo', bytes: photo('unmapped') }),
    ).rejects.toMatchObject({ code: 'NO_FACE' });
  });
});

describe('performLookup with a profile reference', () => {
  it('resolves the profile photo and flags the profile itself as a renewal', async () => {
    const { deps, subgraph, ipfs, pipeline } = await setup();
    subgraph.profiles.set(H2, {
      humanityId: H2,
      chain: 'gnosis',
      evidenceUri: '/ipfs/evq',
    });
    ipfs.setJson('/ipfs/evq', { photo: '/ipfs/photoq' }).setBytes('/ipfs/photoq', 'query');
    pipeline.onEmbedding('query', unitVector(1));

    const res = await performLookup(deps, { kind: 'profile', ref: H2.toUpperCase() });
    expect(res.query.humanityId).toBe(H2);
    expect(res.matches[0]).toMatchObject({ humanityId: H2, renewal: true });
    expect(res.matches.slice(1).every((m) => !m.renewal)).toBe(true);
  });

  it('fails typed for unknown profiles, malformed refs, and broken photos', async () => {
    const { deps, subgraph } = await setup();
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
  it('fails when no index blob exists', async () => {
    const { deps } = await setup(false);
    const err = await performLookup(deps, { kind: 'photo', bytes: photo('q') }).catch((e) => e);
    expect(err).toBeInstanceOf(LookupError);
    expect(err.code).toBe('INDEX_UNAVAILABLE');
  });
});

describe('parseProfileRef', () => {
  it('extracts a pohId/address from raw input or profile URLs', () => {
    expect(parseProfileRef(`https://v2.proofofhumanity.id/${H1}`)).toBe(H1);
    expect(parseProfileRef(H2.toUpperCase())).toBe(H2);
    expect(parseProfileRef('not a ref')).toBeNull();
  });
});
