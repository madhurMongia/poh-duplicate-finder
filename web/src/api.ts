import type {
  IndexStatusResponse,
  LookupErrorResponse,
  LookupResponse,
} from '@pohdf/core';

type LookupOutcome = LookupResponse | LookupErrorResponse;

export const IPFS_GATEWAY = 'https://cdn.kleros.link';

export async function lookupByPhoto(photo: File): Promise<LookupOutcome> {
  const form = new FormData();
  form.append('photo', photo);
  const res = await fetch('/api/lookup', { method: 'POST', body: form });
  return (await res.json()) as LookupOutcome;
}

export async function lookupByProfile(profile: string): Promise<LookupOutcome> {
  const res = await fetch('/api/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  });
  return (await res.json()) as LookupOutcome;
}

export async function fetchIndexStatus(): Promise<IndexStatusResponse | null> {
  const res = await fetch('/api/status');
  return res.ok ? ((await res.json()) as IndexStatusResponse) : null;
}

export interface ProfilePreview {
  humanityId: string;
  chain: string;
  name?: string;
  photoUri?: string;
  profileUrl: string;
}

/** Returns the preview, or null when no profile matches the ref. */
export async function fetchProfilePreview(
  ref: string,
  signal?: AbortSignal,
): Promise<ProfilePreview | null> {
  const res = await fetch(`/api/profile?ref=${encodeURIComponent(ref)}`, { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as { ok: boolean; profile?: ProfilePreview };
  return body.ok && body.profile ? body.profile : null;
}
