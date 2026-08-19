// Property-based tests for backend host failover.
//
// Library: fast-check (repo convention).
//
// Convention: each property test is tagged with
//   // Property {N}: {short description}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).
//
// WHY THIS EXISTS
// Failover is the app's only defence against a hostname being blocked, and both of
// its failure modes are severe and silent:
//
//   • rotating on a normal HTTP error (a 401 from a wrong PIN, a 500 from a bug)
//     would make the app flap between hosts and could send a token issued by one
//     host to another — so `isTransportFailure` MUST be false for anything that
//     produced a status;
//   • not rotating on a genuine transport failure leaves the app permanently
//     unreachable with no recovery path.
//
// These pin the classification and the rotation's invariants.

import fc from 'fast-check';
import { API_HOSTS, getApiHost, isTransportFailure, rotateApiHost } from '../apiHost';

describe('isTransportFailure', () => {
  // Property 1: only host-unreachable signals classify as transport failures
  it('treats timeouts and network/DNS/TLS errors as transport failures', () => {
    for (const err of [
      'timeout',
      'network error',
      'Network request failed',
      'getaddrinfo ENOTFOUND api.example.com',
      'connect ECONNREFUSED 1.2.3.4:443',
      'read ECONNRESET',
      'SSL handshake failed',
      'unable to verify the first certificate',
    ]) {
      expect(isTransportFailure(err)).toBe(true);
    }
  });

  // Property 2: anything that came back WITH a status is reachable — never rotate
  it('never classifies a server-produced error as a transport failure', () => {
    for (const err of [
      'unauthorised',
      'forbidden',
      'invalid_key_or_pin',
      'username_taken',
      'not found: GET /v1/nope',
      'http-500',
      'bad-json:502',
      'bad-shape:200',
      'offline',
    ]) {
      expect(isTransportFailure(err)).toBe(false);
    }
  });

  // Property 3: absent errors are not failures
  it('returns false for null, undefined and empty', () => {
    expect(isTransportFailure(null)).toBe(false);
    expect(isTransportFailure(undefined)).toBe(false);
    expect(isTransportFailure('')).toBe(false);
  });

  // Property 4: arbitrary strings without a known transport marker are not failures.
  // The classifier is an allowlist — an unrecognised message must NOT trigger a
  // rotation, because guessing wrong here is what causes host flapping.
  it('does not classify arbitrary text as a transport failure', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (s) => {
        fc.pre(
          !/timeout|network error|Network request failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|SSL|certificate/.test(
            s,
          ),
        );
        expect(isTransportFailure(s)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe('rotateApiHost', () => {
  // Property 5: rotation always lands on a DIFFERENT configured candidate
  it('moves to another configured host', () => {
    const before = getApiHost();
    expect(API_HOSTS).toContain(before);
    const next = rotateApiHost(before);
    expect(next).not.toBeNull();
    expect(next).not.toBe(before);
    expect(API_HOSTS).toContain(next as string);
    expect(getApiHost()).toBe(next);
  });

  // Property 6: rotating repeatedly cycles through every host and returns — it never
  // gets stuck on one and never leaves `current` outside the candidate list
  it('cycles through all candidates and returns to the start', () => {
    const start = getApiHost();
    const seen = new Set<string>([start]);
    for (let i = 0; i < API_HOSTS.length; i++) {
      const from = getApiHost();
      const next = rotateApiHost(from);
      if (next === null) break;
      seen.add(next);
      expect(API_HOSTS).toContain(next);
    }
    expect(seen.size).toBe(API_HOSTS.length);
    expect(API_HOSTS).toContain(getApiHost());
  });

  // Property 7: a stale rotation request is ignored.
  // Two concurrent requests can both fail on the same host; the second one must not
  // rotate a SECOND time and skip a candidate.
  it('ignores a rotation for a host that is no longer current', () => {
    const first = getApiHost();
    const second = rotateApiHost(first);
    expect(second).not.toBeNull();
    // A late failure report for the host we already left.
    const again = rotateApiHost(first);
    expect(again).toBe(second);
    expect(getApiHost()).toBe(second);
  });

  // Property 8: candidates are well-formed and distinct — a duplicate would make
  // rotation a no-op loop, and a trailing slash would produce `//v1/...` paths
  it('has distinct, https, slash-free candidates', () => {
    expect(new Set(API_HOSTS).size).toBe(API_HOSTS.length);
    for (const host of API_HOSTS) {
      expect(host.startsWith('https://')).toBe(true);
      expect(host.endsWith('/')).toBe(false);
    }
  });
});
