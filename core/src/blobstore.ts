import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStore, type Store } from '@netlify/blobs';
import { DEFAULT_BLOB_STORE_NAME } from './constants.js';

export interface BlobStore {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
}

export class InMemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | null> {
    const value = this.blobs.get(key);
    return value ? new Uint8Array(value) : null;
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    this.blobs.set(key, new Uint8Array(value));
  }
}

export interface NetlifyBlobStoreOptions {
  name?: string;
  /** Required outside the Netlify runtime (e.g. GitHub Actions). */
  siteID?: string;
  token?: string;
}

export class NetlifyBlobStore implements BlobStore {
  private readonly store: Store;

  constructor(options: NetlifyBlobStoreOptions = {}) {
    const name = options.name ?? DEFAULT_BLOB_STORE_NAME;
    this.store =
      options.siteID && options.token
        ? getStore({ name, siteID: options.siteID, token: options.token })
        : getStore(name);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const buffer = await this.store.get(key, { type: 'arrayBuffer' });
    return buffer ? new Uint8Array(buffer) : null;
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    const copy = new Uint8Array(value);
    await this.store.set(key, copy.buffer);
  }
}

/**
 * Filesystem-backed store: each key maps to a file under `dir` (slashes in the
 * key become subdirectories). Used for local dev so the indexer CLI and
 * `netlify dev` can share one store without a Netlify account. Writes go
 * through a temp file + rename so readers never observe a partial blob.
 */
export class FileBlobStore implements BlobStore {
  constructor(private readonly dir: string) {}

  private pathFor(key: string): string {
    return path.join(this.dir, ...key.split('/'));
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, value);
    await rename(tmp, file);
  }
}

/**
 * Pick a store from the environment: a local FileBlobStore when `BLOB_DIR` is
 * set (local dev), otherwise the Netlify store. Site credentials are only
 * needed for the Netlify path outside the Netlify runtime.
 */
export function resolveBlobStore(
  env: NodeJS.ProcessEnv = process.env,
  netlifyOptions: NetlifyBlobStoreOptions = {},
): BlobStore {
  if (env.BLOB_DIR) return new FileBlobStore(env.BLOB_DIR);
  return new NetlifyBlobStore({ name: env.BLOB_STORE_NAME, ...netlifyOptions });
}
