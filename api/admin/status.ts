import type { IncomingMessage, ServerResponse } from 'http';

// Admin "services status" endpoint. Returns a live health snapshot of the
// backing services (Supabase DB, Cloudflare R2 media domain, Vercel runtime)
// plus lightweight DB counters. Protected by the same admin password used in
// the app's admin panel, sent via the `x-admin-key` header.
//
// Design: each check has its own short timeout and runs in parallel, so the
// endpoint stays fast and never blocks on a slow dependency. No heavy queries
// (only HEAD/count requests) — the database is barely touched.

const ADMIN_PASSWORD = 'V7k!Qm9@Lp2#xR8$Tw6ZcD4%yN';

const SUPABASE_URL = 'https://ycwadqglcykcpucembjn.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljd2FkcWdsY3lrY3B1Y2VtYmpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc2OTYsImV4cCI6MjA5NTQwMzY5Nn0.ZUr1YfN6pBp_AaUC1pZLKGApwgEXEiVw_w6w-yQjE_U';
const R2_PUBLIC_BASE = 'https://media.san-m-app.com';

const TIMEOUT_MS = 4000;

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - start, value };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - start, error: e?.message || 'error' };
  }
}

function fetchT(url: string, init?: RequestInit): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  return fetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(t)) as Promise<Response>;
}

// Count rows in a table using a HEAD request with count=exact (no rows returned).
async function tableCount(table: string): Promise<number> {
  const r = await fetchT(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    method: 'HEAD',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  const cr = r.headers.get('content-range') || '';
  const total = cr.split('/')[1];
  return total ? parseInt(total, 10) : 0;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'x-admin-key');
    res.end();
    return;
  }

  const key = (req.headers['x-admin-key'] as string) || '';
  if (key !== ADMIN_PASSWORD) {
    send(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Run all checks in parallel.
  const [db, profiles, posts, comments, r2, vercelRegion] = await Promise.all([
    timed(() => fetchT(`${SUPABASE_URL}/rest/v1/?apikey=${SUPABASE_ANON_KEY}`, { method: 'GET' }).then((r) => r.ok || r.status === 404)),
    timed(() => tableCount('profiles')),
    timed(() => tableCount('posts')),
    timed(() => tableCount('comments')),
    timed(() => fetchT(`${R2_PUBLIC_BASE}/test/hello.txt`, { method: 'GET' }).then((r) => r.ok)),
    Promise.resolve(process.env.VERCEL_REGION || 'unknown'),
  ]);

  const services = [
    {
      key: 'vercel',
      name: 'Vercel (API / хостинг)',
      status: 'online',
      latencyMs: 0,
      detail: `Регион: ${vercelRegion}`,
    },
    {
      key: 'supabase',
      name: 'Supabase (база данных)',
      status: db.ok && db.value ? 'online' : 'degraded',
      latencyMs: db.ms,
      detail: db.ok ? 'REST API отвечает' : db.error || 'нет ответа',
    },
    {
      key: 'r2',
      name: 'Cloudflare R2 (media.san-m-app.com)',
      status: r2.ok && r2.value ? 'online' : 'degraded',
      latencyMs: r2.ms,
      detail: r2.ok && r2.value ? 'Публичный домен отвечает' : 'Проверьте публичный доступ',
    },
  ];

  send(res, 200, {
    generatedAt: new Date().toISOString(),
    services,
    metrics: {
      profiles: profiles.value ?? null,
      posts: posts.value ?? null,
      comments: comments.value ?? null,
      dbLatencyMs: profiles.ms,
    },
  });
}
