import type { IncomingMessage, ServerResponse } from 'http';

// Lightweight link "unfurl" service: given ?url=, fetch the target page and
// extract Open Graph / oEmbed metadata (title, description, image, site, type)
// so the app can render a rich preview card — like Telegram / Discord.
//
// Design goals:
//   - Tiny payloads (JSON metadata only, KB not MB — we never proxy the image).
//   - Fast: hard timeout + only the first ~256 KB of HTML is read.
//   - Cheap: aggressive CDN caching (Cache-Control) so repeat links are instant
//     and never hit the database. The DB is NOT touched at all here.
//   - Safe: only http/https, block obvious internal hosts (SSRF guard).

const MAX_HTML_BYTES = 256 * 1024; // read at most 256 KB of HTML
const FETCH_TIMEOUT_MS = 5000;
const UA =
  'Mozilla/5.0 (compatible; SanBot/1.0; +https://san-m-app.com)';

interface Preview {
  url: string;
  siteName?: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  type?: string; // website | video | article | profile ...
  // For video providers (YouTube etc.) — direct embed/watch info.
  provider?: 'youtube' | 'vimeo' | null;
  videoId?: string | null;
}

function send(res: ServerResponse, status: number, data: unknown, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (cacheSeconds > 0) {
    // CDN + client cache. s-maxage caches on Vercel's edge.
    res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=86400`);
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(data));
}

function decodeEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

// Pull a meta tag content by property/name from a chunk of HTML.
function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    // property="og:title" content="..."  (either attribute order)
    const re1 = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,
      'i'
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      'i'
    );
    const m = html.match(re1) || html.match(re2);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return undefined;
}

function titleTag(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decodeEntities(m[1].trim()) : undefined;
}

function absolutize(base: string, maybe?: string): string | undefined {
  if (!maybe) return undefined;
  try {
    return new URL(maybe, base).toString();
  } catch {
    return maybe;
  }
}

function detectVideo(u: URL): { provider: 'youtube' | 'vimeo' | null; videoId: string | null } {
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const v = u.searchParams.get('v');
    if (v) return { provider: 'youtube', videoId: v };
    const shorts = u.pathname.match(/\/shorts\/([\w-]+)/);
    if (shorts) return { provider: 'youtube', videoId: shorts[1] };
    const embed = u.pathname.match(/\/embed\/([\w-]+)/);
    if (embed) return { provider: 'youtube', videoId: embed[1] };
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1);
    if (id) return { provider: 'youtube', videoId: id };
  }
  if (host === 'vimeo.com') {
    const id = u.pathname.split('/').filter(Boolean)[0];
    if (id && /^\d+$/.test(id)) return { provider: 'vimeo', videoId: id };
  }
  return { provider: null, videoId: null };
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  // Block private / loopback IP ranges (basic SSRF guard).
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}

async function readLimited(resp: Response): Promise<string> {
  // Read only up to MAX_HTML_BYTES so huge pages can't blow memory/time.
  const reader = resp.body?.getReader();
  if (!reader) return await resp.text();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let html = '';
  // Stop early once we have the <head> (most OG tags live there).
  while (received < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    html += decoder.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  try {
    await reader.cancel();
  } catch {}
  return html;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '', `http://${req.headers.host}`);
  const target = reqUrl.searchParams.get('url');
  if (!target) {
    send(res, 400, { error: 'Missing url parameter' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    send(res, 400, { error: 'Invalid url' });
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    send(res, 400, { error: 'Only http/https allowed' });
    return;
  }
  if (isBlockedHost(parsed.hostname)) {
    send(res, 400, { error: 'Host not allowed' });
    return;
  }

  const video = detectVideo(parsed);

  // Fast path: YouTube via oEmbed (no scraping, very small + reliable).
  if (video.provider === 'youtube' && video.videoId) {
    const preview: Preview = {
      url: target,
      siteName: 'YouTube',
      type: 'video',
      provider: 'youtube',
      videoId: video.videoId,
      title: undefined,
      image: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      favicon: 'https://www.youtube.com/s/desktop/favicon.ico',
    };
    try {
      const oembed = await fetchWithTimeout(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`
      );
      if (oembed && oembed.ok) {
        const j: any = await oembed.json();
        preview.title = j.title;
        preview.siteName = j.author_name ? `YouTube · ${j.author_name}` : 'YouTube';
        if (j.thumbnail_url) preview.image = j.thumbnail_url;
      }
    } catch {}
    send(res, 200, preview, 86400); // cache a day
    return;
  }

  // Generic Open Graph scrape.
  try {
    const resp = await fetchWithTimeout(target, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!resp || !resp.ok) {
      send(res, 200, { url: target, title: parsed.hostname }, 3600);
      return;
    }
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('text/html')) {
      // Direct image / file link.
      const isImg = ct.startsWith('image/');
      send(
        res,
        200,
        { url: target, siteName: parsed.hostname, type: isImg ? 'image' : 'link', image: isImg ? target : undefined },
        86400
      );
      return;
    }

    const html = await readLimited(resp);
    const preview: Preview = {
      url: target,
      siteName: metaContent(html, ['og:site_name']) || parsed.hostname.replace(/^www\./, ''),
      title: metaContent(html, ['og:title', 'twitter:title']) || titleTag(html),
      description: metaContent(html, ['og:description', 'twitter:description', 'description']),
      image: absolutize(target, metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'])),
      type: metaContent(html, ['og:type']) || 'website',
      provider: video.provider,
      videoId: video.videoId,
    };
    // Trim description to keep payload tiny.
    if (preview.description && preview.description.length > 300) {
      preview.description = preview.description.slice(0, 297) + '…';
    }
    send(res, 200, preview, 86400);
  } catch {
    send(res, 200, { url: target, title: parsed.hostname }, 3600);
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
