// /api/r2-upload
//
// Proxy upload from the mobile app into Cloudflare R2 using R2's REST API.
// The R2 API token lives ONLY in Vercel env vars (R2_API_TOKEN); the client
// never sees it. The corresponding public URL — served via R2's free public
// dev hostname behind Cloudflare's CDN — is returned to the app so it can
// store it in the database.
//
// Why this exists:
//   Supabase Free tier caps cached egress at 5 GB/month and we routinely
//   blow past it because every image gets re-fetched by every client. R2
//   charges $0/GB egress forever, so moving image hosting there permanently
//   removes that bottleneck.
//
// Why proxy and not presigned URLs:
//   Presigned PUTs require S3-compatible R2 Access Key + Secret. We're
//   bootstrapping with a single Cloudflare API token (cfat_…) that uses R2's
//   REST API (no SigV4 needed). When proper S3 keys are issued later, this
//   handler can be swapped for a presigned-URL one without touching the
//   client.
//
// Body format:
//   POST /api/r2-upload
//   ?prefix=posts|avatars|banners|chat&ext=jpg&type=image%2Fjpeg
//   Body: raw image bytes (Content-Type matches `type`)
//
//   Response: { url: string, key: string }
//
// Required env vars (set in Vercel project settings, NEVER in the repo):
//   R2_ACCOUNT_ID   — Cloudflare account ID (32 hex)
//   R2_BUCKET       — R2 bucket name (e.g. "san")
//   R2_API_TOKEN    — Cloudflare API token with R2 Object Write permission
//   R2_PUBLIC_BASE  — public read URL prefix (https://pub-…r2.dev)

import type { IncomingMessage, ServerResponse } from 'http';
import { authorizeUpload } from './_lib/authorizeUpload';

const ALLOWED_PREFIXES = new Set(['posts', 'avatars', 'banners', 'chat']);
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
]);
const MAX_BODY_BYTES = 4 * 1024 * 1024; // Vercel hobby caps at ~4.5 MB; stay under it

function readBodyBytes(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const combined = Buffer.concat(chunks);
      resolve(new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength));
    });
    req.on('error', reject);
  });
}

/**
 * Does the payload actually start with the signature of the content type it claims?
 *
 * SECURITY: `ALLOWED_CONTENT_TYPES` only validated the CLAIM — the `?type=` query
 * parameter — so any bytes at all could be stored and then served back with an
 * `image/*` content type from our media domain. Sniffing the leading bytes means the
 * declared type has to match the payload, so the bucket cannot be used as generic
 * file hosting.
 *
 * Unknown/unlisted types return false, keeping this an allowlist. HEIC is matched on
 * the ISO-BMFF `ftyp` box rather than a fixed prefix, because the first four bytes
 * are a length field.
 */
function magicMatches(bytes: Uint8Array, contentType: string): boolean {
  const at = (i: number) => bytes[i];
  const ascii = (start: number, len: number) =>
    Buffer.from(bytes.subarray(start, start + len)).toString('latin1');

  switch (contentType) {
    case 'image/jpeg':
      return bytes.length > 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
    case 'image/png':
      return (
        bytes.length > 8 &&
        at(0) === 0x89 &&
        ascii(1, 3) === 'PNG' &&
        at(4) === 0x0d &&
        at(5) === 0x0a &&
        at(6) === 0x1a &&
        at(7) === 0x0a
      );
    case 'image/gif':
      return bytes.length > 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a');
    case 'image/webp':
      return bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'image/heic':
      // ISO base media file: bytes 4..8 are 'ftyp', then a brand such as heic /
      // heix / hevc / mif1 / msf1.
      if (bytes.length < 12 || ascii(4, 4) !== 'ftyp') return false;
      return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(ascii(8, 4));
    default:
      return false;
  }
}

function randomKey(prefix: string, ext: string): string {
  const ts = Date.now().toString(36);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16);
  const safePrefix = prefix.replace(/[^a-z0-9-]/gi, '');
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5) || 'bin';
  return `${safePrefix}/${ts}-${rand}.${safeExt}`;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function getQueryParam(url: string | undefined, name: string): string | undefined {
  if (!url) return undefined;
  const idx = url.indexOf('?');
  if (idx < 0) return undefined;
  const params = new URLSearchParams(url.slice(idx + 1));
  return params.get(name) || undefined;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  // ── Authentication ────────────────────────────────────────────────────────
  //
  // SECURITY: this endpoint had no caller check at all. Anyone who knew the URL
  // could push 4 MB objects into the bucket in a loop — unbounded storage and
  // Class-A operation cost with no per-user quota — and host arbitrary bytes on our
  // own media domain, under our domain reputation.
  //
  // It now requires a valid Worker-issued JWT. The bucket is only writable on
  // behalf of a real account, which also makes abuse attributable and rate-limitable
  // per user rather than anonymous.
  // Local JWT verification first; if that cannot decide — which is what happens
  // when `JWT_SECRET` is absent or has drifted from the Worker's — delegate to the
  // Worker, which owns the signing key. See `_lib/authorizeUpload.ts` for why this
  // is not a weakening: the Worker does a strictly stronger check than we can.
  const principal = await authorizeUpload(req);
  if (!principal.ok) {
    return send(res, 401, { error: 'unauthorised' });
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  const apiToken = process.env.R2_API_TOKEN;
  const publicBase = process.env.R2_PUBLIC_BASE;

  if (!accountId || !bucket || !apiToken || !publicBase) {
    return send(res, 503, {
      error: 'r2_not_configured',
      message:
        'R2 env vars are missing. Configure R2_ACCOUNT_ID, R2_BUCKET, R2_API_TOKEN, R2_PUBLIC_BASE in Vercel.',
    });
  }

  const contentType = (
    getQueryParam(req.url, 'type') ||
    (req.headers['content-type'] as string | undefined) ||
    'application/octet-stream'
  ).split(';')[0].trim();

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return send(res, 400, { error: 'unsupported_type', contentType });
  }

  const prefixCandidate = (getQueryParam(req.url, 'prefix') || 'posts').toLowerCase();
  const prefix = ALLOWED_PREFIXES.has(prefixCandidate) ? prefixCandidate : 'posts';

  const ext = (getQueryParam(req.url, 'ext') || contentType.split('/')[1] || 'bin').toLowerCase();
  const key = randomKey(prefix, ext);

  let bytes: Uint8Array;
  try {
    bytes = await readBodyBytes(req);
  } catch (e: any) {
    if (e?.message === 'payload_too_large') {
      return send(res, 413, { error: 'payload_too_large', maxBytes: MAX_BODY_BYTES });
    }
    return send(res, 400, { error: 'body_error', message: e?.message });
  }

  if (bytes.length === 0) {
    return send(res, 400, { error: 'empty_body' });
  }

  // The declared content type must match the payload's actual signature, so the
  // bucket cannot be used to host non-image bytes behind an `image/*` label.
  if (!magicMatches(bytes, contentType)) {
    return send(res, 400, { error: 'content_type_mismatch', contentType });
  }

  // PUT object via the R2 REST API.
  const r2Url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;

  let r2Res: Response;
  try {
    r2Res = await fetch(r2Url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': contentType,
      },
      body: bytes as any,
    });
  } catch (e: any) {
    return send(res, 502, { error: 'r2_unreachable', message: e?.message });
  }

  if (!r2Res.ok) {
    let detail = '';
    try { detail = await r2Res.text(); } catch {}
    return send(res, 502, {
      error: 'r2_put_failed',
      status: r2Res.status,
      detail: detail.slice(0, 400),
    });
  }

  return send(res, 200, {
    url: `${publicBase.replace(/\/$/, '')}/${key}`,
    key,
    size: bytes.length,
  });
}
