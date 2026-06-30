import {
  DEFAULT_INDEX_BLOB_KEY,
  HumanFacePipeline,
  IpfsClient,
  resolveBlobStore,
  runIndexer,
  SubgraphClient,
  type ChainId,
} from '@pohdf/core';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

function subgraphEndpoints(): Partial<Record<ChainId, string>> {
  const endpoints: Partial<Record<ChainId, string>> = {};
  if (process.env.MAINNET_SUBGRAPH_URL) endpoints.mainnet = process.env.MAINNET_SUBGRAPH_URL;
  if (process.env.GNOSIS_SUBGRAPH_URL) endpoints.gnosis = process.env.GNOSIS_SUBGRAPH_URL;
  if (Object.keys(endpoints).length === 0) {
    throw new Error('set MAINNET_SUBGRAPH_URL and/or GNOSIS_SUBGRAPH_URL');
  }
  return endpoints;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'update';
  if (mode !== 'update' && mode !== 'bootstrap') {
    throw new Error(`unknown mode '${mode}'; expected 'update' or 'bootstrap'`);
  }

  const pipeline = await HumanFacePipeline.create();

  // Local dev (BLOB_DIR set) writes to the filesystem and needs no Netlify
  // credentials; the cloud path requires the site id + token.
  const blobs = resolveBlobStore(process.env, {
    siteID: process.env.BLOB_DIR ? undefined : requireEnv('NETLIFY_SITE_ID'),
    token: process.env.BLOB_DIR ? undefined : requireEnv('NETLIFY_AUTH_TOKEN'),
  });

  const summary = await runIndexer(
    {
      blobs,
      subgraph: new SubgraphClient(subgraphEndpoints()),
      ipfs: new IpfsClient({ timeoutMs: 15_000 }),
      pipeline,
      log: {
        info: (message) => console.log(`[indexer] ${message}`),
        warn: (message) => console.warn(`[indexer] WARN ${message}`),
      },
    },
    {
      blobKey: process.env.INDEX_BLOB_KEY ?? DEFAULT_INDEX_BLOB_KEY,
      bootstrap: mode === 'bootstrap',
      maxItems: process.env.INDEXER_MAX_ITEMS ? Number(process.env.INDEXER_MAX_ITEMS) : undefined,
    },
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('[indexer] run failed:', err);
  process.exitCode = 1;
});
