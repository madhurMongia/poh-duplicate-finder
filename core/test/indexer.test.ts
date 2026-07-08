import { describe, expect, it } from 'vitest';
import { InMemoryBlobStore } from '../src/blobstore.js';
import { decodeIndex, emptyIndex, encodeIndex } from '../src/codec.js';
import { DEFAULT_INDEX_BLOB_KEY } from '../src/constants.js';
import { runIndexer, type IndexerDeps } from '../src/indexer.js';
import { FakeIpfs, FakePipeline, FakeSubgraph, unitVector } from './helpers.js';

const H = (c: string) => '0x' + c.repeat(40);

function fixtures() {
  const subgraph = new FakeSubgraph(['gnosis']);
  subgraph.requestsByChain.gnosis = [
    {
      requestId: '0xr1',
      humanityId: H('1'),
      creationTime: 100,
      name: 'Ada',
      evidenceUri: '/ipfs/ev1',
    },
    { requestId: '0xr2', humanityId: H('2'), creationTime: 200, evidenceUri: '/ipfs/ev2' },
    { requestId: '0xr3', humanityId: H('3'), creationTime: 300, evidenceUri: '/ipfs/ev3' },
  ];
  subgraph.statusByChain.gnosis = [
    {
      requestId: '0xr1',
      statusId: 'resolved',
      winnerPartyId: null,
      requestExpirationTime: 9_999,
      humanityHasRegistration: true,
      registrationExpirationTime: 9_999,
    },
    {
      requestId: '0xr2',
      statusId: 'resolved',
      winnerPartyId: 'challenger',
      requestExpirationTime: null,
      humanityHasRegistration: false,
      registrationExpirationTime: null,
    },
  ];

  const ipfs = new FakeIpfs()
    // r1: evidence -> fileURI -> registration -> photo
    .setJson('/ipfs/ev1', { fileURI: '/ipfs/file1' })
    .setJson('/ipfs/file1', { photo: '/ipfs/photo1' })
    .setBytes('/ipfs/photo1', 'p1')
    // r2: evidence embeds the photo directly; photo fetch fails once
    .setJson('/ipfs/ev2', { photo: '/ipfs/photo2' })
    .setBytes('/ipfs/photo2', 'p2')
    .failTimes('/ipfs/photo2', 1)
    // r3: resolvable photo but no face in it
    .setJson('/ipfs/ev3', { photo: '/ipfs/photo3' })
    .setBytes('/ipfs/photo3', 'p3');

  const pipeline = new FakePipeline()
    .onEmbedding('p1', unitVector(0))
    .onEmbedding('p2', unitVector(1));

  const blobs = new InMemoryBlobStore();
  const deps: IndexerDeps = { blobs, subgraph, ipfs, pipeline, now: () => 1_000 };
  return { deps, blobs, subgraph, ipfs, pipeline };
}

async function readIndex(blobs: InMemoryBlobStore) {
  const blob = await blobs.get(DEFAULT_INDEX_BLOB_KEY);
  expect(blob).not.toBeNull();
  return decodeIndex(blob!);
}

describe('runIndexer', () => {
  it('bootstraps, records failures for retry, refreshes statuses, advances checkpoints', async () => {
    const { deps, blobs } = fixtures();
    const summary = await runIndexer(deps);

    // r2's photo fetch failed (retryable); r3 had no face (discarded outright).
    expect(summary).toMatchObject({ total: 1, added: 1, failed: 1, discarded: 1 });
    expect(summary.checkpoints.gnosis).toBe(300);

    const index = await readIndex(blobs);
    expect(index.header.entries).toHaveLength(1);
    expect(index.header.entries[0]).toMatchObject({
      requestId: '0xr1',
      humanityId: H('1'),
      photoUri: '/ipfs/photo1',
      name: 'Ada',
      status: 'registered', // refreshed from the snapshot
    });
    expect(index.header.builtAt).toBe(1_000);
    expect(index.header.retries.map((r) => r.requestId)).toEqual(['0xr2']);
    expect(index.header.retries[0].attempts).toBe(1);
  });

  it('on the next run recovers retryable photos; faceless profiles stay discarded', async () => {
    const { deps, blobs, pipeline } = fixtures();
    await runIndexer(deps);
    const summary = await runIndexer(deps);

    expect(summary).toMatchObject({ total: 2, added: 1, failed: 0, discarded: 0 });
    const index = await readIndex(blobs);
    expect(index.header.entries.map((e) => e.requestId)).toEqual(['0xr1', '0xr2']);
    expect(index.header.entries[1].status).toBe('rejected'); // lost to a challenger, kept anyway
    expect(index.header.retries).toEqual([]);
    // r3's photo was embedded exactly once; the discard is permanent.
    expect(pipeline.calls.filter((c) => c === 'p3')).toHaveLength(1);
  });

  it('keeps rows that have no registration evidence visible in retries', async () => {
    const subgraph = new FakeSubgraph(['gnosis']);
    subgraph.requestsByChain.gnosis = [
      { requestId: '0xempty', humanityId: H('4'), creationTime: 400, evidenceUri: null },
    ];
    const blobs = new InMemoryBlobStore();
    const deps: IndexerDeps = {
      blobs,
      subgraph,
      ipfs: new FakeIpfs(),
      pipeline: new FakePipeline(),
      now: () => 1_000,
    };

    const summary = await runIndexer(deps);
    expect(summary).toMatchObject({ total: 0, added: 0, failed: 1, retriesPending: 1 });
    expect(summary.checkpoints.gnosis).toBe(400);
    expect((await readIndex(blobs)).header.retries).toEqual([
      expect.objectContaining({ requestId: '0xempty', lastError: 'no registration evidence' }),
    ]);
  });

  it('never re-adds known requests when the subgraph repeats them', async () => {
    const { deps, subgraph, blobs } = fixtures();
    await runIndexer(deps);
    await runIndexer(deps);
    // Same request id reappears with a later timestamp (e.g. cursor overlap).
    subgraph.requestsByChain.gnosis = [
      { requestId: '0xr1', humanityId: H('1'), creationTime: 400, evidenceUri: '/ipfs/ev1' },
    ];
    const summary = await runIndexer(deps);
    expect(summary.added).toBe(0);
    expect(summary.checkpoints.gnosis).toBe(400);
    expect((await readIndex(blobs)).header.entries).toHaveLength(2);
  });

  it('caps new work with maxItems and resumes the remainder next run', async () => {
    const { deps, blobs } = fixtures();
    // Only the oldest new request (r1@100) should be processed; the checkpoint
    // must not advance past it, leaving r2/r3 for later.
    const first = await runIndexer(deps, { maxItems: 1 });
    expect(first).toMatchObject({ total: 1, added: 1 });
    expect(first.checkpoints.gnosis).toBe(100);
    expect((await readIndex(blobs)).header.entries.map((e) => e.requestId)).toEqual(['0xr1']);

    // Uncapped follow-up resumes from the checkpoint and attempts r2/r3.
    // r2's photo fails once (queued for retry); r3 has no face (discarded).
    const second = await runIndexer(deps);
    expect(second.checkpoints.gnosis).toBe(300);
    expect(second.added).toBe(0);
    expect(second.discarded).toBe(1);
    expect((await readIndex(blobs)).header.retries.map((r) => r.requestId)).toEqual(['0xr2']);

    // A third run recovers r2 now that its one-shot failure has cleared.
    await runIndexer(deps);
    expect((await readIndex(blobs)).header.entries.map((e) => e.requestId)).toEqual([
      '0xr1',
      '0xr2',
    ]);
  });

  it('stops retrying after maxRetryAttempts but keeps the failure on record', async () => {
    const { deps, blobs, pipeline } = fixtures();
    const stale = emptyIndex(pipeline.modelId);
    stale.header.retries = [
      {
        chain: 'gnosis',
        requestId: '0xr9',
        humanityId: H('9'),
        createdAt: 50,
        evidenceUri: '/ipfs/ev9',
        attempts: 5,
        lastError: 'gone',
      },
    ];
    stale.header.checkpoints = { gnosis: 9_999 }; // nothing new from the subgraph
    await blobs.set(DEFAULT_INDEX_BLOB_KEY, encodeIndex(stale));

    const summary = await runIndexer(deps, { maxRetryAttempts: 5 });
    expect(summary.added).toBe(0);
    expect(pipeline.calls).toHaveLength(0); // exhausted item not reprocessed
    const index = await readIndex(blobs);
    expect(index.header.retries).toEqual([
      expect.objectContaining({ requestId: '0xr9', attempts: 5 }),
    ]);
  });

  it('bootstrap ignores the existing index and rebuilds from scratch', async () => {
    const { deps, blobs } = fixtures();
    await runIndexer(deps); // photo2's one-shot failure is consumed here
    const summary = await runIndexer(deps, { bootstrap: true });
    expect(summary).toMatchObject({ total: 2, added: 2, failed: 0, discarded: 1 });
    expect((await readIndex(blobs)).header.entries.map((e) => e.requestId)).toEqual([
      '0xr1',
      '0xr2',
    ]);
  });

  it('refuses to update an index built with a different model', async () => {
    const { deps, blobs } = fixtures();
    await blobs.set(DEFAULT_INDEX_BLOB_KEY, encodeIndex(emptyIndex('other-model@9')));
    await expect(runIndexer(deps)).rejects.toThrow(/bootstrap to rebuild/);
  });

  it('refuses to update an index built with different embedding dimensions', async () => {
    const { deps, blobs, pipeline } = fixtures();
    await blobs.set(
      DEFAULT_INDEX_BLOB_KEY,
      encodeIndex(emptyIndex(pipeline.modelId, pipeline.embeddingDims + 1)),
    );
    await expect(runIndexer(deps)).rejects.toThrow(/bootstrap to rebuild/);
  });
});
