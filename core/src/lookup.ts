import type { BlobStore } from './blobstore.js';
import { decodeIndex } from './codec.js';
import { buildProfileUrl, DEFAULT_INDEX_BLOB_KEY, scoreBand } from './constants.js';
import type { IpfsJsonApi } from './photos.js';
import { fetchRegistrationPhoto, resolveRegistrationPhotoUri } from './photos.js';
import type { FacePipeline } from './pipeline.js';
import { rankMatches } from './ranking.js';
import type { SubgraphApi } from './subgraph.js';
import type { ChainId, FaceIndex, LookupErrorCode, LookupResponse } from './types.js';

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
const PROFILE_REF_IN_TEXT = /(?:^|[^0-9a-f])(?:0x)?([0-9a-f]{40})(?![0-9a-f])/i;

/** Pull a profile reference (pohId/address) out of raw user input, e.g. a pasted profile URL. */
export function parseProfileRef(input: string): string | null {
  const match = input.match(PROFILE_REF_IN_TEXT);
  return match ? `0x${match[1].toLowerCase()}` : null;
}

/** Subgraph + IPFS JSON only — no index, no ML models. */
export type PreviewDeps = Pick<LookupDeps, 'subgraph' | 'ipfs'>;

export interface ProfilePreview {
  humanityId: string;
  chain: ChainId;
  name?: string;
  photoUri?: string;
  profileUrl: string;
}

/**
 * Resolve a pohId/address to profile metadata (name, chain, registration
 * photo uri) without touching the face index or the ML pipeline — cheap
 * enough to drive a live preview while the user types.
 */
export async function resolveProfilePreview(
  deps: PreviewDeps,
  ref: string,
): Promise<ProfilePreview> {
  const normalized = ref.toLowerCase();
  if (!HEX_REF.test(normalized)) {
    throw new LookupError('BAD_REQUEST', 'expected a 0x… pohId or address (40 hex chars)');
  }
  for (const chain of deps.subgraph.chains()) {
    const profile = await deps.subgraph.resolveProfile(chain, normalized);
    if (!profile) continue;
    const preview: ProfilePreview = {
      humanityId: profile.humanityId,
      chain: profile.chain,
      name: profile.name,
      profileUrl: buildProfileUrl(profile.humanityId),
    };
    if (profile.evidenceUri) {
      try {
        preview.photoUri = await resolveRegistrationPhotoUri(deps.ipfs, profile.evidenceUri);
      } catch {
        // Preview stays photo-less; the full lookup surfaces fetch errors.
      }
    }
    return preview;
  }
  throw new LookupError('PROFILE_NOT_FOUND', `no PoH v2 profile found for ${normalized}`);
}

export async function performLookup(
  deps: LookupDeps,
  input: LookupInput,
  options: LookupOptions = {},
): Promise<LookupResponse> {
  const { loadIndex, subgraph, ipfs, pipeline } = deps;

  const index = await loadIndex();
  if (!index) throw new LookupError('INDEX_UNAVAILABLE', 'face index has not been built yet');
  if (index.header.modelId !== pipeline.modelId || index.header.dims !== pipeline.embeddingDims) {
    throw new LookupError(
      'INDEX_UNAVAILABLE',
      `face index was built with ${index.header.modelId}/${index.header.dims}d; ` +
        `run indexer bootstrap for ${pipeline.modelId}/${pipeline.embeddingDims}d`,
    );
  }

  let photoBytes: Uint8Array;
  let queryHumanityId: string | undefined;
  let queryProfile: { chain: ChainId; name?: string; photoUri?: string } | undefined;

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
        queryProfile = { chain: profile.chain, name: profile.name };
        evidenceUri = profile.evidenceUri;
        break;
      }
    }
    if (!queryHumanityId || !queryProfile) {
      throw new LookupError('PROFILE_NOT_FOUND', `no PoH v2 profile found for ${ref}`);
    }
    if (!evidenceUri) {
      throw new LookupError('PHOTO_FETCH_FAILED', 'profile has no registration evidence');
    }
    try {
      const photo = await fetchRegistrationPhoto(ipfs, evidenceUri);
      photoBytes = photo.bytes;
      queryProfile.photoUri = photo.photoUri;
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
      chain: queryProfile?.chain,
      name: queryProfile?.name,
      photoUri: queryProfile?.photoUri,
      profileUrl: queryHumanityId ? buildProfileUrl(queryHumanityId) : undefined,
      faceCount: embedded.faceCount,
      detScore: embedded.detScore,
    },
    matches: matches.map((m) => ({
      score: m.score,
      band: scoreBand(m.score),
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
