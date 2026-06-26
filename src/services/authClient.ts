// Worker-backed auth client.
//
// Phase 6 of the Cloudflare D1 migration: the app no longer talks to
// Supabase Auth. All authentication flows go through the Worker
// (`/v1/auth/*`) which mints HS256 JWTs we keep in MMKV under
// `@san:auth_token`. `apiClient.ts` reads that token on every request
// and attaches it as `Authorization: Bearer <token>`.
//
// Token storage is RAW (not account-scoped) — the token identifies
// which profile is the active account, so it lives outside the
// per-account namespace. AccountSwitcher writes a fresh token here
// when the user switches profiles.
//
// Every public function returns the same `{ profile?, error }` shape
// that the existing call sites (`registerUser`, `loginUser`,
// `loginWithPin`, `deleteAccount` in `src/lib/supabase.ts`) expose,
// so we can swap them seamlessly.

import { kvDeleteRaw, kvGetStringRawSync, kvSetStringRaw } from './kvStore';
import { perfMonitor } from './perfMonitor';
import { t } from '../i18n/store';

export const WORKER_BASE_URL = 'https://san-mes-api.odi44972.workers.dev';
const TOKEN_KEY = '@san:auth_token';

export interface DBProfileLike {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio?: string;
  pin_hash?: string;
  device_key?: string;
  banner_url?: string | null;
  links?: any;
  badge?: string | null;
  is_verified?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface AuthResponse {
  profile: DBProfileLike;
  token: string;
}

// ─── Token storage (synchronous, MMKV-backed) ──────────────────────────

export function getAuthToken(): string | null {
  return kvGetStringRawSync(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  kvSetStringRaw(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  kvDeleteRaw(TOKEN_KEY);
}

// ─── HTTP helper ──────────────────────────────────────────────────────

interface CallOpts {
  method: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  authed?: boolean;
}

/**
 * Lazy-import the connectivity store so this module doesn't pull the
 * monitor into early-startup bundles. Mirrors `apiClient.request`'s
 * offline short-circuit: when the OS already knows we're disconnected,
 * never attempt the fetch — and crucially surface a TRANSIENT error
 * (`'offline'`, never `unauthorised`) so a known-offline foreground
 * can't be mistaken for a token rejection and log the user out.
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
 * Result of a raw Worker call.
 *   - `data` / `error`: unchanged, backward-compatible fields.
 *   - `status`: the HTTP status (or `null` for a transport failure that
 *     never reached the server — timeout / offline / network error).
 *   - `unauthorised`: `true` ONLY for a genuine auth rejection — HTTP
 *     401 or the Worker's `error === 'unauthorised'`. Lets callers tell
 *     a real 401 apart from a transient/transport hiccup.
 */
interface CallResult<T> {
  data: T | null;
  error: string | null;
  status: number | null;
  unauthorised: boolean;
}

async function call<T>(path: string, opts: CallOpts): Promise<CallResult<T>> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  if (opts.authed) {
    const tok = getAuthToken();
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
  }
  // Reasonable timeout so a stuck Worker doesn't lock the auth screen.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${WORKER_BASE_URL}${path}`, {
      method: opts.method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      perfMonitor.recordError(`authClient ${opts.method} ${path}: bad-json:${res.status}`);
      // A bad body is transient EXCEPT when the status itself is a 401.
      return { data: null, error: `bad-json:${res.status}`, status: res.status, unauthorised: res.status === 401 };
    }
    const body = parsed as { data?: T | null; error?: string | null };
    if (!body || typeof body !== 'object') {
      return { data: null, error: 'bad-shape', status: res.status, unauthorised: res.status === 401 };
    }
    const errStr = body.error ?? null;
    // Genuine auth rejection: HTTP 401 or the Worker's explicit marker.
    const unauthorised = res.status === 401 || errStr === 'unauthorised';
    return { data: body.data ?? null, error: errStr, status: res.status, unauthorised };
  } catch (e: any) {
    clearTimeout(timer);
    const msg = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network error');
    perfMonitor.recordError(`authClient ${opts.method} ${path}: ${msg}`);
    // Never reached the server — purely transient, never unauthorised.
    return { data: null, error: msg, status: null, unauthorised: false };
  }
}

// ─── Public surface — mirrors `src/lib/supabase.ts` shapes ─────────────

export async function register(params: {
  username: string;
  displayName: string;
  emoji: string;
  pin: string;
  deviceKey: string;
}): Promise<{ profile: DBProfileLike | null; error: string | null }> {
  const { data, error } = await call<AuthResponse>('/v1/auth/register', {
    method: 'POST',
    body: params,
  });
  if (error) {
    if (error === 'username_taken') {
      return { profile: null, error: t('auth.error.username_taken') };
    }
    return { profile: null, error };
  }
  if (data?.token && data?.profile) {
    setAuthToken(data.token);
    return { profile: data.profile, error: null };
  }
  return { profile: null, error: 'unknown' };
}

export async function login(params: {
  deviceKey: string;
  pin: string;
}): Promise<{ profile: DBProfileLike | null; error: string | null }> {
  const { data, error } = await call<AuthResponse>('/v1/auth/login', {
    method: 'POST',
    body: params,
  });
  if (error) {
    if (error === 'invalid_key_or_pin') {
      return { profile: null, error: t('auth.error.invalid_key_or_pin') };
    }
    return { profile: null, error };
  }
  if (data?.token && data?.profile) {
    setAuthToken(data.token);
    return { profile: data.profile, error: null };
  }
  return { profile: null, error: t('auth.error.invalid_key_or_pin') };
}

export async function loginWithPin(
  pin: string,
): Promise<{ profile: DBProfileLike | null; error: string | null }> {
  const { data, error } = await call<AuthResponse>('/v1/auth/login-with-pin', {
    method: 'POST',
    body: { pin },
  });
  if (error) {
    if (error === 'invalid_pin') {
      return { profile: null, error: t('auth.error.invalid_pin') };
    }
    return { profile: null, error };
  }
  if (data?.token && data?.profile) {
    setAuthToken(data.token);
    return { profile: data.profile, error: null };
  }
  return { profile: null, error: t('auth.error.invalid_pin') };
}

export async function me(): Promise<{ profile: DBProfileLike | null; error: string | null; unauthorised: boolean }> {
  if (!getAuthToken()) return { profile: null, error: 'no_token', unauthorised: false };
  // Known-offline: short-circuit before the fetch. This is a TRANSIENT
  // failure, NOT an auth rejection — callers must keep the session.
  if (!(await isOnline())) return { profile: null, error: 'offline', unauthorised: false };
  const { data, error, unauthorised } = await call<DBProfileLike>('/v1/auth/me', {
    method: 'GET',
    authed: true,
  });
  if (error) return { profile: null, error, unauthorised };
  return { profile: data, error: null, unauthorised: false };
}

export async function refresh(): Promise<{ token: string | null; error: string | null }> {
  if (!getAuthToken()) return { token: null, error: 'no_token' };
  // Don't burn a refresh attempt while the OS reports offline.
  if (!(await isOnline())) return { token: null, error: 'offline' };
  const { data, error } = await call<{ token: string }>('/v1/auth/refresh', {
    method: 'POST',
    authed: true,
  });
  if (error) return { token: null, error };
  if (data?.token) {
    setAuthToken(data.token);
    return { token: data.token, error: null };
  }
  return { token: null, error: 'unknown' };
}

export async function deleteAccount(): Promise<{ error: string | null }> {
  if (!getAuthToken()) return { error: 'no_token' };
  const { error } = await call<{ deleted: true }>('/v1/auth/me', {
    method: 'DELETE',
    authed: true,
  });
  if (error) return { error };
  // Account is gone — wipe the token before the auth store reads it.
  clearAuthToken();
  return { error: null };
}
