# PoH Duplicate Finder

Find potential duplicate registrations in [Proof of Humanity v2](https://v2.proofofhumanity.id)
by face-matching a photo or an existing profile against **every face ever submitted** to the
registry (including expired, revoked, and rejected requests).

Design spec: [docs/superpowers/specs/2026-06-11-poh-duplicate-finder-design.md](docs/superpowers/specs/2026-06-11-poh-duplicate-finder-design.md)

## Architecture

```
GitHub Actions (cron ~30 min)         Netlify
┌───────────────────────────┐    ┌──────────────────────────────┐
│ indexer (Node, ORT native)│───▶│ Blobs: index blob + models   │
│ subgraph Δ → IPFS → embed │    │            ▲                 │
└───────────────────────────┘    │  /api/lookup (ORT WASM)      │
                                 │            ▲                 │
                                 │  static SPA (upload/address) │
                                 └──────────────────────────────┘
```

- **`core/`** — shared TypeScript library: SCRFD face detection decode, ArcFace alignment +
  embedding, binary index codec (int8-quantized vectors), cosine ranking, subgraph client,
  IPFS client, and the indexer/lookup orchestration. Runtime-agnostic: ONNX sessions are
  injected (`onnxruntime-node` in the indexer, `onnxruntime-web` WASM in the function), but the
  **same model files** are used everywhere — embeddings from different models are incompatible.
- **`indexer/`** — CLI run by the `Index` GitHub workflow. Incremental from a per-chain
  checkpoint; the one-time `bootstrap` mode does the full scan. Failed photos are retried on
  later runs (capped). Entries are append-only: old faces are what catch re-registrations.
- **`netlify/functions/`** — `POST /api/lookup` (embed one photo, rank against the index) and
  `GET /api/status`. Models + index are loaded from Netlify Blobs and cached across warm
  invocations.
- **`web/`** — Vite + React SPA. Two inputs: profile id/URL or photo upload. Matches that share
  the query's humanity id are flagged as renewals (not duplicates).

Models: insightface **SCRFD-500M** (detection) + **w600k MobileFaceNet** (512-d ArcFace
embeddings), from the `buffalo_s` release.

## Commands

```bash
npm ci                  # install
npm run build           # build core + web
npm test                # vitest unit + integration suites
npm run lint            # eslint
npm run typecheck       # tsc over every workspace + functions
npm run knip            # unused files/exports/dependencies
npm run format          # prettier check

npm run models:download # fetch ONNX models into ./models
npm run models:upload   # push models to Netlify Blobs (needs site creds)
npm run indexer -- update     # incremental index run (needs env, see below)
npm run indexer -- bootstrap  # full rebuild
```

Local dev: `npm run build -w core && netlify dev` (serves the SPA + functions on :8888).

## Environment

| Variable | Used by | Notes |
|---|---|---|
| `MAINNET_SUBGRAPH_URL` | indexer, functions | The Graph gateway URL incl. API key |
| `GNOSIS_SUBGRAPH_URL` | indexer, functions | at least one chain URL is required |
| `NETLIFY_SITE_ID` | indexer, scripts | blob store access outside the Netlify runtime |
| `NETLIFY_AUTH_TOKEN` | indexer, scripts | personal access token |
| `BLOB_STORE_NAME` | all | optional, defaults to `poh-duplicate-finder` |
| `INDEX_BLOB_KEY` | all | optional, defaults to `index/v1` |
| `MODELS_DIR` | indexer, scripts | optional, defaults to `./models` |
| `ORT_WASM_DIR` | functions | optional override for the onnxruntime-web wasm dir |

## Deployment checklist

1. Create the Netlify site, link this repo (build runs `npm run build`, publishes `web/dist`).
2. Set `MAINNET_SUBGRAPH_URL` / `GNOSIS_SUBGRAPH_URL` in Netlify env (for the functions).
3. `npm run models:download && npm run models:upload` (with `NETLIFY_SITE_ID` + `NETLIFY_AUTH_TOKEN`).
4. Add the four secrets to the GitHub repo (`MAINNET_SUBGRAPH_URL`, `GNOSIS_SUBGRAPH_URL`,
   `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`).
5. Run the `Index` workflow manually once with mode `bootstrap` (~15–20 min, IPFS-bound).
6. The cron keeps the index fresh every ~30 min thereafter. Note: GitHub disables cron
   workflows after 60 days without repo activity — re-enable from the Actions tab if needed.

## API

`POST /api/lookup` with either `multipart/form-data` (`photo` field, jpeg/png, ≤6 MB) or JSON
`{ "profile": "0x… pohId | address | profile URL" }`. Returns top-20 matches with cosine
similarity scores, band labels (`likely-same` ≥ 0.55 > `review` ≥ 0.40 > `different` — initial
calibration), status, photo URI, and a `v2.proofofhumanity.id` profile link. Errors are typed:
`NO_FACE`, `PROFILE_NOT_FOUND`, `PHOTO_FETCH_FAILED`, `INDEX_UNAVAILABLE`, `BAD_REQUEST`.

Scores are advisory — identical twins and poor photos mislead; a human reviews before
challenging.
