// Minimal D1 stub for vitest. The real `vitest-pool-workers` binding
// would spin up a miniflare/D1 sandbox per file, which is overkill for
// the smoke checks we want here (correct routing, correct response
// shape, correct error semantics). Instead we expose just enough of
// the D1 prepared-statement surface to satisfy `db.ts` helpers.
//
// The stub captures every prepared SQL string + bound params so the
// caller can assert "endpoint X invoked the right query" if it wants
// to. By default `all()`/`first()` return an empty result so endpoints
// land on the empty-DB code path — that's what Phase 2 ships against.

interface Captured {
  sql: string;
  params: unknown[];
}

export interface StubResponses {
  /** Map of "exact SQL string" → rows to return for `.all()`. */
  all?: Record<string, unknown[]>;
  /** Map of "exact SQL string" → row to return for `.first()`. */
  first?: Record<string, unknown | null>;
  /** Catch-all if the SQL isn't matched in `all`/`first`. */
  fallbackAll?: unknown[];
  fallbackFirst?: unknown | null;
}

export function makeStubD1(responses: StubResponses = {}) {
  const captured: Captured[] = [];

  const prepare = (sql: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...p: unknown[]) {
        bound = p;
        return stmt;
      },
      async all() {
        captured.push({ sql, params: bound });
        const norm = sql.trim();
        const hit = responses.all?.[norm];
        if (hit) return { results: hit };
        return { results: responses.fallbackAll ?? [] };
      },
      async first() {
        captured.push({ sql, params: bound });
        const norm = sql.trim();
        const hit = responses.first?.[norm];
        if (hit !== undefined) return hit;
        return responses.fallbackFirst ?? null;
      },
      async run() {
        captured.push({ sql, params: bound });
        return { meta: {}, success: true };
      },
    };
    return stmt;
  };

  const db = {
    prepare,
    async batch(stmts: any[]) {
      return Promise.all(stmts.map((s) => s.run()));
    },
  };

  return { DB: db as any, captured };
}

export function makeEnv(responses: StubResponses = {}) {
  const { DB, captured } = makeStubD1(responses);
  return {
    env: {
      DB,
      SUPABASE_PROJECT_REF: 'ycwadqglcykcpucembjn',
    },
    captured,
  };
}

// Fake ExecutionContext — none of our handlers use it, but the
// dispatcher requires it as a positional parameter.
export const fakeCtx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;
