// san-mes API Worker — entry point.
//
// This Worker is the foundation of the Cloudflare D1 migration. Phase 1
// shipped the routing scaffold + a health probe + one read; Phase 2
// builds out every read endpoint listed in `design.md` so the app can
// (behind a feature flag) talk to D1 instead of Supabase.
//
// Response shape: every JSON body is `{ data: T | null, error: string | null }`
// to mirror what the app's existing `getXxx` functions return — porting
// callers later (and falling through to Supabase on Worker failure)
// won't require changing destructuring patterns at the call sites.
//
// Architecture: route modules under `routes/` import `register` from
// `./router` and add their routes to the central `ROUTES` array at
// import time. `index.ts` then imports each route module so that
// side-effect runs once when the isolate boots. Adding a new endpoint
// is a single file + a single import — `index.ts` doesn't need to know
// the route's shape.

import { extractBearer, verifyToken } from './auth';
import { Env } from './db';
import { ROUTES } from './router';
import { corsHeaders, fail } from './http';

// ─── Route modules ─────────────────────────────────────────────────────────
//
// Each module's import side-effect calls `register(...)` from router.ts.
// We import in dependency order: more specific files (lookup-by-username
// vs lookup-by-id) keep their internal ordering specific-first.
//
// Note: these imports MUST run BEFORE `worker.fetch` ever dispatches a
// request — that's guaranteed because they're at module top level.

import './routes/health';
import './routes/auth';
import './routes/feed';
import './routes/posts';
import './routes/comments';
import './routes/profiles';
import './routes/follows';
import './routes/conversations';
import './routes/messages';
import './routes/miniApps';
import './routes/notifications';
import './routes/reports';
import './routes/admin';
import './routes/push';

// ─── Worker fetch handler ──────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Preflight — short-circuit so we never burn a D1 query on OPTIONS.
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    // Parse the auth header once; endpoints that don't care can ignore it.
    // Anonymous endpoints (e.g. read profile) can serve anyway.
    const token = extractBearer(req);
    const verified = await verifyToken(env, token);
    const authedUserId = verified?.userId ?? null;

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    for (const route of ROUTES) {
      if (route.method !== req.method) continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });
      try {
        return await route.handler(req, env, ctx, params, authedUserId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'internal error';
        return fail(req, msg, 500);
      }
    }

    return fail(req, `not found: ${req.method} ${path}`, 404);
  },
};
