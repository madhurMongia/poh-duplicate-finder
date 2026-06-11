import type { BlobStore } from './blobstore.js';
import { decodeIndex } from './codec.js';
import { buildProfileUrl, DEFAULT_INDEX_BLOB_KEY, scoreBand } from './constants.js';
import type { IpfsJsonApi } from './photos.js';
import { fetchRegistrationPhoto } from './photos.js';
import type { FacePipeline } from './pipeline.js';
import { rankMatches } from './ranking.js';
import type { SubgraphApi } from './subgraph.js';
import type { FaceIndex, LookupErrorCode, LookupResponse } from './types.js';

/** Resolves the current index, or null when none has been built yet. */
export type IndexLoader = () => Promise<FaceIndex | null>;

export interface LookupDeps {
  loadIndex: IndexLoader;
  subgraph: SubgraphApi;
  ipfs: IpfsJsonApi;
  pipeline: FacePipeline;
}

export interface CachedIndexLoaderOptions {
  key?: string;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Blob-backed IndexLoader that keeps the decoded index for ttlMs, so warm
 * serverless invocations skip the blob fetch and decode. A missing blob is
 * never cached — lookups see the index as soon as the first build lands.
 */
export function createCachedIndexLoader(
  blobs: BlobStore,
  options: CachedIndexLoaderOptions = {},
): IndexLoader {
  const key = options.key ?? DEFAULT_INDEX_BLOB_KEY;
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  let cached: { index: FaceIndex; at: number } | null = null;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.index;
    const blob = await blobs.get(key);
    if (!blob) return null;
    cached = { index: decodeIndex(blob), at: now() };
    return cached.index;
  };
}

export type LookupInput =
  | { kind: 'photo'; bytes: Uint8Array }
  /** A humanity id (pohId) or claimer address; checked against every chain. */
  | { kind: 'profile'; ref: string };

export interface LookupOptions {
  topK?: number;
}

export class LookupError extends Error {
  constructor(
    readonly code: LookupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LookupError';
  }
}

const HEX_REF = /^0x[0-9a-f]{40}$/;

/** Pull a profile reference (pohId/address) out of raw user input, e.g. a pasted profile URL. */
export function parseProfileRef(input: string): string | null {
  const match = input.toLowerCase().match(/0x[0-9a-f]{40}/);
  return match ? match[0] : null;
}

export async function performLookup(
  deps: LookupDeps,
  input: LookupInput,
  options: LookupOptions = {},
): Promise<LookupResponse> {
  const { loadIndex, subgraph, ipfs, pipeline } = deps;

  const index = await loadIndex();
  if (!index) throw new LookupError('INDEX_UNAVAILABLE', 'face index has not been built yet');

  let photoBytes: Uint8Array;
  let queryHumanityId: string | undefined;

  if (input.kind === 'photo') {
    photoBytes = input.bytes;
  } else {
    const ref = input.ref.toLowerCase();
    if (!HEX_REF.test(ref)) {
      throw new LookupError('BAD_REQUEST', 'expected a 0x… pohId or address (40 hex chars)');
    }
    let evidenceUri: string | null = null;
    for (const chain of subgraph.chains()) {
      const profile = await subgraph.resolveProfile(chain, ref);
      if (profile) {
        queryHumanityId = profile.humanityId;
        evidenceUri = profile.evidenceUri;
        break;
      }
    }
    if (!queryHumanityId) {
      throw new LookupError('PROFILE_NOT_FOUND', `no PoH v2 profile found for ${ref}`);
    }
    if (!evidenceUri) {
      throw new LookupError('PHOTO_FETCH_FAILED', 'profile has no registration evidence');
    }
    try {
      ({ bytes: photoBytes } = await fetchRegistrationPhoto(ipfs, evidenceUri));
    } catch (err) {
      throw new LookupError('PHOTO_FETCH_FAILED', String(err));
    }
  }

  const embedded = await pipeline.embedFace(photoBytes);
  if (!embedded.ok) throw new LookupError(embedded.code, embedded.message);

  const matches = rankMatches(embedded.embedding, index, {
    topK: options.topK ?? 20,
    queryHumanityId,
  });

  return {
    ok: true,
    query: {
      humanityId: queryHumanityId,
      faceCount: embedded.faceCount,
      detScore: embedded.detScore,
    },
    matches: matches.map((m) => ({
      score: m.score,
      band: scoreBand(m.score),
      renewal: m.renewal,
      humanityId: m.entry.humanityId,
      chain: m.entry.chain,
      status: m.entry.status,
      photoUri: m.entry.photoUri,
      name: m.entry.name,
      createdAt: m.entry.createdAt,
      profileUrl: buildProfileUrl(m.entry.humanityId),
    })),
    index: {
      count: index.header.count,
      builtAt: index.header.builtAt,
    },
  };
}
