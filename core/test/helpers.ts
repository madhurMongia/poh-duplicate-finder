import { l2Normalize } from '../src/arcface.js';
import { EMBEDDING_DIMS } from '../src/constants.js';
import type { IpfsJsonApi } from '../src/photos.js';
import type { EmbedResult, FacePipeline } from '../src/pipeline.js';
import type {
  RawClaimRequest,
  RawRequestStatus,
  ResolvedProfile,
  SubgraphApi,
} from '../src/subgraph.js';
import type { ChainId, FaceEntry } from '../src/types.js';

export function unitVector(hot: number, dims: number = EMBEDDING_DIMS): Float32Array {
  const v = new Float32Array(dims);
  v[hot] = 1;
  return v;
}

export function mixedVector(weights: Record<number, number>, dims = EMBEDDING_DIMS): Float32Array {
  const v = new Float32Array(dims);
  for (const [hot, w] of Object.entries(weights)) v[Number(hot)] = w;
  return l2Normalize(v);
}

export function makeEntry(overrides: Partial<FaceEntry> = {}): FaceEntry {
  return {
    humanityId: '0x' + '1'.repeat(40),
    chain: 'gnosis',
    requestId: '0xreq1',
    status: 'registered',
    photoUri: '/ipfs/QmPhoto/photo.jpg',
    createdAt: 1_700_000_000,
    ...overrides,
  };
}

/** Pipeline keyed by the UTF-8 content of the photo bytes. */
export class FakePipeline implements FacePipeline {
  readonly modelId: string;
  readonly calls: string[] = [];
  private readonly results = new Map<string, EmbedResult>();

  constructor(modelId = 'fake-model@1') {
    this.modelId = modelId;
  }

  on(photoKey: string, result: EmbedResult): this {
    this.results.set(photoKey, result);
    return this;
  }

  onEmbedding(photoKey: string, embedding: Float32Array): this {
    return this.on(photoKey, { ok: true, embedding, faceCount: 1, detScore: 0.9 });
  }

  async embedFace(bytes: Uint8Array): Promise<EmbedResult> {
    const key = new TextDecoder().decode(bytes);
    this.calls.push(key);
    return (
      this.results.get(key) ?? { ok: false, code: 'NO_FACE', message: `no face detected in ${key}` }
    );
  }
}

/** IPFS fake backed by a uri -> JSON object | bytes map, with optional one-shot failures. */
export class FakeIpfs implements IpfsJsonApi {
  private readonly content = new Map<string, unknown>();
  private readonly failuresLeft = new Map<string, number>();

  setJson(uri: string, value: unknown): this {
    this.content.set(uri, value);
    return this;
  }

  setBytes(uri: string, content: string): this {
    this.content.set(uri, new TextEncoder().encode(content));
    return this;
  }

  failTimes(uri: string, times: number): this {
    this.failuresLeft.set(uri, times);
    return this;
  }

  private resolve(uri: string): unknown {
    const left = this.failuresLeft.get(uri) ?? 0;
    if (left > 0) {
      this.failuresLeft.set(uri, left - 1);
      throw new Error(`fake ipfs failure for ${uri}`);
    }
    if (!this.content.has(uri)) throw new Error(`fake ipfs: no content for ${uri}`);
    return this.content.get(uri);
  }

  async fetchJson<T>(uri: string): Promise<T> {
    return this.resolve(uri) as T;
  }

  async fetchBytes(uri: string): Promise<Uint8Array> {
    return this.resolve(uri) as Uint8Array;
  }
}

export class FakeSubgraph implements SubgraphApi {
  requestsByChain: Partial<Record<ChainId, RawClaimRequest[]>> = {};
  statusByChain: Partial<Record<ChainId, RawRequestStatus[]>> = {};
  profiles = new Map<string, ResolvedProfile>();

  constructor(private readonly chainIds: ChainId[] = ['gnosis']) {}

  chains(): ChainId[] {
    return this.chainIds;
  }

  async fetchClaimRequestsSince(chain: ChainId, since: number): Promise<RawClaimRequest[]> {
    return (this.requestsByChain[chain] ?? []).filter((r) => r.creationTime > since);
  }

  async fetchStatusSnapshot(chain: ChainId): Promise<RawRequestStatus[]> {
    return this.statusByChain[chain] ?? [];
  }

  async resolveProfile(_chain: ChainId, ref: string): Promise<ResolvedProfile | null> {
    return this.profiles.get(ref.toLowerCase()) ?? null;
  }
}
