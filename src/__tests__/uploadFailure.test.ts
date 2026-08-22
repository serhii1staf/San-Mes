/**
 * Bug fix: app-wide-degradation-fixes, block H (401 on image upload), task 3.2.
 *
 * Covers `src/lib/uploadFailure.ts`. Two things are being pinned down here:
 *   1. Every failure shape maps to exactly one actionable reason (totality).
 *   2. The three server-side causes behind a live-token 401 stay MERGED. That
 *      merge is a privacy decision, not an oversight, so it gets an explicit test
 *      to stop a future reader from "fixing" it into an information leak.
 */

import {
  CLOCK_SKEW_SEC,
  classifyUploadFailure,
  isTransientUploadFailure,
  readExpClaimWithoutVerifying,
  uploadFailureMessageKey,
  type UploadFailureReason,
} from '../lib/uploadFailure';

const NOW = 1_700_000_000;

/** Build an unsigned token carrying a given `exp`. Signature is never verified. */
function tokenWithExp(exp: number | null): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const payload: Record<string, unknown> = { sub: 'user-1', iss: 'san-mes-api' };
  if (exp !== null) payload.exp = exp;
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`;
}

const LIVE_TOKEN = tokenWithExp(NOW + 30 * 24 * 3600);
const EXPIRED_TOKEN = tokenWithExp(NOW - 3600);

describe('readExpClaimWithoutVerifying', () => {
  it('reads a numeric exp claim', () => {
    expect(readExpClaimWithoutVerifying(tokenWithExp(1234))).toBe(1234);
  });

  it('returns null when there is no exp claim', () => {
    expect(readExpClaimWithoutVerifying(tokenWithExp(null))).toBeNull();
  });

  // "Cannot tell" must never be conflated with "expired" — the caller falls back
  // to the more conservative message when this returns null.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['not a jwt', 'garbage'],
    ['two segments', 'aaa.bbb'],
    ['non-base64url payload', 'aaa.!!!!.ccc'],
    ['payload that is not json', 'aaa.Zm9vYmFy.ccc'],
  ])('returns null and does not throw for %s', (_label, token) => {
    expect(() => readExpClaimWithoutVerifying(token as string | null)).not.toThrow();
    expect(readExpClaimWithoutVerifying(token as string | null)).toBeNull();
  });
});

describe('classifyUploadFailure', () => {
  it('maps an aborted request to timeout, ahead of any status', () => {
    expect(
      classifyUploadFailure({ status: 401, transportError: 'abort', token: LIVE_TOKEN, nowSec: NOW }),
    ).toBe('timeout');
  });

  it('maps a transport failure to offline, ahead of any status', () => {
    expect(
      classifyUploadFailure({ status: 500, transportError: 'network', token: LIVE_TOKEN, nowSec: NOW }),
    ).toBe('offline');
  });

  it('maps a missing token to not_signed_in', () => {
    expect(classifyUploadFailure({ status: null, token: null, nowSec: NOW })).toBe('not_signed_in');
    expect(classifyUploadFailure({ status: 401, token: '', nowSec: NOW })).toBe('not_signed_in');
  });

  it('maps 401 with an expired token to session_expired', () => {
    expect(classifyUploadFailure({ status: 401, token: EXPIRED_TOKEN, nowSec: NOW })).toBe(
      'session_expired',
    );
  });

  it('maps 401 with a live token to auth_rejected', () => {
    expect(classifyUploadFailure({ status: 401, token: LIVE_TOKEN, nowSec: NOW })).toBe(
      'auth_rejected',
    );
  });

  it('treats 403 the same as 401', () => {
    expect(classifyUploadFailure({ status: 403, token: LIVE_TOKEN, nowSec: NOW })).toBe(
      'auth_rejected',
    );
  });

  // A token expiring within the skew window is treated as already expired, so a
  // slightly-off device clock produces the actionable message rather than the
  // ambiguous one.
  it('counts a token inside the clock-skew window as expired', () => {
    const edge = tokenWithExp(NOW + CLOCK_SKEW_SEC - 1);
    expect(classifyUploadFailure({ status: 401, token: edge, nowSec: NOW })).toBe('session_expired');

    const justOutside = tokenWithExp(NOW + CLOCK_SKEW_SEC + 10);
    expect(classifyUploadFailure({ status: 401, token: justOutside, nowSec: NOW })).toBe(
      'auth_rejected',
    );
  });

  it('falls back to auth_rejected when the token has no exp to read', () => {
    expect(classifyUploadFailure({ status: 401, token: tokenWithExp(null), nowSec: NOW })).toBe(
      'auth_rejected',
    );
  });

  it.each([
    [503, 'storage_not_configured'],
    [413, 'too_large'],
    [400, 'bad_image'],
    [500, 'server_error'],
    [502, 'server_error'],
    [200, 'server_error'],
  ])('maps status %i to %s', (status, expected) => {
    expect(classifyUploadFailure({ status, token: LIVE_TOKEN, nowSec: NOW })).toBe(expected);
  });

  it('is total: any status yields a reason with a message key', () => {
    for (let status = 100; status <= 599; status++) {
      const reason = classifyUploadFailure({ status, token: LIVE_TOKEN, nowSec: NOW });
      expect(typeof reason).toBe('string');
      expect(uploadFailureMessageKey(reason)).toBeTruthy();
    }
  });

  /**
   * THE MERGE IS THE POINT.
   *
   * Secret unset on Vercel, secret mismatched against the Worker, and token
   * revoked server-side are three different server states. All three arrive at the
   * client as an identical `401 {"error":"unauthorised"}` with a live token, and
   * all three must produce ONE message.
   *
   * Distinguishing them client-side would require the server to say which it was,
   * and "my signing secret is not configured" is a fact about our deployment being
   * handed to an unauthenticated caller. The authoritative answer lives behind the
   * admin key at `GET /api/admin/auth-fingerprint`.
   */
  it('merges the three server-side causes of a live-token 401 into one reason', () => {
    const serverStatesIndistinguishableFromTheClient = [
      { label: 'JWT_SECRET unset on Vercel', status: 401 },
      { label: 'JWT_SECRET mismatched vs Worker', status: 401 },
      { label: 'token revoked server-side', status: 401 },
    ];

    const reasons = new Set(
      serverStatesIndistinguishableFromTheClient.map((s) =>
        classifyUploadFailure({ status: s.status, token: LIVE_TOKEN, nowSec: NOW }),
      ),
    );

    expect(reasons.size).toBe(1);
    expect([...reasons][0]).toBe('auth_rejected');
  });

  it('never surfaces a message that claims the server is misconfigured', () => {
    // `auth_rejected` must not map onto the service-unavailable copy, which would
    // imply a server-side diagnosis the client cannot make.
    expect(uploadFailureMessageKey('auth_rejected')).toBe('create.upload_fail.auth_rejected');
    expect(uploadFailureMessageKey('auth_rejected')).not.toBe(
      uploadFailureMessageKey('storage_not_configured'),
    );
  });
});

describe('isTransientUploadFailure', () => {
  // Only genuine transport failures may go to the offline queue. Queuing an auth
  // failure would retry forever and never succeed, which is how a post ends up
  // silently never published.
  it('accepts only offline and timeout', () => {
    const all: UploadFailureReason[] = [
      'not_signed_in',
      'session_expired',
      'auth_rejected',
      'timeout',
      'offline',
      'storage_not_configured',
      'too_large',
      'bad_image',
      'server_error',
    ];
    const transient = all.filter(isTransientUploadFailure);
    expect(transient.sort()).toEqual(['offline', 'timeout']);
  });
});
