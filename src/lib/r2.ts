// Cloudflare R2 upload client (presigned URL flow).
//
// IMPORTANT: this module contains NO secrets. All signing happens server-side
// in the Vercel function /api/r2-upload-url, which holds the R2 Access Key
// and Secret in env vars. The client only knows the API host (already public
// because it's our app server).
//
// Why presigned URLs:
//   - The S3 secret never leaves Vercel, so a decompiled APK can't write
//     arbitrary objects into the bucket (this was a real risk in the
//     previous implementation that hard-coded the secret in the bundle).
//   - The actual file bytes go directly from the device to R2, bypassing
//     the Vercel function (which has a 4.5 MB body limit anyway).
//   - The presigned URL is single-use, time-bounded, and tied to a key
//     the server picked.
//
// Files are served via the bucket's public hostname (pub-*.r2.dev) sitting
// behind Cloudflare's CDN, so reads cost zero egress forever.

const UPLOAD_URL_ENDPOINT = 'https://san-m-app.com/api/r2-upload-url';

type UploadPrefix = 'posts' | 'avatars' | 'banners' | 'chat';

interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  contentType: string;
  expiresIn: number;
}

interface UploadResult {
  url: string | null;
  error: string | null;
}

function extToContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    default:
      return 'application/octet-stream';
  }
}

function uriExt(uri: string): string {
  const q = uri.indexOf('?');
  const cleanUri = q >= 0 ? uri.slice(0, q) : uri;
  const dot = cleanUri.lastIndexOf('.');
  if (dot < 0) return '';
  return cleanUri.slice(dot + 1).toLowerCase();
}

/**
 * The R2 path is fully managed server-side now. The flag exists for the
 * supabase fallback path so existing call sites stay backwards-compatible.
 */
export function isR2PublicConfigured(): boolean {
  return true;
}

async function requestPresign(
  contentType: string,
  ext: string,
  prefix: UploadPrefix,
): Promise<PresignResponse> {
  const res = await fetch(UPLOAD_URL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType, ext, prefix }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {}
    throw new Error(`presign failed (${res.status}) ${detail}`.trim());
  }
  return (await res.json()) as PresignResponse;
}

/**
 * Upload a local file URI directly to R2 using a server-issued presigned PUT.
 * The `key` parameter is accepted for backwards compatibility with the
 * previous secret-in-client implementation; the server now picks the final
 * key, so the caller can pass anything (we only use it to derive a prefix).
 */
export async function uploadToR2(
  localUri: string,
  key: string,
  contentType?: string,
): Promise<UploadResult> {
  try {
    const ext = uriExt(localUri) || (key.indexOf('.') >= 0 ? key.split('.').pop() || 'jpg' : 'jpg');
    const ct = contentType || extToContentType(ext);

    // Derive the bucket prefix from the legacy `key` argument so existing
    // call sites that pass `chat/<file>.jpg` keep landing in chat/, etc.
    const prefixCandidate = key.split('/')[0]?.toLowerCase();
    const prefix: UploadPrefix =
      prefixCandidate === 'chat' || prefixCandidate === 'avatars' || prefixCandidate === 'banners'
        ? (prefixCandidate as UploadPrefix)
        : 'posts';

    // 1) Ask our server for a presigned PUT URL.
    let presign: PresignResponse;
    try {
      presign = await requestPresign(ct, ext, prefix);
    } catch (e: any) {
      // The server hasn't been configured yet (env vars missing) → caller
      // will fall back to Supabase upload. Don't crash the upload flow.
      return { url: null, error: e?.message || 'presign error' };
    }

    // 2) Read the file as bytes, then PUT directly to R2.
    const fileRes = await fetch(localUri);
    const arrayBuffer = await fileRes.arrayBuffer();

    const putRes = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': presign.contentType },
      body: arrayBuffer as any,
    });

    if (!putRes.ok) {
      let detail = '';
      try { detail = await putRes.text(); } catch {}
      return { url: null, error: `r2 put failed (${putRes.status}) ${detail}`.trim() };
    }

    return { url: presign.publicUrl, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message || 'Unknown error' };
  }
}
