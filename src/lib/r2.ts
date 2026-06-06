// Cloudflare R2 upload client (S3-compatible) for React Native / Hermes.
//
// Hermes has no native `crypto` module, so AWS Signature V4 is implemented here
// on top of the pure-JS `js-sha256` library (sha256 + HMAC). We deliberately
// avoid the heavy `aws-sdk` / `@aws-sdk/*` packages to keep the bundle small.
//
// Images are uploaded to the R2 bucket via a signed PUT request and served
// publicly via the bucket's Public Development URL (pub-*.r2.dev) or a custom
// domain. All values are read from env (app config) with safe fallbacks.

import { sha256 } from 'js-sha256';

// ---- Configuration ---------------------------------------------------------
// These come from the Cloudflare R2 bucket + an Object Read & Write API token.
// Public base URL is the bucket's Public Development URL (or a custom domain).

const R2_ACCOUNT_ID = '8e0d53f0faad2f48870d0a570dadd03f';
const R2_ACCESS_KEY_ID = '648310b34064b4fb20f96585e25ced2f';
const R2_SECRET_ACCESS_KEY = '6bb6d3c4bdd20d97afe13610e89c5817e2f1167905f047ef29c59ed607d2e577';
const R2_BUCKET = 'san';
const R2_ENDPOINT_HOST = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Public base URL used to build the returned image URL.
// This is the bucket's Public Development URL (pub-*.r2.dev), enabled in the
// Cloudflare dashboard. Images are publicly readable at `${base}/${key}`.
export let R2_PUBLIC_BASE_URL = 'https://pub-534cd44641e447b895f9e81e1f85403d.r2.dev';

/** Allow runtime override of the public base URL (e.g. from remote config). */
export function setR2PublicBaseUrl(url: string) {
  R2_PUBLIC_BASE_URL = url.replace(/\/+$/, '');
}

const REGION = 'auto';
const SERVICE = 's3';

/** Returns true once a public base URL has been configured. */
export function isR2PublicConfigured(): boolean {
  return !!R2_PUBLIC_BASE_URL;
}

// ---- SigV4 helpers ---------------------------------------------------------

function toHex(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

// HMAC-SHA256 returning a byte array (so we can chain into the next HMAC key).
function hmacBytes(key: string | number[], data: string): number[] {
  return sha256.hmac.array(key as any, data);
}

function hmacHex(key: string | number[], data: string): string {
  return sha256.hmac(key as any, data);
}

// Build the YYYYMMDDTHHMMSSZ / YYYYMMDD timestamps from a Date.
function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString(); // 2024-01-02T03:04:05.678Z
  const amzDate = iso.replace(/[:-]/g, '').replace(/\.\d{3}/, ''); // 20240102T030405Z
  const dateStamp = amzDate.slice(0, 8); // 20240102
  return { amzDate, dateStamp };
}

// URI-encode a single path segment per AWS rules (encode everything except
// unreserved chars; '/' is kept as a separator by encoding segments).
function encodeSegment(seg: string): string {
  return encodeURIComponent(seg).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeSegment).join('/');
}

// ---- Core signed PUT -------------------------------------------------------

interface PutResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Upload raw bytes to R2 under `key` via a SigV4-signed PUT.
 * `payloadHashHex` must be the SHA-256 hex of the body bytes.
 */
async function signedPut(params: {
  key: string;
  body: ArrayBuffer | Uint8Array;
  payloadHashHex: string;
  contentType: string;
}): Promise<PutResult> {
  const { key, body, payloadHashHex, contentType } = params;
  const now = new Date();
  const { amzDate, dateStamp } = amzDates(now);

  const canonicalUri = `/${R2_BUCKET}/${encodeKeyPath(key)}`;
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${R2_ENDPOINT_HOST}\n` +
    `x-amz-content-sha256:${payloadHashHex}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '', // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHashHex,
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  // Derive the signing key: HMAC chain starting from "AWS4" + secret.
  const kDate = hmacBytes('AWS4' + R2_SECRET_ACCESS_KEY, dateStamp);
  const kRegion = hmacBytes(kDate, REGION);
  const kService = hmacBytes(kRegion, SERVICE);
  const kSigning = hmacBytes(kService, 'aws4_request');
  const signature = hmacHex(kSigning, stringToSign);

  const authorization =
    `${algorithm} Credential=${R2_ACCESS_KEY_ID}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${R2_ENDPOINT_HOST}${canonicalUri}`;

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-amz-content-sha256': payloadHashHex,
        'x-amz-date': amzDate,
        Authorization: authorization,
      },
      body: body as any,
    });
    if (!res.ok) {
      let text = '';
      try {
        text = await res.text();
      } catch {}
      return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message || 'Network error' };
  }
}

// ---- Public API ------------------------------------------------------------

/**
 * Upload a local file URI to R2 under `key`. Reads the file as bytes, hashes
 * it for SigV4, signs and PUTs it. Returns the public URL on success.
 */
export async function uploadToR2(
  localUri: string,
  key: string,
  contentType: string
): Promise<{ url: string | null; error: string | null }> {
  try {
    // Read the local file into bytes. fetch() on a file:// URI works in RN.
    const fileRes = await fetch(localUri);
    const arrayBuffer = await fileRes.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // SHA-256 of the payload (hex) for the x-amz-content-sha256 header.
    const payloadHashHex = toHex(sha256.array(bytes));

    const put = await signedPut({ key, body: bytes, payloadHashHex, contentType });
    if (!put.ok) {
      return { url: null, error: put.error || `Upload failed (${put.status})` };
    }

    const base = R2_PUBLIC_BASE_URL || `https://${R2_ENDPOINT_HOST}/${R2_BUCKET}`;
    return { url: `${base}/${encodeKeyPath(key)}`, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message || 'Unknown error' };
  }
}

export { R2_BUCKET, R2_ENDPOINT_HOST };
