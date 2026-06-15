// HTTP response helpers, lifted out of `index.ts` so route modules can
// import them without forming a circular dependency on the entry point.
// (When `index.ts` imports each route module at module-init time, those
// modules can't safely re-import `index.ts` because its bindings aren't
// fully evaluated yet — vitest surfaces that as
// `register is not a function`.)
//
// The helpers preserve the same `{ data, error }` envelope the rest of
// the codebase expects — both Supabase responses and these Worker
// responses share the same destructure shape so callers can swap data
// sources without changing their `if (error)` / `data?.thing` patterns.

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

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': pickAllowedOrigin(origin),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(req),
    },
  });
}

export function ok<T>(req: Request, data: T): Response {
  return jsonResponse(req, { data, error: null }, 200);
}

export function fail(req: Request, error: string, status = 400): Response {
  return jsonResponse(req, { data: null, error }, status);
}
