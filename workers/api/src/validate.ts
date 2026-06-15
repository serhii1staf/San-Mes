// Body-shape validators for write endpoints.
//
// Every write endpoint funnels its JSON body through one of these
// helpers so the validation surface is identical across handlers (and
// any tightening — e.g. length caps — lands once and applies
// everywhere). The validators never throw; they return a tagged result
// the handler can branch on.

export interface Ok<T> {
  ok: true;
  value: T;
}
export interface Err {
  ok: false;
  error: string;
}
export type Result<T> = Ok<T> | Err;

/** Read the request body as JSON, capped at 64 KB. */
export async function readJson<T = unknown>(req: Request): Promise<Result<T>> {
  const ct = req.headers.get('Content-Type') || '';
  if (req.method === 'GET' || req.method === 'DELETE') {
    // GET/DELETE bodies aren't supported here; some endpoints accept
    // empty deletes (e.g. unfollow) and that's fine — return an empty
    // object so handlers can still destructure safely.
    return { ok: true, value: {} as T };
  }
  if (!ct.toLowerCase().includes('application/json')) {
    // Empty body on a like-toggle is OK; treat as `{}`.
    if (req.headers.get('Content-Length') === '0' || !req.headers.get('Content-Length')) {
      return { ok: true, value: {} as T };
    }
    return { ok: false, error: 'expected application/json' };
  }
  try {
    const text = await req.text();
    if (!text) return { ok: true, value: {} as T };
    if (text.length > 64 * 1024) return { ok: false, error: 'body too large' };
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: 'invalid json' };
  }
}

/** Trim + length-bound a string field. Returns `null` on miss. */
export function asStr(v: unknown, maxLen = 4000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length > maxLen) return t.slice(0, maxLen);
  return t;
}

/** Same as `asStr` but allows the empty string to pass through. */
export function asStrOrEmpty(v: unknown, maxLen = 4000): string | null {
  if (typeof v !== 'string') return null;
  if (v.length > maxLen) return v.slice(0, maxLen);
  return v;
}

/** Coerce to a non-empty array of any. Returns `null` on miss. */
export function asArr(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}
