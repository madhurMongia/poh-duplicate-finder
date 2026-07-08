import { useEffect, useState } from 'react';
import type { IndexStatusResponse } from '@pohdf/core';
import { fetchIndexStatus } from '../api';

function relativeTime(unixSeconds: number): string {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - unixSeconds) / 60));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export function StatusFooter() {
  const [status, setStatus] = useState<IndexStatusResponse | null>(null);

  useEffect(() => {
    fetchIndexStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <footer>
      {status ? (
        <span className="status-pill">
          <span className="status-dot" aria-hidden />
          {status.count.toLocaleString()} faces indexed · updated {relativeTime(status.builtAt)} ·
          model {status.modelId}
          {status.pendingRetries > 0 && ` · ${status.pendingRetries} photos pending retry`}
        </span>
      ) : (
        <span className="status-pill">
          <span className="status-dot offline" aria-hidden />
          Index status unavailable
        </span>
      )}
    </footer>
  );
}
