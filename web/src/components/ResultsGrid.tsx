import type { LookupResponse, MatchResponse } from '@pohdf/core';
import { IPFS_GATEWAY } from '../api';

const BAND_LABEL: Record<MatchResponse['band'], string> = {
  'likely-same': 'Likely same person',
  review: 'Needs review',
  different: 'Probably different',
};

interface Props {
  result: LookupResponse;
  queryPhotoUrl: string | null;
}

export function ResultsGrid({ result, queryPhotoUrl }: Props) {
  const { query } = result;
  // Uploaded photo preview wins; profile lookups fall back to the registration photo.
  const targetPhoto = queryPhotoUrl ?? (query.photoUri ? `${IPFS_GATEWAY}${query.photoUri}` : null);
  return (
    <section className="results">
      <div className="results-header">
        <h2>Top matches</h2>
        <p className="info">
          {result.query.faceCount > 1 && (
            <span className="warn">
              {result.query.faceCount} faces detected in the query photo; the largest was used.{' '}
            </span>
          )}
          Searched {result.index.count.toLocaleString()} faces.
        </p>
      </div>
      <div className="grid">
        {targetPhoto && (
          <article className="card query">
            <img src={targetPhoto} alt="query" />
            <div className="card-body">
              <span className="chip">Your query</span>
              <strong>{query.name ?? (query.humanityId ? 'Unnamed' : 'Query photo')}</strong>
              {query.humanityId && (
                <code title={query.humanityId}>
                  {query.humanityId.slice(0, 10)}…{query.humanityId.slice(-4)}
                </code>
              )}
              {query.chain && (
                <div className="meta">
                  <span className="chip">{query.chain}</span>
                </div>
              )}
              {query.profileUrl && (
                <a href={query.profileUrl} target="_blank" rel="noreferrer">
                  View profile ↗
                </a>
              )}
            </div>
          </article>
        )}
        {result.matches.map((match) => (
          <MatchCard key={`${match.chain}:${match.humanityId}:${match.createdAt}`} match={match} />
        ))}
      </div>
    </section>
  );
}

function MatchCard({ match }: { match: MatchResponse }) {
  const percent = Math.max(0, Math.min(100, match.score * 100));
  return (
    <article className={`card band-${match.band}`}>
      <img
        src={`${IPFS_GATEWAY}${match.photoUri}`}
        alt={match.name ?? match.humanityId}
        loading="lazy"
      />
      <div className="card-body">
        <div className="score-row">
          <span className="score">{percent.toFixed(1)}%</span>
          <span className={`chip band-chip-${match.band}`}>{BAND_LABEL[match.band]}</span>
        </div>
        <div className="score-bar" aria-hidden>
          <span style={{ width: `${percent}%` }} />
        </div>
        <strong>{match.name ?? 'Unnamed'}</strong>
        <code title={match.humanityId}>
          {match.humanityId.slice(0, 10)}…{match.humanityId.slice(-4)}
        </code>
        <div className="meta">
          <span className={`chip status-${match.status}`}>{match.status}</span>
          <span className="chip">{match.chain}</span>
          <span>{new Date(match.createdAt * 1000).toLocaleDateString()}</span>
        </div>
        <a href={match.profileUrl} target="_blank" rel="noreferrer">
          View profile ↗
        </a>
      </div>
    </article>
  );
}
