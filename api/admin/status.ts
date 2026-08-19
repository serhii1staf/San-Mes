import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';

// Admin "services status" endpoint. Returns a live health snapshot of the
// backing services (Supabase DB, Cloudflare R2 media domain, Vercel runtime)
// plus lightweight usage metrics with known limits (so the UI can draw bars):
//   - R2 storage used vs the 10 GB free tier (measured via S3 ListObjects).
//   - DB row counts (profiles / posts / comments).
// Protected by the admin password via the `x-admin-key` header.
//
// Each check has its own timeout and they run in parallel, so the endpoint
// stays fast. Heavy/streaming work is avoided; the database is barely touched.

// ── Credentials: environment only, fail closed ──────────────────────────────
//
// SECURITY: this file previously carried, as source constants in a git-tracked
// file, the admin password, the R2 account id and an R2 S3 access-key pair with
// Object Read & Write on the media bucket. Anyone who could read the repository
// (or its history) could list, overwrite and delete every user-uploaded object
// served from the media domain, and authenticate to this endpoint and to the
// Worker's `/v1/admin/*` routes — which expose device keys and can grant badges or
// delete anyone's posts.
//
// Every credential now comes from the environment with NO literal fallback, so a
// missing variable degrades to "this check is unavailable" instead of silently
// using a public value. That matches how `api/ably-token.ts` and
// `api/_lib/miniAppRender.ts` already handle their secrets.
//
// ⚠️ The values that used to live here must be treated as compromised and ROTATED
// (new R2 S3 key pair, new admin password), because they remain in git history.
const ADMIN_PASSWORD = process.env.ADMIN_KEY || '';

// Phase 5 of the Cloudflare D1 migration: row counts come from the
// Worker's admin endpoint (gated by the same X-Admin-Key the in-app
// admin screen uses). The "DB" service we report on is now D1, not
// Supabase Postgres.
const WORKER_BASE_URL = 'https://san-mes-api.odi44972.workers.dev';
const ADMIN_KEY = ADMIN_PASSWORD;
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE || 'https://media.san-m-app.com';

// R2 S3 credentials (Object Read & Write) — used to measure storage usage.
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || 'san';
const R2_HOST = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_FREE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB free tier
// D1 free tier — 5 GB total, but the relevant cap for a usage bar is
// the daily-row-read limit. We track storage size in bytes for the
// progress bar; the limit value below is the storage cap.
const D1_DB_FREE_BYTES = 5 * 1024 * 1024 * 1024;

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

// Fetch row counts from the Worker's admin endpoint. The Worker
// returns all four counts in a single SQL trip; we project a single
// number per metric the status panel needs.
async function workerCounts(): Promise<{
  profiles: number;
  posts: number;
  comments: number;
  posts_with_img: number;
}> {
  const r = await fetchT(`${WORKER_BASE_URL}/v1/admin/counts`, {
    headers: { Accept: 'application/json', 'X-Admin-Key': ADMIN_KEY },
  });
  if (!r.ok) throw new Error(`worker counts: ${r.status}`);
  const body = (await r.json()) as { data?: any };
  const d = body?.data ?? {};
  return {
    profiles: d.profiles || 0,
    posts: d.posts || 0,
    comments: d.comments || 0,
    posts_with_img: d.posts_with_img || 0,
  };
}

// ---- R2 storage usage via S3 ListObjectsV2 (SigV4 signed) ------------------

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function sha256hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

// List objects and sum sizes + count, capped to stay fast.
//
// AWS SigV4 is time-sensitive and Vercel's serverless clock can be skewed,
// which makes Cloudflare reject signatures ("Access Denied"). To be robust we
// first do a probe request, read Cloudflare's own `Date` response header, and
// re-sign every real request using THAT clock — so it works regardless of the
// host machine's time.
function signAndBuild(signingDate: Date, token?: string) {
  const region = 'auto';
  const service = 's3';
  const amzDate = signingDate.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const params: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' };
  if (token) params['continuation-token'] = token;
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const payloadHash = sha256hex('');
  const canonicalHeaders = `host:${R2_HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['GET', `/${R2_BUCKET}`, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + R2_SECRET_ACCESS_KEY, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${R2_HOST}/${R2_BUCKET}?${canonicalQuery}`,
    headers: { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, Authorization: authorization } as Record<string, string>,
  };
}

async function r2Usage(): Promise<{ bytes: number; objects: number; debug?: string }> {
  // No credentials configured → report "unmeasured" rather than signing a request
  // with empty keys (which would just 403 after a round trip).
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return { bytes: 0, objects: 0, debug: 'r2_not_configured' };
  }

  let bytes = 0;
  let objects = 0;
  let token: string | undefined;
  let debug = '';

  // Determine the signing clock. Probe once with the local clock; if the
  // response carries a Date header, trust Cloudflare's time for signing.
  let signingDate = new Date();
  try {
    const probe = signAndBuild(signingDate, undefined);
    const probeResp = await fetchT(probe.url, { method: 'GET', headers: probe.headers });
    const serverDate = probeResp.headers.get('date');
    if (serverDate) {
      const d = new Date(serverDate);
      if (!isNaN(d.getTime())) signingDate = d;
    }
    if (probeResp.ok) {
      // Probe already succeeded — consume its body as the first page.
      const xml = await probeResp.text();
      const r = sumPage(xml);
      bytes += r.bytes;
      objects += r.objects;
      token = r.nextToken;
      if (!token) return { bytes, objects, debug };
    }
  } catch {
    /* fall through to signed loop */
  }

  for (let page = 0; page < 20; page++) {
    const { url, headers } = signAndBuild(signingDate, token);
    const resp = await fetchT(url, { method: 'GET', headers });
    if (!resp.ok) {
      debug = `http ${resp.status}`;
      break;
    }
    const xml = await resp.text();
    const r = sumPage(xml);
    bytes += r.bytes;
    objects += r.objects;
    if (r.nextToken) {
      token = r.nextToken;
    } else {
      break;
    }
  }
  return { bytes, objects, debug };
}

function sumPage(xml: string): { bytes: number; objects: number; nextToken?: string } {
  let bytes = 0;
  let objects = 0;
  const sizeMatches = xml.match(/<Size>(\d+)<\/Size>/g) || [];
  for (const s of sizeMatches) {
    const n = parseInt(s.replace(/<\/?Size>/g, ''), 10);
    if (!isNaN(n)) {
      bytes += n;
      objects += 1;
    }
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const tokMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  return { bytes, objects, nextToken: truncated && tokMatch ? tokMatch[1] : undefined };
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

  // Fail closed: with no ADMIN_KEY configured there is no correct key, so the
  // endpoint is simply unavailable rather than open (which is what the old
  // literal-constant fallback effectively made it).
  if (!ADMIN_PASSWORD) {
    send(res, 503, { error: 'admin_not_configured' });
    return;
  }

  const key = (req.headers['x-admin-key'] as string) || '';
  // Constant-time compare so the endpoint doesn't leak the key one byte at a time
  // through response timing. Lengths are compared first because
  // `timingSafeEqual` throws on a length mismatch.
  const provided = Buffer.from(key);
  const expected = Buffer.from(ADMIN_PASSWORD);
  const keyOk =
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  if (!keyOk) {
    send(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Run all checks in parallel.
  const [counts, r2, r2use, vercelRegion] = await Promise.all([
    timed(() => workerCounts()),
    timed(() => fetchT(`${R2_PUBLIC_BASE}/test/hello.txt`, { method: 'GET' }).then((r) => r.ok)),
    timed(() => r2Usage()),
    Promise.resolve(process.env.VERCEL_REGION || 'unknown'),
  ]);

  // The Worker is the data layer now. It's healthy if the counts call
  // came back without an error. The previous Supabase-DB shape stays
  // in the response so the in-app status screen doesn't have to
  // change — we just relabel the row.
  const dbOk = counts.ok;
  const profileCount = counts.value?.profiles ?? 0;
  const postCount = counts.value?.posts ?? 0;
  const commentCount = counts.value?.comments ?? 0;
  const postsWithImg = counts.value?.posts_with_img ?? 0;

  // R2 storage: prefer the live S3 measurement; if it failed (e.g. serverless
  // clock skew breaks SigV4), fall back to an estimate from the number of
  // posts that have images × our average compressed size (~180 KB).
  const liveBytes = r2use.value?.bytes ?? 0;
  const liveObjects = r2use.value?.objects ?? 0;
  const measuredStorage = r2use.ok && liveObjects > 0;
  const AVG_IMG_BYTES = 180 * 1024;
  const estObjects = postsWithImg;
  const storageBytes = measuredStorage ? liveBytes : estObjects * AVG_IMG_BYTES;
  const storageObjects = measuredStorage ? liveObjects : estObjects;

  const services = [
    {
      key: 'vercel',
      name: 'Vercel (API / хостинг)',
      status: 'online',
      latencyMs: 0,
      detail: `Регион: ${vercelRegion}`,
    },
    {
      key: 'd1',
      name: 'Cloudflare D1 (база данных)',
      status: dbOk ? 'online' : 'degraded',
      latencyMs: counts.ms,
      detail: dbOk ? 'Запросы выполняются' : counts.error || 'нет ответа',
    },
    {
      key: 'r2',
      name: 'Cloudflare R2 (media.san-m-app.com)',
      status: r2.ok && r2.value ? 'online' : 'degraded',
      latencyMs: r2.ms,
      detail: r2.ok && r2.value ? 'Публичный домен отвечает' : 'Проверьте публичный доступ',
    },
  ];

  // Usage bars: value/limit pairs the UI can render as progress bars.
  // Rough DB size estimate: rows × avg bytes/row (no server-side stats on the
  // free tier, so we approximate to drive the bar — clearly labelled as est.).
  const estDbBytes = profileCount * 600 + postCount * 1200 + commentCount * 400;

  const usage = [
    {
      key: 'r2_storage',
      label: 'Хранилище R2 (медиа)',
      used: storageBytes,
      limit: R2_FREE_BYTES,
      unit: 'bytes',
      extra: `${storageObjects} файлов`,
      measured: measuredStorage,
    },
    {
      key: 'db_size',
      label: 'База данных (оценка)',
      used: estDbBytes,
      limit: D1_DB_FREE_BYTES,
      unit: 'bytes',
      extra: `${profileCount + postCount + commentCount} строк`,
      measured: false,
    },
  ];

  send(res, 200, {
    generatedAt: new Date().toISOString(),
    services,
    usage,
    metrics: {
      profiles: profileCount,
      posts: postCount,
      comments: commentCount,
      dbLatencyMs: counts.ms,
      storageBytes,
      storageObjects,
    },
  });
}
