# PoH Duplicate Finder

Find potential duplicate registrations in [Proof of Humanity v2](https://v2.proofofhumanity.id)
by face-matching a photo or an existing profile against **every face ever submitted** to the
registry (including expired, revoked, and rejected requests).

## Architecture

```
GitHub Actions (cron ~30 min)         Netlify
┌───────────────────────────┐    ┌──────────────────────────────┐
│ indexer (Node + ONNX)     │───▶│ Blobs: face index + models   │
│ subgraph Δ → IPFS → embed │    │            ▲                 │
└───────────────────────────┘    │  /api/lookup (ONNX WASM)     │
                                 │            ▲                 │
                                 │  static SPA (upload/address) │
                                 └──────────────────────────────┘
```

- **`core/`** — shared TypeScript library: SCRFD + ArcFace face embedding (L2-normalized), binary
  index codec (raw float32 vectors), cosine ranking, subgraph client, IPFS client, and the
  indexer/lookup orchestration. The indexer and lookup function use the same model bytes, so
  embeddings stay compatible.
- **`indexer/`** — CLI run by the `Index` GitHub workflow. Incremental from a per-chain
  checkpoint; the one-time `bootstrap` mode does the full scan. Failed photos are retried on
  later runs (capped). Entries are append-only: old faces are what catch re-registrations.
- **`netlify/functions/`** — `POST /api/lookup` (embed one photo, rank against the index) and
  `GET /api/status`. The index and ONNX pipeline are cached across warm invocations.
- **`web/`** — Vite + React SPA. Two inputs: profile id/URL or photo upload. Matches that share
  the query's humanity id are flagged as renewals (not duplicates).

Models: InsightFace `buffalo_s` **SCRFD 500M** detection + **w600k_mbf ArcFace** descriptors.

## Commands

```bash
npm ci                  # install
npm run build           # build core + web
npm test                # vitest unit + integration suites
npm run lint            # eslint
npm run typecheck       # tsc over every workspace + functions
npm run knip            # unused files/exports/dependencies (local-only, not in CI)
npm run format          # prettier check
npm run models:download # one-time: download ./models/*.onnx
npm run models:upload   # seed Netlify Blobs, or BLOB_DIR for local dev

npm run indexer -- update     # incremental index run (needs env, see below)
npm run indexer -- bootstrap  # full rebuild
```

### Local dev (no Netlify account needed)

Set `BLOB_DIR` to use a filesystem-backed blob store that the indexer and the
lookup function both read, so the whole stack runs locally:

```bash
export BLOB_DIR="$PWD/.localblobs"
export MAINNET_SUBGRAPH_URL=… GNOSIS_SUBGRAPH_URL=…   # for profile lookups

npm run models:download
BLOB_DIR="$PWD/.localblobs" npm run models:upload
npm run build -w core
INDEXER_MAX_ITEMS=300 npm run indexer -- bootstrap   # small index, ~2 min
npm run build -w web
npx tsx scripts/dev-server.ts           # http://localhost:8888
```

`scripts/dev-server.ts` is a dev-only server (Netlify serves the real thing in
prod); it serves `web/dist` and routes `/api/*` to the function handlers,
sidestepping `netlify dev`'s monorepo prompt and bundler. `INDEXER_MAX_ITEMS`
caps how many new photos the indexer embeds per run (omit for a full build —
note the full registry is ~24k requests and takes hours, IPFS-bound).

Git hooks: husky runs lint + typecheck + tests on every commit (installed via `npm install`'s
`prepare` script; the hook sources nvm to pick up the repo's Node 20).

## Environment

| Variable               | Used by            | Notes                                         |
| ---------------------- | ------------------ | --------------------------------------------- |
| `MAINNET_SUBGRAPH_URL` | indexer, functions | The Graph gateway URL incl. API key           |
| `GNOSIS_SUBGRAPH_URL`  | indexer, functions | at least one chain URL is required            |
| `NETLIFY_SITE_ID`      | indexer            | blob store access outside the Netlify runtime |
| `NETLIFY_AUTH_TOKEN`   | indexer            | personal access token                         |
| `BLOB_STORE_NAME`      | all                | optional, defaults to `poh-duplicate-finder`  |
| `INDEX_BLOB_KEY`       | all                | optional, defaults to `index/v1`              |
| `MODELS_DIR`           | scripts, indexer   | optional, defaults to `models`                |

## Deployment checklist

1. Create the Netlify site, link this repo (build runs `npm run build`, publishes `web/dist`).
2. Set `MAINNET_SUBGRAPH_URL` / `GNOSIS_SUBGRAPH_URL` in Netlify env (for the functions).
3. Add the four secrets to the GitHub repo (`MAINNET_SUBGRAPH_URL`, `GNOSIS_SUBGRAPH_URL`,
   `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`).
4. Run `npm run models:download` and `npm run models:upload` once with the Netlify secrets
   available, so lookup functions can load the ONNX model blobs.
5. Run the `Index` workflow manually once with mode `bootstrap` (~15–20 min, IPFS-bound).
6. The cron keeps the index fresh every ~30 min thereafter. Note: GitHub disables cron
   workflows after 60 days without repo activity — re-enable from the Actions tab if needed.

## API

`POST /api/lookup` with either `multipart/form-data` (`photo` field, jpeg/png, ≤6 MB) or JSON
`{ "profile": "0x… pohId | address | profile URL" }`. Returns top-20 matches with cosine
similarity scores, band labels (`likely-same` ≥ 0.55 > `review` ≥ 0.4 > `different`), status,
photo URI, and a `v2.proofofhumanity.id` profile link. Errors are typed:
`NO_FACE`, `PROFILE_NOT_FOUND`, `PHOTO_FETCH_FAILED`, `INDEX_UNAVAILABLE`, `BAD_REQUEST`.

Scores are advisory — identical twins and poor photos mislead; a human reviews before
challenging.
