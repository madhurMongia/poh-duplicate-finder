import type {
  IndexStatusResponse,
  LookupErrorResponse,
  LookupResponse,
} from '@pohdf/core';

export type LookupOutcome = LookupResponse | LookupErrorResponse;

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
