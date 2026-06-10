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
