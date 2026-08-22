// Classify WHY an image upload failed, so the UI can say something actionable
// instead of surfacing a raw `upload failed (401) {"error":"unauthorised"}`.
//
// WHERE THE CLASSIFICATION HAPPENS, AND WHY HERE
//   There is a real tension in the requirements. The user must be able to tell
//   "your session expired, sign in again" from "the server is misconfigured".
//   But the server must NOT tell an unauthenticated caller whether its signing
//   secret is configured — that is information about our deployment, handed to
//   anyone who can hit the endpoint.
//
//   The tension resolves by classifying on the CLIENT. The client already holds
//   its own token, so reading that token's own `exp` claim gives it no
//   information it did not already have. `api/r2-upload.ts` therefore stays
//   exactly as it is: `401 {"error":"unauthorised"}`, one body, no extra fields.
//   Any machine-readable reason code in the response would itself be the leak.
//
//   The authoritative answer to "is the secret configured" lives behind the
//   admin key, at `GET /api/admin/auth-fingerprint`.
//
// THE DELIBERATE AMBIGUITY
//   `auth_rejected` merges three server-side causes: secret not set, secret
//   mismatched, token revoked. That merge is intentional, not an omission — see
//   the note on that branch below. A unit test asserts the merge so a future
//   reader does not "improve" it into a leak.

/** Seconds of tolerance for device/server clock skew when reading `exp`. */
export const CLOCK_SKEW_SEC = 60;

export type UploadFailureReason =
  /** No token at all — the caller is not signed in. Never reaches the network. */
  | 'not_signed_in'
  /** Our own token says it is past `exp`. Actionable: sign in again. */
  | 'session_expired'
  /** Server refused a token that looks live. Cause is server-side and ambiguous. */
  | 'auth_rejected'
  /** Upload aborted by our own timeout (captive portal, throttled uplink). */
  | 'timeout'
  /** Transport never completed — no usable HTTP status. */
  | 'offline'
  /** 503: the upload endpoint has no R2 configuration. */
  | 'storage_not_configured'
  /** 413: body above the 4 MB cap. */
  | 'too_large'
  /** 400: rejected by content-type allowlist or magic-byte sniffing. */
  | 'bad_image'
  /** Anything else the server returned. */
  | 'server_error';

export interface UploadFailureInput {
  /** HTTP status, or null when the request never produced a response. */
  status: number | null;
  /** Transport-level outcome, when there was no HTTP response. */
  transportError?: 'abort' | 'network' | null;
  /** The caller's own bearer token, if it had one. */
  token?: string | null;
  /** Current time in seconds. Injected so tests are not clock-dependent. */
  nowSec?: number;
}

/**
 * Decode a JWT's `exp` claim WITHOUT verifying the signature.
 *
 * Legitimate here specifically because this is the caller's own token and the
 * result drives nothing but a UI message. It grants no privilege, so there is
 * nothing for a forged `exp` to buy: claiming "not expired" only lands the caller
 * on `auth_rejected`, which is the more conservative message anyway.
 *
 * Never throws — a malformed token yields null, which the caller treats as
 * "cannot tell", not as "valid".
 */
export function readExpClaimWithoutVerifying(token: string | null | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payloadB64 = parts[1];
    if (!payloadB64 || /[^A-Za-z0-9_-]/.test(payloadB64)) return null;

    // base64url -> base64, then pad to a multiple of 4 for `atob`/Buffer.
    let b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';

    // `atob` in the RN runtime, `Buffer` under Node (tests, and any server-side
    // reuse). Both are checked rather than assumed so this module stays portable.
    const json =
      typeof globalThis.atob === 'function'
        ? globalThis.atob(b64)
        : Buffer.from(b64, 'base64').toString('binary');

    const payload = JSON.parse(json) as Record<string, unknown>;
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Map a failed upload attempt to a single actionable reason.
 *
 * Total: every input produces a reason. Transport outcomes are checked before
 * status codes because a request that never completed has no meaningful status.
 */
export function classifyUploadFailure(input: UploadFailureInput): UploadFailureReason {
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);

  // No HTTP response at all — the status field is meaningless here.
  if (input.transportError === 'abort') return 'timeout';
  if (input.transportError === 'network') return 'offline';

  // Never reached the network: we had nothing to authenticate with.
  if (!input.token) return 'not_signed_in';

  if (input.status === 401 || input.status === 403) {
    const exp = readExpClaimWithoutVerifying(input.token);
    if (exp !== null && exp <= nowSec + CLOCK_SKEW_SEC) {
      return 'session_expired';
    }
    // Token present and not past its own `exp`, yet the server refused it.
    //
    // The cause is one of: JWT_SECRET unset on Vercel, JWT_SECRET mismatched
    // against the Worker, or the token was revoked server-side. We do NOT
    // distinguish them in the user-facing message, because "the server has no
    // signing secret" is a fact about our deployment and the caller here is, by
    // definition, unauthenticated. Merging is the privacy-preserving choice.
    return 'auth_rejected';
  }

  if (input.status === 503) return 'storage_not_configured';
  if (input.status === 413) return 'too_large';
  if (input.status === 400) return 'bad_image';

  return 'server_error';
}

/** i18n key for the message shown to the user for each reason. */
const MESSAGE_KEYS: Record<UploadFailureReason, string> = {
  not_signed_in: 'create.upload_fail.not_signed_in',
  session_expired: 'create.upload_fail.session_expired',
  auth_rejected: 'create.upload_fail.auth_rejected',
  timeout: 'create.upload_fail.timeout',
  offline: 'create.upload_fail.offline',
  storage_not_configured: 'create.upload_fail.service_unavailable',
  server_error: 'create.upload_fail.service_unavailable',
  too_large: 'create.alert.file_too_large_pick',
  bad_image: 'create.upload_fail.bad_image',
};

export function uploadFailureMessageKey(reason: UploadFailureReason): string {
  return MESSAGE_KEYS[reason];
}

/**
 * Should this failure be handed to the offline queue instead of shown as an error?
 *
 * Only genuinely transient transport failures qualify. Auth and validation
 * failures would be retried forever by the queue without ever succeeding, so they
 * must surface to the user instead.
 */
export function isTransientUploadFailure(reason: UploadFailureReason): boolean {
  return reason === 'offline' || reason === 'timeout';
}
