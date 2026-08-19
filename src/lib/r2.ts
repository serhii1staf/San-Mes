// Cloudflare R2 upload client (proxied through our Vercel function).
//
// IMPORTANT: this module contains NO secrets. The R2 API token is held only
// by our Vercel function (/api/r2-upload), so a decompiled APK can't write
// arbitrary objects into the bucket.
//
// Files are served via the bucket's public hostname (pub-*.r2.dev) sitting
// behind Cloudflare's CDN, so reads cost zero egress forever — the whole
// point of moving image hosting off Supabase.

const UPLOAD_ENDPOINT = 'https://san-m-app.com/api/r2-upload';

/**
 * Upload timeout. Generous compared to the 8 s API-client default because the body
 * can be up to 4 MB on a slow uplink — but FINITE, which is the point: without it a
 * captive portal leaves the promise unresolved forever (see the note at the call
 * site).
 */
const UPLOAD_TIMEOUT_MS = 45000;

type UploadPrefix = 'posts' | 'avatars' | 'banners' | 'chat';

interface UploadResult {
  url: string | null;
  error: string | null;
}

const PREFIX_BY_KEY: Record<string, UploadPrefix> = {
  chat: 'chat',
  avatars: 'avatars',
  banners: 'banners',
};

function detectContentType(uri: string): { contentType: string; ext: string } {
  const q = uri.indexOf('?');
  const cleanUri = q >= 0 ? uri.slice(0, q) : uri;
  const dot = cleanUri.lastIndexOf('.');
  const rawExt = dot >= 0 ? cleanUri.slice(dot + 1).toLowerCase() : 'jpg';
  switch (rawExt) {
    case 'jpg':
    case 'jpeg':
      return { contentType: 'image/jpeg', ext: 'jpg' };
    case 'png':
      return { contentType: 'image/png', ext: 'png' };
    case 'webp':
      return { contentType: 'image/webp', ext: 'webp' };
    case 'gif':
      return { contentType: 'image/gif', ext: 'gif' };
    case 'heic':
      return { contentType: 'image/heic', ext: 'heic' };
    default:
      return { contentType: 'image/jpeg', ext: 'jpg' };
  }
}

/**
 * Backwards-compatible flag for the supabase fallback path. The actual gating
 * is done server-side: if R2 env vars are missing, the upload endpoint
 * returns 503 and the caller falls back to Supabase Storage.
 */
export function isR2PublicConfigured(): boolean {
  return true;
}

/**
 * Upload a local file URI to R2 by streaming its bytes through our Vercel
 * function. The server picks the final object key and returns the public URL.
 */
export async function uploadToR2(
  localUri: string,
  legacyKey: string,
  forcedContentType?: string,
): Promise<UploadResult> {
  try {
    const detected = detectContentType(localUri);
    const contentType = forcedContentType || detected.contentType;
    const ext = detected.ext;

    // Derive bucket prefix from the legacy key arg so existing call sites
    // (chat/<file>.jpg, etc.) keep landing in the right folder.
    const firstSegment = legacyKey.split('/')[0]?.toLowerCase() || '';
    const prefix: UploadPrefix = PREFIX_BY_KEY[firstSegment] || 'posts';

    // Read the local file as bytes. fetch() on file:// works in RN.
    const fileRes = await fetch(localUri);
    const arrayBuffer = await fileRes.arrayBuffer();
    // (local read — no timeout needed, there is no network involved)
    if (arrayBuffer.byteLength === 0) {
      return { url: null, error: 'empty file' };
    }

    // The upload endpoint now requires a Worker-issued JWT — it used to accept
    // anonymous writes, which made the bucket free file hosting for anyone who knew
    // the URL. Imported lazily so this module keeps no import cycle with the auth
    // client, and read at call time so a token refreshed mid-session is picked up.
    const { getAuthToken } = await import('../services/authClient');
    const token = getAuthToken();
    if (!token) return { url: null, error: 'not signed in' };

    // ── Timeout ──────────────────────────────────────────────────────────────
    // This upload had NO timeout, and it is the worst place in the app to be
    // missing one: on a captive portal (airplane mode with a hotspot, hotel Wi-Fi,
    // a throttled mobile network) the socket is accepted and never answered, so the
    // await never settles. `offlineQueue.uploadImageWithRetry` wraps this in three
    // attempts, so a `create_post` mutation could sit in a permanently unresolved
    // promise chain and the post would never settle either way — no success, no
    // failure, no retry.
    //
    // 45 s rather than the API client's 8 s: this is up to 4 MB of body on a
    // possibly-slow uplink, so the budget has to cover a genuinely slow success.
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    const url = `${UPLOAD_ENDPOINT}?prefix=${prefix}&ext=${ext}&type=${encodeURIComponent(contentType)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': contentType, Authorization: `Bearer ${token}` },
        body: arrayBuffer as any,
        signal: controller.signal,
      });
    } catch (e: any) {
      // An abort surfaces as a distinct, actionable error so the retry logic in
      // `offlineQueue` can back off instead of treating it as a permanent failure.
      if (e?.name === 'AbortError') return { url: null, error: 'upload timed out' };
      throw e;
    } finally {
      clearTimeout(abortTimer);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch {}
      return { url: null, error: `upload failed (${res.status}) ${detail}`.slice(0, 400) };
    }

    const data = (await res.json()) as { url?: string };
    if (!data?.url) return { url: null, error: 'malformed response' };
    return { url: data.url, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message || 'Unknown error' };
  }
}
