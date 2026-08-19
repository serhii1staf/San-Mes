import { kvGetStringSync, kvSetString } from './kvStore';

/**
 * apiHost — which backend hostname the app talks to, with failover.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * Every backend hostname in the app was a hard-coded `const`, with no fallback
 * anywhere. That makes a single DNS/SNI block a total outage: if
 * `san-mes-api.odi44972.workers.dev` becomes unreachable, the app cannot read, cannot
 * log in, and cannot recover — there is nothing else to try.
 *
 * `*.workers.dev` is a particularly poor single point of failure. It is shared by
 * every free Cloudflare account, so it is blocked as a category rather than as a
 * business (it is reported unreachable from mainland China), and the account
 * subdomain sits in the TLS SNI, so filtering it is trivial. Cloudflare itself
 * documents that Russian ISPs throttle traffic to Cloudflare-fronted services close
 * to the user, and its usual mitigation — a DNS-only record pointing at your own
 * origin — is not available to a Worker, which has no non-Cloudflare origin.
 *
 * So the host became a LIST instead of a constant.
 *
 * ── HOW FAILOVER WORKS ────────────────────────────────────────────────────────
 * Rotation happens ONLY on a transport-level failure (timeout, DNS failure, TLS
 * failure, connection reset). An HTTP response — including 401, 403, 404 and 500 —
 * PROVES the host is reachable, so it must never trigger rotation; doing so would
 * make an ordinary server error look like a blocked domain and start flapping
 * between hosts.
 *
 * The winning host is persisted, so a user in a blocked network pays the discovery
 * cost once rather than on every launch. It is stored globally (not per account)
 * because reachability is a property of the network, not of the user.
 *
 * ── ADDING THE CUSTOM DOMAIN ──────────────────────────────────────────────────
 * `api.san-m-app.com` is listed as a candidate but is NOT yet provisioned — see the
 * `[[routes]]` block added to `workers/api/wrangler.toml`. Until the DNS record
 * exists it simply fails and we rotate straight back, which is why it is listed
 * second: the known-good host stays the default and the escape hatch costs nothing
 * while it is dormant. Once the custom domain is live it should be promoted to first.
 */

/**
 * Candidate hosts, in preference order. No trailing slashes.
 *
 * Keep the known-good host first. Every entry must serve the identical `/v1/*` API,
 * because the app cannot tell them apart beyond reachability.
 */
export const API_HOSTS: readonly string[] = [
  'https://san-mes-api.odi44972.workers.dev',
  // Escape hatch. Provisioned via wrangler `[[routes]] custom_domain = true`.
  // Dormant (and harmless) until that DNS record exists.
  'https://api.san-m-app.com',
];

const STORAGE_KEY = 'api_host';

/**
 * Currently preferred host. Read synchronously at module load so the very first
 * request already uses the host that worked last time — no async warm-up, and no
 * window where a blocked host gets retried on every cold start.
 */
let current: string = (() => {
  try {
    const saved = kvGetStringSync(STORAGE_KEY);
    // Only honour a saved value that is still a known candidate: a host removed from
    // the list in an app update must not keep being used.
    if (saved && API_HOSTS.includes(saved)) return saved;
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return API_HOSTS[0];
})();

/** The host to use for the next request. */
export function getApiHost(): string {
  return current;
}

/**
 * Move to the next candidate after a transport failure on `failedHost`.
 *
 * Takes the host that failed rather than reading `current`, so a rotation triggered
 * by a response that arrived late (after another caller already rotated) cannot skip
 * a candidate. Returns the new host, or `null` when there is nothing else to try —
 * which the caller should treat as a genuine network failure rather than a block.
 */
export function rotateApiHost(failedHost: string): string | null {
  if (API_HOSTS.length < 2) return null;
  // Someone else already rotated away from this host — nothing to do, and the
  // caller should use whatever is current now.
  if (failedHost !== current) return current;

  const idx = API_HOSTS.indexOf(failedHost);
  const next = API_HOSTS[(idx + 1) % API_HOSTS.length];
  if (next === failedHost) return null;

  current = next;
  try {
    kvSetString(STORAGE_KEY, next);
  } catch {
    // In-memory rotation still applies for this session.
  }
  return next;
}

/**
 * Whether an error string from a fetch attempt indicates the HOST is unreachable,
 * as opposed to the server having answered with something we did not like.
 *
 * Deliberately narrow. Anything that produced an HTTP status is reachable.
 */
export function isTransportFailure(error: string | null | undefined): boolean {
  if (!error) return false;
  return (
    error === 'timeout' ||
    error === 'network error' ||
    error.startsWith('Network request failed') ||
    error.includes('ENOTFOUND') ||
    error.includes('ECONNREFUSED') ||
    error.includes('ECONNRESET') ||
    error.includes('SSL') ||
    error.includes('certificate')
  );
}
