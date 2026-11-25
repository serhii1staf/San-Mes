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

import { extractBearer, rememberClaims, verifyToken } from './auth';
import { isInstallAllowed } from './revocation';
import { Env } from './db';
import { ROUTES } from './router';
import { corsHeaders, fail } from './http';
import { clientIp, rateClassFor, withinLimit } from './guards';

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
import './routes/devices';
import './routes/stickers';

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
    let authedUserId = verified?.userId ?? null;

    // ── A DISCONNECTED DEVICE LOSES ACCESS HERE, NOT WHEN IT FEELS LIKE IT ────
    //
    // "Отключить устройство" used to be enforced only by the device heartbeat telling a revoked
    // install to sign itself out. That works for the normal app and is cooperative — a client that
    // simply never heartbeats keeps its 30-day token. Cooperative is not a sign-out, and the whole
    // point of the button is removing someone who has your account.
    //
    // The token now carries an `install` claim inside the signature, so the request path can check it
    // and the client cannot forge or strip it.
    //
    // This is NOT a database read per request: `isInstallAllowed` caches its answer per isolate for a
    // minute, so it costs one PK lookup per install per minute rather than one per call. That bound is
    // what the Devices screen's footnote promises — notifications stop at once, access within about a
    // minute.
    //
    // Downgrading to anonymous rather than returning 401 from here: every handler already treats a
    // null `authedUserId` as unauthorised with its own message and status, so this keeps one rule for
    // "not signed in" instead of adding a second early-exit path with its own error shape. The client's
    // existing 401 handling then runs — one silent refresh, which mints a token carrying the same
    // revoked install and is refused again, then logout.
    if (authedUserId && verified?.installId) {
      const allowed = await isInstallAllowed(env, authedUserId, verified.installId);
      if (!allowed) authedUserId = null;
    }
    if (authedUserId) rememberClaims(req, verified);

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    for (const route of ROUTES) {
      if (route.method !== req.method) continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      try {
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1]);
        });
      } catch {
        // A malformed %-sequence threw outside the handler's try, which Cloudflare answers with its
        // own error page (1101) instead of our envelope.
        return fail(req, 'bad request', 400);
      }
      // ── RATE LIMITS, BEFORE THE HANDLER ───────────────────────────────────────────────────────
      // See guards.ts. Per account when signed in, per address otherwise and for sign-in and sign-up
      // (which have no account yet). 'rate_limited' is retryable for the client's offline queue, and
      // a queued send keeps its clientMutationId, so the retry does not duplicate it.
      // Anonymous reads are not limited: they are the public pages and link previews, and they come
      // from shared addresses (Vercel's renderer, carrier NAT), where a per-address limit would refuse
      // ordinary readers. Everything that writes needs an account, and that is where abuse costs.
      const cls = rateClassFor(req.method, path);
      const perAddress = cls === 'AUTH' || cls === 'SIGNUP' || !authedUserId;
      const key = perAddress ? `ip:${clientIp(req)}` : `u:${authedUserId}`;
      const limited = !(cls === 'READ' && !authedUserId);
      if (limited && !(await withinLimit(env, cls, key))) {
        const res = fail(req, 'rate_limited', 429);
        res.headers.set('Retry-After', '30');
        return res;
      }
      try {
        return await route.handler(req, env, ctx, params, authedUserId);
      } catch (e: unknown) {
        // ── NO DATABASE ERROR TEXT IN RESPONSES ───────────────────────────────────────────────
        // This returned `e.message`, which handed callers D1's own wording ("no such column ...",
        // "UNIQUE constraint failed: profiles.username"): the schema, to anyone who could provoke an
        // error. Logged for us, generic for them. The client treats 'internal error' as retryable.
        const msg = e instanceof Error ? e.message : String(e);
        console.log(JSON.stringify({ evt: 'route_error', method: req.method, path, error: msg.slice(0, 300) }));
        return fail(req, 'internal error', 500);
      }
    }

    return fail(req, `not found: ${req.method} ${path}`, 404);
  },
};
