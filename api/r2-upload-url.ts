// /api/r2-upload-url
//
// Issues a short-lived presigned PUT URL for Cloudflare R2 so the mobile app
// can upload an image DIRECTLY to R2 without the file ever passing through
// our Vercel function (which has a 4.5 MB body limit and would also waste
// bandwidth). The corresponding public URL — served via R2's free public dev
// hostname behind Cloudflare's CDN — is returned alongside, so the app can
// store it in the database immediately.
//
// Why this exists:
//   Supabase Free tier caps cached egress at 5 GB/month and we routinely blow
//   past it because every image gets re-fetched by every client. R2 charges
//   $0/GB egress forever, so moving image hosting there permanently removes
//   that bottleneck.
//
// Security model:
//   - All R2 secrets live in Vercel env vars (R2_ACCESS_KEY_ID,
//     R2_SECRET_ACCESS_KEY) — never in the app bundle.
//   - The presigned URL is good for a short window (15 minutes) and only for
//     the exact key the server picked, so a leaked URL can't be reused to
//     upload arbitrary objects.
//   - The bucket public hostname returned is read-only by design; it can serve
//     uploaded files but not write to them.
//
// Required env vars (set in Vercel project settings, NOT in the repo):
//   R2_ACCOUNT_ID            — 8e0d53f0faad2f48870d0a570dadd03f for this project
//   R2_BUCKET                — "san"
//   R2_ACCESS_KEY_ID         — generated from R2 → Manage R2 API Tokens
//   R2_SECRET_ACCESS_KEY     — same place, shown only once at creation
//   R2_PUBLIC_BASE           — https://pub-534cd44641e447b895f9e81e1f85403d.r2.dev

import type { IncomingMessage, ServerResponse } from 'http';
import { AwsClient } from 'aws4fetch';

interface RequestBody {
  contentType?: string;
  ext?: string;
  prefix?: string;
}

const PRESIGN_TTL_SECONDS = 15 * 60;
const ALLOWED_PREFIXES = new Set(['posts', 'avatars', 'banners', 'chat']);
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
]);

function readJsonBody(req: IncomingMessage): Promise<RequestBody> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 10000) reject(new Error('body too large')); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function randomKey(prefix: string, ext: string): string {
  // Crypto-quality random id avoids any chance of collision between concurrent
  // uploads. Time prefix keeps lexicographic listing roughly chronological.
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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicBase = process.env.R2_PUBLIC_BASE;

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicBase) {
    return send(res, 503, {
      error: 'r2_not_configured',
      message:
        'R2 environment variables are missing. Configure R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PUBLIC_BASE in Vercel project settings.',
    });
  }

  let body: RequestBody;
  try {
    body = await readJsonBody(req);
  } catch (e: any) {
    return send(res, 400, { error: 'invalid_body', message: e?.message });
  }

  const contentType = body.contentType || 'application/octet-stream';
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return send(res, 400, { error: 'unsupported_type', contentType });
  }

  const prefixCandidate = (body.prefix || 'posts').toLowerCase();
  const prefix = ALLOWED_PREFIXES.has(prefixCandidate) ? prefixCandidate : 'posts';
  const ext = body.ext || contentType.split('/')[1] || 'bin';
  const key = randomKey(prefix, ext);

  // Sign the PUT URL using R2's S3-compatible endpoint.
  const r2 = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  const objectUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
  const signed = await r2.sign(
    new Request(`${objectUrl}?X-Amz-Expires=${PRESIGN_TTL_SECONDS}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    }),
    { aws: { signQuery: true } }
  );

  return send(res, 200, {
    uploadUrl: signed.url,
    publicUrl: `${publicBase.replace(/\/$/, '')}/${key}`,
    key,
    contentType,
    expiresIn: PRESIGN_TTL_SECONDS,
  });
}
