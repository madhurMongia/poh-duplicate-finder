import { describe, expect, it, vi } from 'vitest';
import { IpfsClient, IpfsFetchError, normalizeIpfsPath } from '../src/ipfs.js';

const G1 = 'https://one.example';
const G2 = 'https://two.example';

describe('normalizeIpfsPath', () => {
  it('normalizes the supported forms', () => {
    expect(normalizeIpfsPath('/ipfs/Qm1/photo.jpg')).toBe('/ipfs/Qm1/photo.jpg');
    expect(normalizeIpfsPath('ipfs://Qm1/photo.jpg')).toBe('/ipfs/Qm1/photo.jpg');
    expect(normalizeIpfsPath('Qm1/photo.jpg')).toBe('/ipfs/Qm1/photo.jpg');
  });

  it('rejects non-ipfs absolute paths', () => {
    expect(() => normalizeIpfsPath('/http/whatever')).toThrow(/unsupported/);
  });
});

describe('IpfsClient.fetchBytes', () => {
  it('returns from the first healthy gateway', async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith(G1)) throw new Error('connection refused');
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const client = new IpfsClient({ gateways: [G1, G2], fetchFn: fetchFn as typeof fetch });
    expect(Array.from(await client.fetchBytes('/ipfs/Qm1'))).toEqual([1, 2, 3]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('treats non-2xx as a failed gateway and falls through', async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) =>
      String(url).startsWith(G1) ? new Response('nope', { status: 404 }) : new Response('ok'),
    );
    const client = new IpfsClient({ gateways: [G1, G2], fetchFn: fetchFn as typeof fetch });
    expect(new TextDecoder().decode(await client.fetchBytes('Qm1'))).toBe('ok');
  });

  it('aborts a hung gateway after the timeout and tries the next', async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).startsWith(G1)) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return new Response('rescued');
    });
    const client = new IpfsClient({
      gateways: [G1, G2],
      timeoutMs: 20,
      fetchFn: fetchFn as typeof fetch,
    });
    expect(new TextDecoder().decode(await client.fetchBytes('Qm1'))).toBe('rescued');
  });

  it('throws IpfsFetchError listing every attempt when all gateways fail', async () => {
    const fetchFn = vi.fn(async () => new Response('x', { status: 500 }));
    const client = new IpfsClient({ gateways: [G1, G2], fetchFn: fetchFn as typeof fetch });
    const err = await client.fetchBytes('Qm1').catch((e) => e);
    expect(err).toBeInstanceOf(IpfsFetchError);
    expect(err.attempts).toHaveLength(2);
    expect(err.message).toContain('HTTP 500');
  });
});

describe('IpfsClient.fetchJson', () => {
  it('parses JSON bodies', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ photo: '/ipfs/Qm2' })));
    const client = new IpfsClient({ gateways: [G1], fetchFn: fetchFn as typeof fetch });
    expect(await client.fetchJson('/ipfs/Qm1')).toEqual({ photo: '/ipfs/Qm2' });
  });
});
