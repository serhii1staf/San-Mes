// Typed wrapper around `fetch` to the san-mes Worker.
//
// Phase 5 of the Cloudflare D1 migration: every read/write from the
// app funnels through here. The wrapper exists so callers don't each
// re-implement the same boilerplate (timeout, JSON parsing, auth
// header injection, perfMonitor integration) and so we can swap the
// transport behind a single seam later.
//
// Contract:
//   - Returns `{ data, error }` matching the existing `getXxx` shape so
//     callers can be ported by changing one line.
//   - Bails out with `{ data: null, error: 'offline' }` when the
//     connectivity monitor says we're offline. No network round-trip
//     is wasted while disconnected.
//   - Treats 5xx as `{ data: null, error: '<message>' }` and reports
//     it to perfMonitor so we surface failures, but DOES NOT retry.
//   - On 401 we clear the token and notify the auth store so the
//     user re-authenticates. Other 4xx surface verbatim so callers
//     can branch on shapes like `'unauthorised'` / `'forbidden'`.
//   - JSON parse failure → 500 with the raw status surfaced.
//
// The Worker URL is hard-coded to keep the iOS App Transport Security
// default intact (no exception domains needed — the Worker is
// HTTPS-only).

import { perfMonitor } from './perfMonitor';
import { clearAuthToken, getAuthToken } from './authClient';

export const WORKER_BASE_URL = 'https://san-mes-api.odi44972.workers.dev';

/** Default per-request timeout in ms. Configurable per-call. */
const DEFAULT_TIMEOUT_MS = 8000;

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

export interface ApiOptions {
  /** Per-call timeout override in milliseconds. */
  timeoutMs?: number;
  /** Skip the Authorization header (used by anonymous reads in tests). */
  skipAuth?: boolean;
  /** Extra headers merged on top of the defaults. */
  headers?: Record<string, string>;
}

/**
 * Lazy-import the connectivity store so this module doesn't pull the
 * monitor (and its lazy `processQueue` import chain) into early-startup
 * bundles. Returns `true` if we should proceed with the network call.
 */
async function isOnline(): Promise<boolean> {
  try {
    const { useConnectivityStore } = await import('./connectivityMonitor');
    return useConnectivityStore.getState().isOnline;
  } catch {
    // If the store isn't initialised yet, be optimistic and try.
    return true;
  }
}

/**
 * Read the active Worker JWT from MMKV (set by `authClient` after
 * register / login / refresh). Synchronous because MMKV is. Returns
 * `null` if the user isn't authenticated yet.
 */
function getAuthHeader(): string | null {
  const token = getAuthToken();
  return token ? `Bearer ${token}` : null;
}

/**
 * Force-clears the local auth state when the Worker says the token is
 * dead. The auth store is lazy-imported because importing it eagerly
 * pulls in zustand + persist middleware on a path that runs on every
 * request — and on a 200 we don't need any of that. Notifying the
 * store wipes `user` / `isAuthenticated`, which causes the root
 * navigator to bounce the user back to the welcome screen.
 *
 * Hardening: in a 401 storm (e.g. the auth token in MMKV is
 * corrupt and every parallel fetch fails simultaneously), we must
 * NOT fire dozens of dynamic imports + logout dispatches at once.
 * That pattern was implicated in a Hermes EXC_BAD_ACCESS crash
 * (`GCScope::_newChunkAndPHV`) seen in production right after the
 * D1 cutover. The simple in-flight latch + 1-second throttle below
 * caps the work to one logout per second per cold-started JS
 * runtime, which is more than enough for the actual "your token
 * expired" case.
 */
let _unauthInFlight = false;
let _lastUnauthAt = 0;
async function handleUnauthorised(): Promise<void> {
  const now = Date.now();
  if (_unauthInFlight) return;
  if (now - _lastUnauthAt < 1000) return;
  _unauthInFlight = true;
  _lastUnauthAt = now;
  try {
    clearAuthToken();
  } catch {}
  try {
    const { useAuthStore } = await import('../store/authStore');
    // Skip the dispatch when the store already reflects the
    // logged-out state — saves the entire root re-render path.
    if (useAuthStore.getState().isAuthenticated) {
      useAuthStore.getState().logout();
    }
  } catch {}
  finally {
    _unauthInFlight = false;
  }
}

interface InternalRequestOptions extends ApiOptions {
  method: string;
  body?: unknown;
}

async function request<T>(path: string, opts: InternalRequestOptions): Promise<ApiResponse<T>> {
  // Offline short-circuit so we don't burn a fetch attempt + timeout
  // when the OS already knows the request will fail. Callers can use
  // this signal to fall back to a cached value rather than spinning.
  if (!(await isOnline())) {
    return { data: null, error: 'offline' };
  }

  const url = `${WORKER_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers ?? {}),
  };
  if (!opts.skipAuth) {
    const auth = getAuthHeader();
    if (auth) headers['Authorization'] = auth;
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    // Try to parse the body as JSON regardless of status — the Worker
    // emits the `{ data, error }` shape on every response, including
    // 4xx / 5xx, so the caller can branch on `error`.
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      const msg = `bad-json:${res.status}`;
      perfMonitor.recordError(`apiClient ${opts.method} ${path}: ${msg}`);
      return { data: null, error: msg };
    }

    // Guard against malformed bodies that don't carry `data` / `error`.
    const body = parsed as { data?: T | null; error?: string | null };
    if (typeof body !== 'object' || body === null) {
      const msg = `bad-shape:${res.status}`;
      perfMonitor.recordError(`apiClient ${opts.method} ${path}: ${msg}`);
      return { data: null, error: msg };
    }

    if (res.status === 401) {
      // Token expired or rotated. Clear local auth + nudge the auth
      // store so the next render bounces to the welcome screen.
      // Don't await — the unauth flow is best-effort and shouldn't
      // delay returning the response.
      void handleUnauthorised();
    }

    if (res.status >= 500) {
      const errMsg = body.error ?? `http-${res.status}`;
      perfMonitor.recordError(`apiClient ${opts.method} ${path}: 5xx ${errMsg}`);
      return { data: null, error: errMsg };
    }

    // 200 / 4xx: surface the Worker's error string verbatim so callers
    // can match on `'unauthorised'`, `'forbidden'`, `'invalid …'`, etc.
    return { data: body.data ?? null, error: body.error ?? null };
  } catch (e: any) {
    clearTimeout(timer);
    const aborted = e?.name === 'AbortError';
    const msg = aborted ? 'timeout' : (e?.message || 'network error');
    perfMonitor.recordError(`apiClient ${opts.method} ${path}: ${msg}`, e?.stack);
    return { data: null, error: msg };
  }
}

// ─── Public surface ───────────────────────────────────────────────────────

export function apiGet<T>(path: string, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
  return request<T>(path, { ...opts, method: 'GET' });
}

export function apiPost<T>(path: string, body?: unknown, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
  return request<T>(path, { ...opts, method: 'POST', body });
}

export function apiPatch<T>(path: string, body: unknown, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
  return request<T>(path, { ...opts, method: 'PATCH', body });
}

export function apiPut<T>(path: string, body?: unknown, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
  return request<T>(path, { ...opts, method: 'PUT', body });
}

export function apiDelete<T>(path: string, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
  return request<T>(path, { ...opts, method: 'DELETE' });
}
