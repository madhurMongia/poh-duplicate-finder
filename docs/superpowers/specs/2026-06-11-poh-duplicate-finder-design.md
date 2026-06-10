# PoH Duplicate Finder — Design Spec

**Date:** 2026-06-11
**Status:** Approved
**Repo:** `poh-duplicate-finder`

## 1. Purpose

A public website where anyone can check a Proof of Humanity v2 profile (or an
arbitrary photo) against every face that has ever appeared in the v2 registry,
and get a ranked list of the closest matches with similarity scores. The goal
is to give challengers and the community a fast way to find
duplicate-registration evidence within the ~3.5-day challenge window.

The tool performs **ranked retrieval, not automated judgment**: it surfaces
candidates with scores; a human decides whether to file a challenge.

## 2. Scope decisions (from brainstorming)

- **Signal:** face matching on registration **photos** only. No video frames,
  no on-chain heuristics (those live in `poh-gnosis-cluster-graph`).
- **Registry:** PoH **v2 only** (Mainnet + Gnosis chains).
- **Workflow:** on-demand lookup (photo upload or profile address). No
  monitoring/alerting, no full-registry pairwise audit dashboard.
- **Freshness:** index updated incrementally by cron every ~30 minutes.
  Acceptable staleness is bounded by the challenge window (days), so
  minute-level freshness is unnecessary. No client-side delta embedding.
- **Hosting constraint:** Netlify with minimal backend — one lookup function;
  all batch ML runs in GitHub Actions.

## 3. Architecture

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

Division of labor:

- **GitHub Actions = batch compute.** Incremental embedding runs. A CI runner
  is the right home for a batch ML job (no bundle-size limit, 6h max runtime,
  free on public repos). GH cron is imprecise (5-min floor, often delayed) but
  that is irrelevant at our freshness requirement.
- **Netlify Blobs = storage.** The index and the ONNX model files. Blob writes
  need no redeploy and cost nothing.
- **Netlify function = per-query inference.** Embedding a single face fits a
  lambda comfortably (~1–2s warm). The WASM build of onnxruntime avoids native
  binary bundle-size problems.
- **Static SPA = pure UI.** No model download, no WASM in the browser; works
  on phones.

## 4. ML pipeline

Standard four-stage pipeline, implemented once in `core/` and shared by the
indexer and the lookup function:

1. **Detect** — SCRFD (~2.5MB ONNX) finds the face box + 5 landmarks.
2. **Align** — similarity transform to the canonical 112×112 ArcFace crop.
3. **Embed** — MobileFaceNet `w600k_mbf` (insightface, ~13MB ONNX) produces a
   512-d vector, L2-normalized.
4. **Compare** — cosine similarity (dot product of normalized vectors).
   Brute-force over ~10k vectors is <10ms in JS typed arrays; no ANN index.

**Hard rule:** the indexer and the lookup function must use the **same model
files and alignment code** — embeddings from different models are
incompatible. `core/` is the single source of truth; a CI parity test embeds a
fixture photo with both `onnxruntime-node` (indexer) and ORT-WASM (function)
and asserts cosine > 0.999.

**Score bands** (initial, to be calibrated empirically — see Testing):

| Cosine | Meaning |
|---|---|
| > ~0.55 | Likely same person |
| ~0.40–0.55 | Needs human review |
| < ~0.40 | Probably different people |

Future upgrade path: since no browser downloads the model, swapping to a
larger embedder (e.g. ResNet-50 ArcFace, ~166MB, pulled from Blobs into
function memory) requires only a full index rebuild — no architecture change.

## 5. The index

One self-contained binary blob in Netlify Blobs:

- Length-prefixed JSON header: model ID, dims, per-chain checkpoint block
  numbers, build timestamp, retry list (failed photos with attempt counts),
  and one metadata entry per face: humanity ID, chain, request ID, status,
  photo CID, registration timestamp.
- Followed by an `N × 512` **int8** matrix with per-vector float32 scales
  (~512 bytes/face → ~5MB at 10k faces; quantization noise is far below the
  same/different-person gap).

**Indexing policy:**

- Every claim request ever made on v2 (both chains) with a resolvable photo —
  including expired, revoked, rejected, and withdrawn requests. Old faces are
  exactly what catches re-registrations under a new address. **Entries are
  never deleted.**
- Each entry carries a status (`registered / pending / expired / revoked /
  rejected / withdrawn`), refreshed every run via one bulk subgraph query
  (metadata only — no IPFS, no ML).
- Photo resolution follows the same chain the v2 web app uses:
  request → evidence URI → registration JSON → photo URI on IPFS.

**Incremental run:** load blob → query subgraphs for requests since the
per-chain checkpoint blocks → fetch + embed only those photos → refresh all
statuses → write one new blob. The single-blob write is atomic from the
reader's perspective (no torn index). Bootstrap mode does the one-time full
scan (~15–20 min, IPFS-bound).

**Per-photo failures** go into the retry list in the header and are retried on
later runs (capped attempts); they never fail the run.

## 6. Lookup API

`POST /api/lookup` accepts either:

- a photo (multipart, ≤6MB — Netlify payload limit), or
- `{ address | humanityId }` — the function resolves the photo from subgraph +
  IPFS itself; nothing is uploaded.

Behavior: detect face (0 faces → typed error; >1 → use largest, include a
warning), embed, rank against the full index, return **top-20** matches as
JSON: score, humanity ID, chain, status, photo CID, registration date, and a
profile URL on **`v2.proofofhumanity.id`**.

The function caches model + index in module scope across warm invocations and
refreshes when the blob changes. Cold start ~5–8s, warm ~1–2s, within the 10s
function budget. IPFS fetches are capped at ~5s per gateway with fallback
(`cdn.kleros.link` → `ipfs.io` → Cloudflare).

A lightweight `GET /api/status` (or GET on the same function) returns index
metadata for the UI footer.

No auth and no rate limiting in v1: all underlying data is already public, and
expected traffic is far below the Netlify free tier (125k invocations/month).
The API is deliberately reusable by other clients (bots, the v2 web app).

## 7. Web UI

Single page (Vite + React + TypeScript):

- **Input:** photo upload or profile address/humanity ID.
- **Results grid:** query photo side-by-side with each match (match photos
  load directly from the IPFS gateway in the browser), score badge in
  calibrated bands, status tag, registration date, link to the profile on
  `v2.proofofhumanity.id`.
- **Renewal disambiguation:** a match sharing the query's own humanity ID is
  labeled "same profile (renewal)" and visually de-emphasized. Different
  humanity ID + high score is the duplicate signal.
- **Index-status footer:** e.g. "12,431 faces · updated 14 min ago · block
  46,631,710".
- **Persistent disclaimer:** scores are advisory; identical twins and photo
  quality can mislead; a human makes the call.

## 8. Repo layout

npm workspaces, TypeScript throughout:

```
poh-duplicate-finder/
  netlify.toml
  package.json
  core/                # shared: face pipeline, index codec, subgraph client,
                       # IPFS fetcher with gateway fallback
  indexer/             # CLI (onnxruntime-node), modes: bootstrap | update
  netlify/functions/   # lookup.ts (ORT WASM)
  web/                 # Vite React SPA
  .github/workflows/index.yml   # cron */30 + workflow_dispatch
  docs/superpowers/specs/       # this document
```

## 9. Error handling

- **Indexer:** subgraph unreachable → abort, checkpoints untouched, next cron
  retries. Individual photo failures → retry list, never fatal. Run summary
  printed to the Actions log.
- **Lookup:** typed errors the UI renders: `NO_FACE`, `PROFILE_NOT_FOUND`,
  `PHOTO_FETCH_FAILED`, `INDEX_UNAVAILABLE`.
- **Model drift:** the node/WASM parity test in CI is the guard against the
  indexer and function silently diverging.
- **GH Actions cron disablement** (60 days of repo inactivity disables
  scheduled workflows): accepted risk for v1; a keepalive can be added later.

## 10. Testing

- **Unit:** index codec round-trip + quantization error bounds; ranking;
  subgraph response parsing against recorded fixtures.
- **Integration:** indexer bootstrap against fixture subgraph/IPFS data;
  lookup function exercised via `netlify dev` against a tiny fixture index.
- **Parity:** same fixture photo embedded via onnxruntime-node and ORT-WASM,
  cosine > 0.999.
- **Calibration:** a small ground-truth set — known same-person pairs from
  public resolved duplicate challenges vs. random distinct pairs — pins the
  real score bands for the UI and regression-tests the whole ML pipeline.
- **Acceptance:** a known historical v2 duplicate case must surface as the
  top match for its counterpart.

## 11. Secrets & ops

- GH Actions secrets: subgraph gateway key(s), Netlify auth token + site ID
  (for Blob writes).
- Netlify env: subgraph gateway key for the lookup function's
  address-resolution path.
- Everything runs on free tiers (public repo assumed).

## 12. Out of scope (v1)

Video-frame matching; on-chain funding heuristics; full-registry pairwise
audit; new-submission alerting; PoH v1 registry; larger embedding model;
auth/rate limiting. The architecture leaves room for each.
