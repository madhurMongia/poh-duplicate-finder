import { useRef, useState } from 'react';
import type { LookupErrorCode, LookupResponse } from '@pohdf/core';
import { lookupByPhoto, lookupByProfile } from './api';
import { LookupForm, type LookupRequest } from './components/LookupForm';
import { ResultsGrid } from './components/ResultsGrid';
import { ExternalLinkIcon } from './components/ExternalLinkIcon';
import { StatusFooter } from './components/StatusFooter';

// Human-readable lead-ins; the server message follows with the specifics.
const ERROR_TITLE: Record<LookupErrorCode, string> = {
  BAD_REQUEST: 'Invalid request',
  NO_FACE: 'No face detected',
  DECODE_FAILED: 'Could not read the photo',
  PROFILE_NOT_FOUND: 'Profile not found',
  PHOTO_FETCH_FAILED: 'Could not load the profile photo',
  INDEX_UNAVAILABLE: 'Index unavailable',
  INTERNAL: 'Something went wrong',
};

export function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [queryPreview, setQueryPreview] = useState<string | null>(null);
  const previewUrl = useRef<string | null>(null);

  async function runLookup(request: LookupRequest) {
    setLoading(true);
    setError(null);
    setResult(null);
    // Object URL for the side-by-side preview; release the previous one so
    // repeated photo lookups don't pile up blobs.
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = request.kind === 'photo' ? URL.createObjectURL(request.photo) : null;
    setQueryPreview(previewUrl.current);
    try {
      const outcome =
        request.kind === 'photo'
          ? await lookupByPhoto(request.photo)
          : await lookupByProfile(request.profile);
      if (outcome.ok) {
        setResult(outcome);
      } else {
        setError(`${ERROR_TITLE[outcome.code] ?? outcome.code}: ${outcome.message}`);
      }
    } catch (err) {
      setError(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header>
        <a
          className="logo-mark"
          href="https://v2.proofofhumanity.id"
          target="_blank"
          rel="noreferrer"
        >
          Proof of Humanity <ExternalLinkIcon />
        </a>
        <h1>
          Duplicate Finder <span className="beta-badge">Beta</span>
        </h1>
        <p className="tagline">
          Check a photo or a Proof of Humanity v2 profile against every face ever submitted to the
          registry.
        </p>
      </header>

      <LookupForm disabled={loading} onSubmit={runLookup} />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && <ResultsGrid result={result} queryPhotoUrl={queryPreview} />}

      <p className="disclaimer">
        Similarity scores are advisory. Twins, photo quality, and aging can mislead the model —
        always review matches yourself before acting on them.
      </p>

      <StatusFooter />
    </div>
  );
}
