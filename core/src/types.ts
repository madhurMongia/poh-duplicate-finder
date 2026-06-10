export type ChainId = 'mainnet' | 'gnosis';

export type EntryStatus =
  | 'registered'
  | 'pending'
  | 'expired'
  | 'revoked'
  | 'rejected'
  | 'withdrawn'
  | 'unknown';

/** One face in the index. Entries are append-only: revoked/expired faces stay forever. */
export interface FaceEntry {
  humanityId: string;
  chain: ChainId;
  requestId: string;
  status: EntryStatus;
  /** IPFS path of the photo itself, e.g. "/ipfs/Qm.../photo.jpg" */
  photoUri: string;
  name?: string;
  /** Request creationTime, unix seconds. */
  createdAt: number;
}

/** A photo that failed to fetch/embed; retried on later indexer runs. */
export interface RetryItem {
  chain: ChainId;
  requestId: string;
  humanityId: string;
  createdAt: number;
  name?: string;
  evidenceUri: string | null;
  attempts: number;
  lastError: string;
}

export interface IndexHeader {
  version: 1;
  modelId: string;
  dims: number;
  count: number;
  /** Unix seconds of the build. */
  builtAt: number;
  /** Last indexed request creationTime per chain (unix seconds). */
  checkpoints: Partial<Record<ChainId, number>>;
  retries: RetryItem[];
  entries: FaceEntry[];
}

export interface FaceIndex {
  header: IndexHeader;
  /** count * dims floats, L2-normalized rows, row i belongs to entries[i]. */
  vectors: Float32Array;
}

export type ScoreBand = 'likely-same' | 'review' | 'different';

export type LookupErrorCode =
  | 'BAD_REQUEST'
  | 'NO_FACE'
  | 'DECODE_FAILED'
  | 'PROFILE_NOT_FOUND'
  | 'PHOTO_FETCH_FAILED'
  | 'INDEX_UNAVAILABLE'
  | 'INTERNAL';

export interface MatchResponse {
  score: number;
  band: ScoreBand;
  /** True when the match is the query profile itself (same humanity id) — a renewal, not a duplicate. */
  renewal: boolean;
  humanityId: string;
  chain: ChainId;
  status: EntryStatus;
  photoUri: string;
  name?: string;
  createdAt: number;
  profileUrl: string;
}

export interface LookupResponse {
  ok: true;
  query: {
    humanityId?: string;
    faceCount: number;
    detScore: number;
  };
  matches: MatchResponse[];
  index: {
    count: number;
    builtAt: number;
  };
}

export interface LookupErrorResponse {
  ok: false;
  code: LookupErrorCode;
  message: string;
}

export interface IndexStatusResponse {
  modelId: string;
  count: number;
  builtAt: number;
  checkpoints: Partial<Record<ChainId, number>>;
  pendingRetries: number;
}
