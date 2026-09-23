import { useEffect, useState } from 'react';
import type { IndexStatusResponse } from '@pohdf/core';
import { fetchIndexStatus } from '../api';

function relativeTime(unixSeconds: number): string {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - unixSeconds) / 60));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; status: IndexStatusResponse }
  | { kind: 'unavailable' };

export function StatusFooter() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchIndexStatus()
      .then((status) => {
        if (cancelled) return;
        setState(status ? { kind: 'ready', status } : { kind: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <footer>
      {state.kind === 'loading' && (
        <span className="status-pill" aria-busy="true">
          <span className="status-dot pending" aria-hidden />
          Checking index status…
        </span>
      )}
      {state.kind === 'ready' && (
        <span className="status-pill">
          <span className="status-dot" aria-hidden />
          {state.status.count.toLocaleString()} faces indexed · updated{' '}
          {relativeTime(state.status.builtAt)} · model {state.status.modelId}
          {state.status.pendingRetries > 0 &&
            ` · ${state.status.pendingRetries} photos pending retry`}
        </span>
      )}
      {state.kind === 'unavailable' && (
        <span className="status-pill">
          <span className="status-dot offline" aria-hidden />
          Index status unavailable
        </span>
      )}
    </footer>
  );
}
