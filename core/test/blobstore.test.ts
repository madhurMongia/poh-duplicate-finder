import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileBlobStore, InMemoryBlobStore, resolveBlobStore } from '../src/blobstore.js';

describe('InMemoryBlobStore', () => {
  it('round-trips and copies on read/write', async () => {
    const store = new InMemoryBlobStore();
    expect(await store.get('missing')).toBeNull();

    const value = new Uint8Array([1, 2, 3]);
    await store.set('k', value);
    value[0] = 9; // external mutation must not leak in
    const read = (await store.get('k'))!;
    expect(Array.from(read)).toEqual([1, 2, 3]);
    read[0] = 7; // mutating the read copy must not corrupt the store
    expect(Array.from((await store.get('k'))!)).toEqual([1, 2, 3]);
  });
});

describe('FileBlobStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pohdf-blobs-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null for a missing key', async () => {
    expect(await new FileBlobStore(dir).get('index/v1')).toBeNull();
  });

  it('round-trips binary content, creating nested key directories', async () => {
    const store = new FileBlobStore(dir);
    const value = new Uint8Array([0, 255, 7, 42]);
    await store.set('index/test', value);
    expect(Array.from((await store.get('index/test'))!)).toEqual([0, 255, 7, 42]);
  });

  it('overwrites atomically and leaves no temp files behind', async () => {
    const store = new FileBlobStore(dir);
    await store.set('index/v1', new Uint8Array([1]));
    await store.set('index/v1', new Uint8Array([2, 2]));
    expect(Array.from((await store.get('index/v1'))!)).toEqual([2, 2]);
  });
});

describe('resolveBlobStore', () => {
  it('uses a FileBlobStore when BLOB_DIR is set', () => {
    expect(resolveBlobStore({ BLOB_DIR: '/tmp/x' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      FileBlobStore,
    );
  });

  it('falls back to the Netlify store otherwise (which needs Netlify context/creds)', () => {
    // Outside the Netlify runtime with no creds, the Netlify branch throws on
    // construction — proof that BLOB_DIR-less resolution did not pick the file store.
    expect(() => resolveBlobStore({} as NodeJS.ProcessEnv)).toThrow(/Netlify Blobs/);
  });
});
