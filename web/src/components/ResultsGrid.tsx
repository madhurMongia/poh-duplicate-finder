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
        {queryPhotoUrl && (
          <article className="card query">
            <img src={queryPhotoUrl} alt="query" />
            <div className="card-body">
              <strong>Query photo</strong>
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
  const percent = (match.score * 100).toFixed(1);
  return (
    <article className={`card band-${match.band}${match.renewal ? ' renewal' : ''}`}>
      <img src={`${IPFS_GATEWAY}${match.photoUri}`} alt={match.name ?? match.humanityId} loading="lazy" />
      <div className="card-body">
        <div className="score-row">
          <span className="score">{percent}%</span>
          <span className={`chip band-chip-${match.band}`}>{BAND_LABEL[match.band]}</span>
        </div>
        {match.renewal && <span className="chip renewal-chip">Same profile (renewal)</span>}
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
