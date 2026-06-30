import {
  createCachedIndexLoader,
  DEFAULT_INDEX_BLOB_KEY,
  HumanFacePipeline,
  IpfsClient,
  resolveBlobStore,
  SubgraphClient,
  type BlobStore,
  type ChainId,
  type LookupDeps,
} from '@pohdf/core';

export function createBlobStore(): BlobStore {
  return resolveBlobStore(process.env);
}

export function indexBlobKey(): string {
  return process.env.INDEX_BLOB_KEY ?? DEFAULT_INDEX_BLOB_KEY;
}

let cached: Promise<LookupDeps> | null = null;

/** Module-scope cache: models, sessions, and the index loader survive across warm invocations. */
export function getLookupDeps(): Promise<LookupDeps> {
  cached ??= build().catch((err) => {
    cached = null; // allow the next invocation to retry a failed cold start
    throw err;
  });
  return cached;
}

async function build(): Promise<LookupDeps> {
  const blobs = createBlobStore();
  const endpoints: Partial<Record<ChainId, string>> = {};
  if (process.env.MAINNET_SUBGRAPH_URL) endpoints.mainnet = process.env.MAINNET_SUBGRAPH_URL;
  if (process.env.GNOSIS_SUBGRAPH_URL) endpoints.gnosis = process.env.GNOSIS_SUBGRAPH_URL;

  return {
    loadIndex: createCachedIndexLoader(blobs, { key: indexBlobKey() }),
    subgraph: new SubgraphClient(endpoints),
    ipfs: new IpfsClient(),
    pipeline: await HumanFacePipeline.create(),
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
