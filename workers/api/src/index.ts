// san-mes API Worker — entry point.
//
// This Worker is the foundation of the Cloudflare D1 migration. Phase 1
// only ships two endpoints (a health probe and a single read), both of
// which exercise the routing layer, the D1 binding, the JWT path, and
// CORS so we know the scaffold is sound before porting more reads.
//
// Response shape: every JSON body is `{ data: T | null, error: string | null }`
// to mirror what the app's existing `getXxx` functions return — porting
// callers later won't require changing destructuring patterns.

import { extractBearer, verifyToken } from './auth';
import { Env, normalizeProfile, queryOne } from './db';

// ─── CORS ──────────────────────────────────────────────────────────────────
//
// The app is loaded from a handful of known origins:
//   - https://san-m-app.com               (Vercel marketing / web app)
//   - any *.expo.dev preview              (EAS dev clients)
//   - any *.vercel.app deploy preview     (PR previews)
//   - app://san-mes                       (iOS native scheme)
//   - capacitor:// / null origins         (some native fetch implementations)
// We reflect the request origin if it matches the allow-list, otherwise
// fall back to san-m-app.com. Wildcard `*` would prevent cookies from ever
// flowing — we don't use cookies today, but Authorization headers still
// require an exact origin.

const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/san-m-app\.com$/,
  /^https:\/\/[a-z0-9-]+\.expo\.dev$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^app:\/\/san-mes$/,
  /^capacitor:\/\/localhost$/,
];

function pickAllowedOrigin(origin: string | null): string {
  if (!origin) return 'https://san-m-app.com';
  for (const re of ALLOWED_ORIGIN_PATTERNS) {
    if (re.test(origin)) return origin;
  }
  return 'https://san-m-app.com';
}

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': pickAllowedOrigin(origin),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(req),
    },
  });
}

function ok<T>(req: Request, data: T): Response {
  return jsonResponse(req, { data, error: null }, 200);
}

function fail(req: Request, error: string, status = 400): Response {
  return jsonResponse(req, { data: null, error }, status);
}

// ─── Hand-rolled router ────────────────────────────────────────────────────
//
// We keep itty-router's footprint out of the bundle by writing a ~30-line
// router. Patterns use `:param` placeholders; matched values land on `params`.

type Handler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  authedUserId: string | null,
) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

function compile(method: string, path: string, handler: Handler): Route {
  const paramNames: string[] = [];
  const regex = path.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${regex}$`), paramNames, handler };
}

const ROUTES: Route[] = [];
function get(path: string, handler: Handler) { ROUTES.push(compile('GET', path, handler)); }

// ─── Endpoints ─────────────────────────────────────────────────────────────

// GET /v1/health — proves routing + D1 binding work end-to-end.
get('/v1/health', async (req, env) => {
  let dbHealthy = false;
  try {
    const row = await queryOne<{ ok: number }>(env, 'SELECT 1 AS ok', []);
    dbHealthy = row?.ok === 1;
  } catch {
    dbHealthy = false;
  }
  return jsonResponse(req, {
    ok: true,
    db: 'san-mes',
    dbHealthy,
    ts: new Date().toISOString(),
  });
});

// GET /v1/posts/:id — single post + author profile via JOIN.
// Validates schema, JOINs, and graceful empty handling.
get('/v1/posts/:id', async (req, env, _ctx, params) => {
  const id = params.id;
  if (!id) return fail(req, 'missing post id', 400);
  try {
    const row = await queryOne<{
      id: string;
      author_id: string;
      content: string;
      image_url: string | null;
      likes_count: number;
      comments_count: number;
      shares_count: number;
      created_at: string;
      profile_id: string | null;
      profile_username: string | null;
      profile_display_name: string | null;
      profile_emoji: string | null;
      profile_badge: string | null;
      profile_is_verified: number | null;
    }>(
      env,
      `SELECT p.id,
              p.author_id,
              p.content,
              p.image_url,
              p.likes_count,
              p.comments_count,
              p.shares_count,
              p.created_at,
              pr.id            AS profile_id,
              pr.username      AS profile_username,
              pr.display_name  AS profile_display_name,
              pr.emoji         AS profile_emoji,
              pr.badge         AS profile_badge,
              pr.is_verified   AS profile_is_verified
         FROM posts p
    LEFT JOIN profiles pr ON pr.id = p.author_id
        WHERE p.id = ?
        LIMIT 1`,
      [id],
    );
    if (!row) return ok(req, null);
    const post = {
      id: row.id,
      author_id: row.author_id,
      content: row.content,
      image_url: row.image_url,
      likes_count: row.likes_count,
      comments_count: row.comments_count,
      shares_count: row.shares_count,
      created_at: row.created_at,
      profiles: row.profile_id
        ? normalizeProfile({
            id: row.profile_id,
            username: row.profile_username,
            display_name: row.profile_display_name,
            emoji: row.profile_emoji,
            badge: row.profile_badge,
            is_verified: row.profile_is_verified,
            links: null,
          })
        : null,
    };
    return ok(req, post);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown db error';
    return fail(req, msg, 500);
  }
});

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
