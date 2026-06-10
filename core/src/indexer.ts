import type { BlobStore } from './blobstore.js';
import { appendToIndex, decodeIndex, emptyIndex, encodeIndex } from './codec.js';
import { DEFAULT_INDEX_BLOB_KEY, EMBEDDING_DIMS } from './constants.js';
import type { IpfsJsonApi } from './photos.js';
import { fetchRegistrationPhoto } from './photos.js';
import type { FacePipeline } from './pipeline.js';
import { deriveStatus, type SubgraphApi } from './subgraph.js';
import type { ChainId, FaceEntry, RetryItem } from './types.js';

export interface IndexerLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface IndexerDeps {
  blobs: BlobStore;
  subgraph: SubgraphApi;
  ipfs: IpfsJsonApi;
  pipeline: FacePipeline;
  now?: () => number;
  log?: IndexerLogger;
}

export interface IndexerOptions {
  blobKey?: string;
  /** Ignore any existing index and rebuild from scratch. */
  bootstrap?: boolean;
  maxRetryAttempts?: number;
}

export interface IndexerSummary {
  total: number;
  added: number;
  failed: number;
  retriesPending: number;
  checkpoints: Partial<Record<ChainId, number>>;
}

interface WorkItem {
  chain: ChainId;
  requestId: string;
  humanityId: string;
  createdAt: number;
  name?: string;
  evidenceUri: string | null;
  attempts: number;
}

const NOOP_LOG: IndexerLogger = { info: () => {}, warn: () => {} };

/**
 * One incremental indexer run: fold new claim requests (plus previous
 * failures) into the index, refresh every entry's status, advance the
 * checkpoints, and write the index back as a single atomic blob.
 * Entries are append-only — revoked and expired faces are kept forever.
 */
export async function runIndexer(
  deps: IndexerDeps,
  options: IndexerOptions = {},
): Promise<IndexerSummary> {
  const { blobs, subgraph, ipfs, pipeline } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const log = deps.log ?? NOOP_LOG;
  const blobKey = options.blobKey ?? DEFAULT_INDEX_BLOB_KEY;
  const maxRetryAttempts = options.maxRetryAttempts ?? 5;

  let index = emptyIndex(pipeline.modelId, EMBEDDING_DIMS);
  if (!options.bootstrap) {
    const existing = await blobs.get(blobKey);
    if (existing) index = decodeIndex(existing);
  }
  if (index.header.modelId !== pipeline.modelId) {
    throw new Error(
      `index model ${index.header.modelId} != pipeline model ${pipeline.modelId}; ` +
        'run a bootstrap to rebuild with the new model',
    );
  }

  const known = new Set(index.header.entries.map((e) => e.requestId));
  const checkpoints = { ...index.header.checkpoints };

  const work: WorkItem[] = index.header.retries
    .filter((r) => r.attempts < maxRetryAttempts)
    .map((r) => ({ ...r }));
  const exhaustedRetries = index.header.retries.filter((r) => r.attempts >= maxRetryAttempts);

  for (const chain of subgraph.chains()) {
    const since = checkpoints[chain] ?? 0;
    const requests = await subgraph.fetchClaimRequestsSince(chain, since);
    log.info(`${chain}: ${requests.length} new claim requests since ${since}`);
    for (const req of requests) {
      checkpoints[chain] = Math.max(checkpoints[chain] ?? 0, req.creationTime);
      if (known.has(req.requestId)) continue;
      known.add(req.requestId);
      work.push({
        chain,
        requestId: req.requestId,
        humanityId: req.humanityId,
        createdAt: req.creationTime,
        name: req.name,
        evidenceUri: req.evidenceUri,
        attempts: 0,
      });
    }
  }

  const newEntries: FaceEntry[] = [];
  const newRows: Float32Array[] = [];
  const failures: RetryItem[] = [];
  for (const item of work) {
    const fail = (reason: string) => {
      failures.push({
        chain: item.chain,
        requestId: item.requestId,
        humanityId: item.humanityId,
        createdAt: item.createdAt,
        name: item.name,
        evidenceUri: item.evidenceUri,
        attempts: item.attempts + 1,
        lastError: reason,
      });
      log.warn(`${item.chain}/${item.requestId}: ${reason}`);
    };
    try {
      if (!item.evidenceUri) {
        fail('no registration evidence');
        continue;
      }
      const { photoUri, bytes } = await fetchRegistrationPhoto(ipfs, item.evidenceUri);
      const result = await pipeline.embedFace(bytes);
      if (!result.ok) {
        fail(result.message);
        continue;
      }
      newEntries.push({
        humanityId: item.humanityId,
        chain: item.chain,
        requestId: item.requestId,
        status: 'unknown',
        photoUri,
        name: item.name,
        createdAt: item.createdAt,
      });
      newRows.push(result.embedding);
    } catch (err) {
      fail(String(err));
    }
  }

  index = appendToIndex(index, newEntries, newRows);

  const statusByKey = new Map<string, ReturnType<typeof deriveStatus>>();
  for (const chain of subgraph.chains()) {
    const snapshot = await subgraph.fetchStatusSnapshot(chain);
    for (const raw of snapshot) {
      statusByKey.set(`${chain}:${raw.requestId}`, deriveStatus(raw, now()));
    }
  }
  for (const entry of index.header.entries) {
    entry.status = statusByKey.get(`${entry.chain}:${entry.requestId}`) ?? entry.status;
  }

  index.header.checkpoints = checkpoints;
  index.header.retries = [...failures, ...exhaustedRetries];
  index.header.builtAt = now();

  await blobs.set(blobKey, encodeIndex(index));

  const summary: IndexerSummary = {
    total: index.header.count,
    added: newEntries.length,
    failed: failures.length,
    retriesPending: failures.filter((f) => f.attempts < maxRetryAttempts).length,
    checkpoints,
  };
  log.info(
    `index written: ${summary.total} faces (+${summary.added}), ` +
      `${summary.failed} failures (${summary.retriesPending} will retry)`,
  );
  return summary;
}
