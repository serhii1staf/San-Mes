// Server-side idempotency dedup for create mutations.
//
// The mobile client stamps a `clientMutationId` (a UUID string) onto the
// body of each create mutation it might retry on a flaky network:
//   - POST /v1/posts
//   - POST /v1/posts/repost
//   - POST /v1/posts/:id/comments
//   - POST /v1/conversations/:id/messages
//
// A retry of the SAME logical mutation (same clientMutationId from the
// same authenticated account) must NOT create a duplicate row — instead
// the original result is returned. We persist the mapping
// (account_id, client_mutation_id) → result_id in a small lazily-created
// table so the dedup survives across isolates / cold starts.
//
// Lazy schema bootstrap mirrors `routes/reports.ts`: the table isn't part
// of the original D1 migration, so we `CREATE TABLE IF NOT EXISTS` on the
// first call and flip `schemaEnsured` so the DDL only fires once per
// isolate. All SQL goes through the parameterised `db.ts` helpers — no
// user input is ever interpolated into a statement.

import { exec, queryOne } from './db';
import type { Env } from './db';

let schemaEnsured = false;

async function ensureSchema(env: Env): Promise<void> {
  if (schemaEnsured) return;
  await exec(
    env,
    `CREATE TABLE IF NOT EXISTS mutation_dedup (
       account_id TEXT NOT NULL,
       client_mutation_id TEXT NOT NULL,
       result_id TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (account_id, client_mutation_id)
     )`,
  );
  schemaEnsured = true;
}

/**
 * Validate + normalise a body field into a usable client mutation id.
 * Returns `null` when absent or malformed — callers treat `null` as
 * "no dedup requested" and behave exactly as before. Bounded at 128
 * chars so an abusive client can't seed huge dedup keys.
 */
export function parseClientMutationId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 128) return null;
  return t;
}

/**
 * Look up a prior result id for (accountId, clientMutationId). Returns
 * the stored `result_id` if this mutation was already applied, else
 * `null`. Safe to call with a freshly-parsed id.
 */
export async function findDedupResultId(
  env: Env,
  accountId: string,
  clientMutationId: string,
): Promise<string | null> {
  await ensureSchema(env);
  const row = await queryOne<{ result_id: string }>(
    env,
    `SELECT result_id FROM mutation_dedup
      WHERE account_id = ? AND client_mutation_id = ?
      LIMIT 1`,
    [accountId, clientMutationId],
  );
  return row?.result_id ?? null;
}

/**
 * Record the mapping (accountId, clientMutationId) → resultId after a
 * successful insert. `INSERT OR IGNORE` so a racing duplicate request
 * that already wrote the row is a no-op rather than a PK-conflict 500.
 */
export async function recordDedup(
  env: Env,
  accountId: string,
  clientMutationId: string,
  resultId: string,
): Promise<void> {
  await ensureSchema(env);
  await exec(
    env,
    `INSERT OR IGNORE INTO mutation_dedup
       (account_id, client_mutation_id, result_id, created_at)
     VALUES (?, ?, ?, ?)`,
    [accountId, clientMutationId, resultId, Date.now()],
  );
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Best-effort opportunistic cleanup of dedup rows older than 7 days.
 * Intended to be fired through `ctx.waitUntil(...)` so it NEVER blocks
 * the request path, and gated by a small probability so it runs rarely
 * rather than on every write. Swallows its own errors — a failed
 * cleanup must never surface to the caller.
 */
export function maybeCleanupDedup(env: Env, ctx: ExecutionContext): void {
  // ~1% of writes trigger a sweep; plenty to keep the table bounded
  // without adding a query to the hot path of every mutation.
  if (Math.random() >= 0.01) return;
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  ctx.waitUntil(
    (async () => {
      try {
        await ensureSchema(env);
        await exec(env, `DELETE FROM mutation_dedup WHERE created_at < ?`, [cutoff]);
      } catch {
        // Opportunistic only — ignore failures.
      }
    })(),
  );
}
