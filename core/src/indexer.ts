import type { BlobStore } from './blobstore.js';
import { appendToIndex, decodeIndex, emptyIndex, encodeIndex } from './codec.js';
import { DEFAULT_INDEX_BLOB_KEY } from './constants.js';
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
  /**
   * Cap on how many *new* photos to embed this run (retries don't count).
   * Leftover requests stay beyond the checkpoint and are picked up next run,
   * so a capped run is fully resumable. Bounds run time/memory; also handy for
   * standing up a partial index quickly. Unset = no cap.
   */
  maxItems?: number;
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
const PHOTO_PROGRESS_INTERVAL = 25;

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

  let index = emptyIndex(pipeline.modelId, pipeline.embeddingDims);
  if (options.bootstrap) {
    log.info(`bootstrap: starting fresh ${pipeline.modelId} index`);
  } else {
    log.info(`loading index blob ${blobKey}`);
    const existing = await blobs.get(blobKey);
    if (existing) {
      index = decodeIndex(existing);
      log.info(
        `loaded index: ${index.header.count} faces, ` +
          `${index.header.retries.length} retries, ` +
          `${Object.keys(index.header.checkpoints).length} checkpoints`,
      );
    } else {
      log.info(`no existing index at ${blobKey}; starting fresh`);
    }
  }
  if (index.header.modelId !== pipeline.modelId || index.header.dims !== pipeline.embeddingDims) {
    throw new Error(
      `index model ${index.header.modelId}/${index.header.dims}d != ` +
        `pipeline model ${pipeline.modelId}/${pipeline.embeddingDims}d; ` +
        'run a bootstrap to rebuild with the new model',
    );
  }

  const known = new Set(index.header.entries.map((e) => e.requestId));
  const checkpoints = { ...index.header.checkpoints };

  const work: WorkItem[] = index.header.retries
    .filter((r) => r.attempts < maxRetryAttempts)
    .map((r) => ({ ...r }));
  const retryWorkCount = work.length;
  const exhaustedRetries = index.header.retries.filter((r) => r.attempts >= maxRetryAttempts);
  if (retryWorkCount || exhaustedRetries.length) {
    log.info(`${retryWorkCount} retries queued, ${exhaustedRetries.length} exhausted retries kept`);
  }

  let budget = options.maxItems ?? Infinity;
  for (const chain of subgraph.chains()) {
    const since = checkpoints[chain] ?? 0;
    log.info(`${chain}: fetching claim requests since ${since}`);
    const requests = await subgraph.fetchClaimRequestsSince(chain, since);
    log.info(`${chain}: ${requests.length} new claim requests since ${since}`);
    let queued = 0;
    let skippedKnown = 0;
    for (const req of requests) {
      if (known.has(req.requestId)) {
        // Advance the checkpoint over already-indexed duplicates so the next
        // run's `creationTime_gt` skips them.
        checkpoints[chain] = Math.max(checkpoints[chain] ?? 0, req.creationTime);
        skippedKnown++;
        continue;
      }
      // Out of budget: leave this and every later (newer) request for the next
      // run by NOT advancing the checkpoint past them. Requests are ascending
      // by creationTime, so breaking here keeps the run resumable.
      if (budget <= 0) {
        log.info(`${chain}: maxItems budget exhausted; leaving remaining requests for next run`);
        break;
      }
      checkpoints[chain] = Math.max(checkpoints[chain] ?? 0, req.creationTime);
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
      queued++;
      budget--;
    }
    log.info(
      `${chain}: queued ${queued} requests, skipped ${skippedKnown} known, ` +
        `checkpoint ${checkpoints[chain] ?? since}`,
    );
  }

  const newEntries: FaceEntry[] = [];
  const newRows: Float32Array[] = [];
  const failures: RetryItem[] = [];
  const newWorkCount = work.length - retryWorkCount;
  if (work.length === 0) {
    log.info('no photos to fetch/embed this run');
  } else {
    log.info(`processing ${work.length} photos (${newWorkCount} new, ${retryWorkCount} retries)`);
  }
  for (let i = 0; i < work.length; i++) {
    const item = work[i];
    const processed = i + 1;
    if (processed === 1 || processed % PHOTO_PROGRESS_INTERVAL === 0 || processed === work.length) {
      log.info(`photos: ${processed}/${work.length} ${item.chain}/${item.requestId}`);
    }
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
        fail(`${result.message} (${photoUri})`);
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
  log.info(`photos done: ${newEntries.length} embedded, ${failures.length} failed`);

  index = appendToIndex(index, newEntries, newRows);

  // Statuses are cheap subgraph metadata (no IPFS, no ML), so refresh every
  // entry on every run — revocations and expiries become visible without
  // ever re-embedding a photo.
  const statusByKey = new Map<string, ReturnType<typeof deriveStatus>>();
  for (const chain of subgraph.chains()) {
    log.info(`${chain}: fetching status snapshot`);
    const snapshot = await subgraph.fetchStatusSnapshot(chain);
    log.info(`${chain}: ${snapshot.length} status rows`);
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

  log.info(`writing index blob ${blobKey}`);
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
