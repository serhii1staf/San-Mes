// Thin typed wrapper around D1's prepared-statement API.
//
// Every helper goes through `prepare(sql).bind(...params)` — never string
// concatenation — so there's no path for user input to alter the SQL.
// We hand back plain JS values, normalised so that Postgres-shaped JSON
// (e.g. profiles.links) round-trips correctly.

export interface Env {
  DB: D1Database;
  /** Public — safe to keep in `wrangler.toml` `[vars]`. */
  SUPABASE_PROJECT_REF: string;
  /** Symmetric HMAC key — `wrangler secret put JWT_SECRET`. */
  JWT_SECRET: string;
  /** Shared secret for `/v1/admin/*` endpoints — `wrangler secret put ADMIN_KEY`. */
  ADMIN_KEY: string;
}

export type Row = Record<string, unknown>;

/** Run a SELECT and return all rows as an array. */
export async function query<T = Row>(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const stmt = env.DB.prepare(sql).bind(...(params as any[]));
  const result = await stmt.all<T>();
  return (result.results ?? []) as T[];
}

/** Run a SELECT expected to return at most one row. */
export async function queryOne<T = Row>(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const stmt = env.DB.prepare(sql).bind(...(params as any[]));
  const row = await stmt.first<T>();
  return row ?? null;
}

/** Run a non-SELECT statement (INSERT / UPDATE / DELETE). */
export async function exec(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<D1Result> {
  const stmt = env.DB.prepare(sql).bind(...(params as any[]));
  return await stmt.run();
}

/** Batch a sequence of statements atomically (D1's pseudo-transaction). */
export async function batch(
  env: Env,
  statements: { sql: string; params?: unknown[] }[],
): Promise<D1Result[]> {
  const prepared = statements.map((s) =>
    env.DB.prepare(s.sql).bind(...((s.params ?? []) as any[])),
  );
  return await env.DB.batch(prepared);
}

// ─── Type normalisation helpers ────────────────────────────────────────────
//
// SQLite stores booleans as 0/1 and JSON as TEXT. The app expects the
// Postgres shapes (true/false, parsed JSON), so we normalise on the way
// out. Each helper is defensive: a missing column comes back as `null`,
// not an exception.

export function asBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

export function asJson<T = unknown>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

/** Normalise a profile row from D1 into the app-facing shape. */
export function normalizeProfile<T extends Row>(row: T | null): (T & { is_verified: boolean; links: unknown }) | null {
  if (!row) return null;
  return {
    ...row,
    is_verified: asBool(row.is_verified),
    links: asJson(row.links),
  } as T & { is_verified: boolean; links: unknown };
}
