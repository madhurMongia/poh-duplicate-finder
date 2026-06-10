import { describe, expect, it } from 'vitest';
import {
  deriveStatus,
  SubgraphClient,
  SubgraphError,
  type RawRequestStatus,
} from '../src/subgraph.js';

const ENDPOINT = { gnosis: 'https://subgraph.example/gnosis' };

/** fetch fake returning queued GraphQL payloads in order. */
function queuedFetch(payloads: unknown[]): typeof fetch {
  const queue = [...payloads];
  return (async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('fetch queue exhausted');
    return new Response(JSON.stringify(next));
  }) as typeof fetch;
}

function gqlRequest(id: string, t: number, uri: string | null, name: string | null = null) {
  return {
    id,
    creationTime: String(t),
    humanity: { id: '0xAA' + id.slice(2).padEnd(38, '0') },
    claimer: { name },
    evidenceGroup: { evidence: uri ? [{ uri }] : [] },
  };
}

describe('SubgraphClient.fetchClaimRequestsSince', () => {
  it('paginates with a creationTime cursor and dedupes boundary repeats', async () => {
    const fetchFn = queuedFetch([
      { data: { requests: [gqlRequest('0xr1', 100, '/ipfs/e1', 'Ada'), gqlRequest('0xr2', 200, '/ipfs/e2')] } },
      { data: { requests: [gqlRequest('0xr2', 200, '/ipfs/e2'), gqlRequest('0xr3', 300, null)] } },
      { data: { requests: [] } },
    ]);
    const client = new SubgraphClient(ENDPOINT, fetchFn, 2);
    const requests = await client.fetchClaimRequestsSince('gnosis', 0);
    expect(requests.map((r) => r.requestId)).toEqual(['0xr1', '0xr2', '0xr3']);
    expect(requests[0]).toEqual({
      requestId: '0xr1',
      humanityId: '0xaar1000000000000000000000000000000000000',
      creationTime: 100,
      name: 'Ada',
      evidenceUri: '/ipfs/e1',
    });
    expect(requests[2].evidenceUri).toBeNull();
    expect(requests[2].name).toBeUndefined();
  });

  it('wraps GraphQL and HTTP failures in SubgraphError', async () => {
    const gqlError = new SubgraphClient(
      ENDPOINT,
      queuedFetch([{ errors: [{ message: 'rate limited' }] }]),
    );
    await expect(gqlError.fetchClaimRequestsSince('gnosis', 0)).rejects.toThrow(SubgraphError);

    const httpError = new SubgraphClient(ENDPOINT, (async () =>
      new Response('x', { status: 502 })) as typeof fetch);
    await expect(httpError.fetchClaimRequestsSince('gnosis', 0)).rejects.toThrow(/HTTP 502/);

    const noEndpoint = new SubgraphClient({}, queuedFetch([]));
    await expect(noEndpoint.fetchClaimRequestsSince('gnosis', 0)).rejects.toThrow(/no endpoint/);
  });
});

describe('SubgraphClient.fetchStatusSnapshot', () => {
  it('paginates by id and parses status fields', async () => {
    const row = (id: string) => ({
      id,
      status: { id: 'resolved' },
      winnerParty: null,
      expirationTime: '2000',
      humanity: { id: '0xaa', registration: { expirationTime: '3000' } },
    });
    const fetchFn = queuedFetch([
      { data: { requests: [row('0xa'), row('0xb')] } },
      { data: { requests: [row('0xc')] } },
    ]);
    const client = new SubgraphClient(ENDPOINT, fetchFn, 2);
    const snapshot = await client.fetchStatusSnapshot('gnosis');
    expect(snapshot.map((s) => s.requestId)).toEqual(['0xa', '0xb', '0xc']);
    expect(snapshot[0]).toEqual({
      requestId: '0xa',
      statusId: 'resolved',
      winnerPartyId: null,
      requestExpirationTime: 2000,
      humanityHasRegistration: true,
      registrationExpirationTime: 3000,
    });
  });
});

describe('SubgraphClient.resolveProfile', () => {
  const humanityPayload = {
    data: {
      humanity: {
        id: '0xAAbb000000000000000000000000000000000000',
        claimerName: 'ada',
        requests: [gqlRequest('0xr9', 500, '/ipfs/e9')],
      },
    },
  };

  it('resolves a humanity id directly', async () => {
    const client = new SubgraphClient(ENDPOINT, queuedFetch([humanityPayload]));
    const profile = await client.resolveProfile('gnosis', '0xAABB000000000000000000000000000000000000');
    expect(profile).toEqual({
      humanityId: '0xaabb000000000000000000000000000000000000',
      chain: 'gnosis',
      name: 'ada',
      evidenceUri: '/ipfs/e9',
    });
  });

  it('falls back to claimer address resolution', async () => {
    const client = new SubgraphClient(
      ENDPOINT,
      queuedFetch([
        { data: { humanity: null } },
        {
          data: {
            claimer: {
              registration: { humanity: { id: '0xAAbb000000000000000000000000000000000000' } },
              currentRequest: null,
            },
          },
        },
        humanityPayload,
      ]),
    );
    const profile = await client.resolveProfile('gnosis', '0x' + 'd'.repeat(40));
    expect(profile?.humanityId).toBe('0xaabb000000000000000000000000000000000000');
  });

  it('returns null when nothing matches', async () => {
    const client = new SubgraphClient(
      ENDPOINT,
      queuedFetch([{ data: { humanity: null } }, { data: { claimer: null } }]),
    );
    expect(await client.resolveProfile('gnosis', '0x' + 'd'.repeat(40))).toBeNull();
  });
});

describe('deriveStatus', () => {
  const base: RawRequestStatus = {
    requestId: '0xr',
    statusId: 'resolved',
    winnerPartyId: null,
    requestExpirationTime: null,
    humanityHasRegistration: false,
    registrationExpirationTime: null,
  };
  const NOW = 10_000;

  it('maps every branch', () => {
    expect(deriveStatus({ ...base, statusId: 'withdrawn' }, NOW)).toBe('withdrawn');
    expect(deriveStatus({ ...base, statusId: 'vouching' }, NOW)).toBe('pending');
    expect(deriveStatus({ ...base, statusId: 'resolving' }, NOW)).toBe('pending');
    expect(deriveStatus({ ...base, statusId: 'disputed' }, NOW)).toBe('pending');
    expect(deriveStatus({ ...base, winnerPartyId: 'challenger' }, NOW)).toBe('rejected');
    expect(
      deriveStatus(
        { ...base, humanityHasRegistration: true, registrationExpirationTime: NOW + 1 },
        NOW,
      ),
    ).toBe('registered');
    expect(
      deriveStatus(
        { ...base, humanityHasRegistration: true, registrationExpirationTime: NOW - 1 },
        NOW,
      ),
    ).toBe('expired'); // stale registration + past its own expiry
    expect(deriveStatus({ ...base, requestExpirationTime: NOW - 1 }, NOW)).toBe('expired');
    expect(deriveStatus({ ...base, requestExpirationTime: NOW + 1 }, NOW)).toBe('revoked');
    expect(deriveStatus({ ...base, statusId: 'mystery' }, NOW)).toBe('unknown');
  });
});
