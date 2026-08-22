// Secret fingerprint: compare two secrets for equality without transmitting
// either of them.
//
// WHY THIS EXISTS
//   The Worker signs HS256 JWTs with `JWT_SECRET` (see `workers/api/src/auth.ts`)
//   and the Vercel functions verify them with their own `process.env.JWT_SECRET`
//   (see `api/_lib/verifyToken.ts`). `verifyWorkerToken` is fail-closed: a missing
//   or mismatched secret rejects EVERY token, and the resulting 401 is
//   indistinguishable from "your token is bad". That ambiguity is what makes the
//   image-upload 401 undiagnosable from the outside.
//
//   This module lets an operator ask both sides "which secret do you hold?" and
//   compare the answers, without either side revealing the secret.
//
// WHY IT DOES NOT LEAK THE SECRET
//   - The secret never crosses the network in any form. What is returned is an
//     HMAC keyed BY the secret over a PUBLIC, fixed constant.
//   - The message is domain-separated (`san-mes-jwt-fingerprint-v1`) and has no
//     `header.payload` shape, so the digest cannot be replayed as a JWT signature.
//   - Truncating to 8 hex chars (32 bits) is enough to compare for equality while
//     making the mapping non-injective: a fingerprint corresponds to a class of
//     values, not to one value.
//   - Both endpoints that expose it are gated behind the admin key, so an
//     unauthenticated caller cannot obtain a fingerprint at all.
//
// KNOWN, ACCEPTED LIMITATION
//   A fingerprint is still a verification oracle: whoever holds the admin key can
//   test guesses offline. Accepted because (a) the admin key already unlocks more
//   sensitive data, and (b) `JWT_SECRET` is by convention 32 random bytes, for
//   which no dictionary exists. If the secret in use turns out NOT to be random,
//   it must be rotated rather than relying on this property.

import crypto from 'crypto';

/**
 * Public, fixed, domain-separated message. Deliberately not a JWT signing input:
 * a real signature covers `base64url(header).base64url(payload)`, so a digest over
 * this constant can never be presented as one.
 */
export const FINGERPRINT_MESSAGE = 'san-mes-jwt-fingerprint-v1';

/** Hex characters kept from the digest. 8 hex = 32 bits — enough to compare. */
export const FINGERPRINT_LENGTH = 8;

export interface FingerprintResult {
  /** Is a non-empty secret configured on this side at all? */
  configured: boolean;
  /** Truncated HMAC, or null when nothing is configured. */
  fingerprint: string | null;
  /** Pinned algorithm — surfaced so a cross-side mismatch is visible. */
  alg: 'HS256';
  /** Pinned issuer — same reason. */
  iss: 'san-mes-api';
}

/**
 * Fingerprint a secret.
 *
 * Returns `configured: false` (and a null fingerprint) for a missing or empty
 * secret rather than fingerprinting the empty string — "not configured" and
 * "configured to something" are the distinction the caller actually needs, and
 * HMAC over an empty key is a valid digest that would hide it.
 */
export function secretFingerprint(secret: string | undefined | null): FingerprintResult {
  const base: Omit<FingerprintResult, 'configured' | 'fingerprint'> = {
    alg: 'HS256',
    iss: 'san-mes-api',
  };

  if (!secret) {
    return { configured: false, fingerprint: null, ...base };
  }

  const full = crypto
    .createHmac('sha256', secret)
    .update(FINGERPRINT_MESSAGE, 'utf8')
    .digest('hex');

  return {
    configured: true,
    fingerprint: full.slice(0, FINGERPRINT_LENGTH),
    ...base,
  };
}
