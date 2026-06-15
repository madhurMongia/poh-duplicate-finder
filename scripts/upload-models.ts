/**
 * Upload the local ONNX models to the blob store the lookup function reads.
 * One-time setup step (and after model bumps).
 *
 * Cloud: requires NETLIFY_SITE_ID, NETLIFY_AUTH_TOKEN.
 * Local: set BLOB_DIR to seed a filesystem store instead (no creds needed).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MODEL_BLOB_KEYS, resolveBlobStore } from '../core/src/index.js';

const MODELS_DIR = process.env.MODELS_DIR ?? 'models';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

async function main(): Promise<void> {
  const blobs = resolveBlobStore(process.env, {
    siteID: process.env.BLOB_DIR ? undefined : requireEnv('NETLIFY_SITE_ID'),
    token: process.env.BLOB_DIR ? undefined : requireEnv('NETLIFY_AUTH_TOKEN'),
  });

  for (const [kind, key] of Object.entries(MODEL_BLOB_KEYS)) {
    const file = path.join(MODELS_DIR, path.basename(key));
    const bytes = new Uint8Array(readFileSync(file));
    await blobs.set(key, bytes);
    console.log(`uploaded ${kind}: ${file} -> ${key} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
