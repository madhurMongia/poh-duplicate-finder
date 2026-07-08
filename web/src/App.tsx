import { useState } from 'react';
import type { LookupResponse } from '@pohdf/core';
import { lookupByPhoto, lookupByProfile } from './api';
import { LookupForm, type LookupRequest } from './components/LookupForm';
import { ResultsGrid } from './components/ResultsGrid';
import { ExternalLinkIcon } from './components/ExternalLinkIcon';
import { StatusFooter } from './components/StatusFooter';

export function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [queryPreview, setQueryPreview] = useState<string | null>(null);

  async function runLookup(request: LookupRequest) {
    setLoading(true);
    setError(null);
    setResult(null);
    // Object URL for the side-by-side preview; freed by the browser on unload.
    setQueryPreview(request.kind === 'photo' ? URL.createObjectURL(request.photo) : null);
    try {
      const outcome =
        request.kind === 'photo'
          ? await lookupByPhoto(request.photo)
          : await lookupByProfile(request.profile);
      if (outcome.ok) {
        setResult(outcome);
      } else {
        setError(`${outcome.code}: ${outcome.message}`);
      }
    } catch (err) {
      setError(`Request failed: ${String(err)}`);
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

      {loading && (
        <div className="searching">
          <span className="spinner" aria-hidden />
          <span>Searching the registry…</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {result && <ResultsGrid result={result} queryPhotoUrl={queryPreview} />}

      <p className="disclaimer">
        Similarity scores are advisory. Twins, photo quality, and aging can mislead the model —
        always review matches yourself before acting on them.
      </p>

      <StatusFooter />
    </div>
  );
}
