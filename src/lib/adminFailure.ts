// Classify WHY the admin panel could not be opened.
//
// THE PROBLEM THIS SOLVES
//   `api/admin/status.ts` has three distinct failure modes that all surfaced in the
//   UI as one opaque message, which is why "the panel doesn't open" read as
//   "something is wrong with the hosting":
//
//     1. ADMIN_KEY not set on Vercel   → 503 {"error":"admin_not_configured"},
//        returned BEFORE any password check. There is no correct password.
//     2. Wrong password                → 401 {"error":"Unauthorized"}.
//     3. Network failure or timeout    → no HTTP status at all. `AbortError` fell
//        into the generic catch and was shown as `e?.message`.
//
//   The old `handleUnlock` only special-cased 401/403; everything else became
//   `admin.error.server_returned` with a bare number. So the one failure the
//   operator could actually fix — a missing environment variable — looked exactly
//   like an outage.
//
//   There is a fourth mode the panel still could not express: ADMIN_KEY correct on
//   Vercel but different in the Worker. The panel opens, `workerCounts()` throws
//   `worker counts: 401`, and every metric reads zero — indistinguishable from "the
//   database is down". That one is surfaced via the `config.workerAdminKeyOk` field
//   on the 200 response instead, since it can only be known once authenticated.
//
// ON THE 503 DISCLOSURE
//   The 503 is returned before the password check, so an unauthenticated caller
//   does learn "the admin key is not configured here". That is accepted: it tells
//   them only that there is nothing to guess, and the endpoint is closed either
//   way. Everything else about the configuration is carried inside the 200
//   response, i.e. only after the key check passes.

export type AdminFailureReason =
  /** 503 + `admin_not_configured`: the env var is missing. Operator-fixable. */
  | 'not_configured'
  /** 503 without that marker: the service itself is unavailable. */
  | 'service_unavailable'
  /** 401/403: the supplied key is wrong. */
  | 'wrong_password'
  /** Our own 12 s abort fired. */
  | 'timeout'
  /** Transport never completed. */
  | 'unreachable'
  /** Any other status. */
  | 'server_error';

export interface AdminFailureInput {
  /** HTTP status, or null when there was no response. */
  status: number | null;
  /** The `error` field from the JSON body, when one was parsed. */
  bodyError?: string | null;
  /** Transport-level outcome, when there was no HTTP response. */
  transportError?: 'abort' | 'network' | null;
}

/**
 * Map a failed admin request to one reason.
 *
 * Transport outcomes are checked first: a request that never completed has no
 * meaningful status, and previously an `AbortError` could be misread as a server
 * response.
 */
export function classifyAdminFailure(input: AdminFailureInput): AdminFailureReason {
  if (input.transportError === 'abort') return 'timeout';
  if (input.transportError === 'network') return 'unreachable';

  if (input.status === 503) {
    // The body marker is what separates "you forgot the env var" from "the
    // function is down". Both are 503; only the first is actionable, and telling
    // them apart is the whole point of this branch.
    return input.bodyError === 'admin_not_configured' ? 'not_configured' : 'service_unavailable';
  }

  if (input.status === 401 || input.status === 403) return 'wrong_password';

  return 'server_error';
}

const MESSAGE_KEYS: Record<AdminFailureReason, string> = {
  not_configured: 'admin.error.not_configured',
  service_unavailable: 'admin.error.service_unavailable',
  wrong_password: 'admin.error.wrong_password',
  timeout: 'admin.error.timeout',
  unreachable: 'admin.error.unreachable',
  server_error: 'admin.error.server_returned',
};

export function adminFailureMessageKey(reason: AdminFailureReason): string {
  return MESSAGE_KEYS[reason];
}

/**
 * Should a stored admin key be discarded on this failure?
 *
 * Only for an actual rejection. After the credential rotation this bug fix
 * requires, an operator with a cached key would otherwise land inside an open
 * panel holding a dead key: the user list comes back empty and the status call
 * 401s, with nothing indicating the key is the problem. Dropping it returns them
 * to the password gate, which is the state that matches reality.
 *
 * Deliberately NOT for `timeout`, `unreachable` or `service_unavailable` — a flaky
 * network would log the operator out for no reason. And deliberately NOT for
 * `not_configured`, where the key may well be correct and the server is simply
 * missing its variable.
 */
export function shouldDiscardStoredKey(reason: AdminFailureReason): boolean {
  return reason === 'wrong_password';
}

/** Configuration diagnostics carried inside a successful status response. */
export interface AdminStatusConfig {
  r2Measured: boolean;
  r2Debug: string | null;
  workerAdminKeyOk: boolean;
  jwtSecretsMatch: boolean | null;
  jwtConfiguredHere: boolean;
}

/**
 * Which configuration warnings the panel should show.
 *
 * Each warning exists because the symptom it explains is attributed to the wrong
 * subsystem without it:
 *
 *   - `jwtConfiguredHere === false` → uploads 401 for every user. Looks like an
 *     app bug. It is a missing environment variable.
 *   - `jwtSecretsMatch === false` → same symptom, different cause (the two sides
 *     drifted). Reported separately because the remedy differs: set the variable
 *     versus reconcile the two.
 *   - `workerAdminKeyOk === false` → every database count reads zero and the D1
 *     row shows `degraded`. Looks like the database is down. It is a key mismatch
 *     between Vercel and the Worker.
 *
 * `jwtSecretsMatch === null` produces NO warning: the check could not run, and
 * inventing a warning from an unknown would train the operator to ignore them.
 * Absence of a warning here means "not known to be broken", not "verified fine" —
 * which is why the missing-secret case is checked independently and first.
 *
 * Returns i18n keys rather than strings so this stays pure and testable.
 */
export function configWarningKeys(config: AdminStatusConfig | undefined): string[] {
  if (!config) return [];
  const keys: string[] = [];

  if (!config.jwtConfiguredHere) {
    keys.push('admin.error.jwt_missing');
  } else if (config.jwtSecretsMatch === false) {
    // Only reported when the secret IS set here — otherwise `jwt_missing` above
    // already says it, and two warnings for one cause is noise.
    keys.push('admin.error.jwt_mismatch');
  }

  if (!config.workerAdminKeyOk) {
    keys.push('admin.error.worker_key_mismatch');
  }

  return keys;
}
