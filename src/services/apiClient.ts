// Typed wrapper around `fetch` to the san-mes Worker.
//
// Phase 2 of the Cloudflare D1 migration: read traffic that lands on
// the Worker comes through here. The wrapper exists so callers don't
// each re-implement the same boilerplate (timeout, JSON parsing, auth
// header injection, perfMonitor integration) and so we can swap the
// transport behind a single seam later (Phase 5 cutover).
//
// Contract:
//   - Returns `{ data, error }` matching the existing `getXxx` shape so
//     callers can be ported by changing one line.
//   - Bails out with `{ data: null, error: 'offline' }` when the
//     connectivity monitor says we're offline. No network round-trip
//     is wasted while disconnected.
//   - Treats 5xx as `{ data: null, error: '<message>' }` and reports
//     it to perfMonitor so we surface failures, but DOES NOT retry.
//     Reads are expected to fail visibly; writes have their own
//     offlineQueue retry path.
//   - Surfaces the Worker's `error` string verbatim so callers can
//     branch on shapes like `'unauthorised'` / `'forbidden'`.
//   - JSON parse failure → 500 with the raw status surfaced.
//
// The Worker URL is hard-coded for Phase 2; Phase 2.5 may move it
// behind a feature flag for staging vs prod. Hard-coded HTTPS keeps
// the iOS App Transport Security default intact (no exception domains
// needed — the Worker is HTTPS-only).

import { supabase } from '../lib/supabase';
import { perfMonitor } from './perfMonitor';

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
 * Read the current Supabase session's access token, if any. Today the
 * app uses PIN-based custom auth (no Supabase auth session), so this
 * almost always resolves to `null` — that's fine because every Phase
 * 2 read endpoint serves anonymous content. The hook stays in place
 * so the future Auth-via-Supabase migration (Phase 6) can flow JWTs
 * through transparently.
 */
async function getAuthHeader(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
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
    const auth = await getAuthHeader();
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

    if (res.status >= 500) {
      // 5xx is logged but not retried — the Worker is the authoritative
      // failure source and offlineQueue's write retry path doesn't apply
      // to reads. Callers that need graceful degradation fall through
      // to Supabase on a non-null error.
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

export function apiPost<T>(path: string, body: unknown, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
  return request<T>(path, { ...opts, method: 'POST', body });
}

export function apiPatch<T>(path: string, body: unknown, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
  return request<T>(path, { ...opts, method: 'PATCH', body });
}

export function apiDelete<T>(path: string, opts: ApiOptions = {}): Promise<ApiResponse<T>> {
  return request<T>(path, { ...opts, method: 'DELETE' });
}
