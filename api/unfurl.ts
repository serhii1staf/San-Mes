import type { IncomingMessage, ServerResponse } from 'http';
import { promises as dns } from 'dns';
import * as net from 'net';

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
const MAX_REDIRECTS = 3; // manual redirect hops; each Location is re-validated
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

// ---------------------------------------------------------------------------
// SSRF hardening
// ---------------------------------------------------------------------------
// The endpoint fetches arbitrary user-supplied URLs, so we must make sure a URL
// can never be used to reach loopback / private / link-local / metadata
// addresses — directly, via alternate IP encodings, via DNS that resolves to a
// private IP, or via an HTTP redirect to one of those. All of the checks below
// run BEFORE every fetch (initial request + each redirect hop).

// True if a *normalized* IPv4 dotted-quad is in a private/reserved range we
// must never reach.
function isPrivateIPv4(ip: string): boolean {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 ("this" network)
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

// Expand an IPv6 string (already validated as family 6) into its eight 16-bit
// groups, resolving "::" compression and any embedded IPv4 tail. Returns null
// if the string can't be parsed (treated as blocked by the caller).
function expandIPv6(ip: string): number[] | null {
  let s = ip.split('%')[0]; // strip any zone id (fe80::1%eth0)
  // Embedded IPv4 in the final segment (e.g. ::ffff:169.254.169.254).
  const lastColon = s.lastIndexOf(':');
  if (lastColon !== -1 && s.slice(lastColon + 1).includes('.')) {
    const v4 = s.slice(lastColon + 1).split('.').map(Number);
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const g6 = ((v4[0] << 8) | v4[1]).toString(16);
    const g7 = ((v4[2] << 8) | v4[3]).toString(16);
    s = s.slice(0, lastColon + 1) + g6 + ':' + g7;
  }
  const dbl = s.split('::');
  if (dbl.length > 2) return null;
  const headParts = dbl[0] ? dbl[0].split(':') : [];
  const tailParts = dbl.length === 2 ? (dbl[1] ? dbl[1].split(':') : []) : null;
  let groups: number[];
  if (tailParts === null) {
    if (headParts.length !== 8) return null;
    groups = headParts.map((p) => parseInt(p, 16));
  } else {
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 1) return null;
    groups = [
      ...headParts.map((p) => parseInt(p, 16)),
      ...new Array(missing).fill(0),
      ...tailParts.map((p) => parseInt(p, 16)),
    ];
  }
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function isPrivateIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d).
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    if (!(g[6] === 0 && g[7] === 0)) {
      const a = (g[6] >> 8) & 0xff;
      const b = g[6] & 0xff;
      const c = (g[7] >> 8) & 0xff;
      const d = g[7] & 0xff;
      return isPrivateIPv4(`${a}.${b}.${c}.${d}`);
    }
  }
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false;
}

// Reject any private / loopback / link-local / reserved address. Unknown /
// unparseable inputs are blocked (fail-closed).
function isPrivateAddress(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateIPv4(ip);
  if (fam === 6) return isPrivateIPv6(ip);
  return true;
}

// Interpret a host string as an IP literal in ANY encoding curl/browsers
// accept (dotted-quad, single 32-bit decimal, hex 0x..., octal 0..., or IPv6
// incl. bracketed + IPv4-mapped) and return a normalized form for
// isPrivateAddress. Returns null when the host is a real DNS name.
function parseIpLiteral(host: string): string | null {
  let h = host.trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1); // [::1] -> ::1
  if (net.isIP(h) !== 0) return h; // valid IPv4 or IPv6 literal (incl. ::ffff:1.2.3.4)
  return inetAton(h); // try decimal / hex / octal IPv4 encodings
}

// inet_aton-style parser: accepts 1–4 numeric parts, each decimal, hex (0x) or
// octal (leading 0). Returns a normalized dotted-quad string or null.
function inetAton(s: string): string | null {
  if (!/^[0-9a-fA-FxX.]+$/.test(s)) return null;
  const parts = s.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (p === '') return null;
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^[0-9]+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  const last = nums[nums.length - 1];
  const lead = nums.slice(0, -1);
  for (const x of lead) if (x > 255) return null;
  let value: number;
  switch (nums.length) {
    case 1:
      value = nums[0];
      break;
    case 2:
      if (last > 0xffffff) return null;
      value = lead[0] * 0x1000000 + last;
      break;
    case 3:
      if (last > 0xffff) return null;
      value = lead[0] * 0x1000000 + lead[1] * 0x10000 + last;
      break;
    case 4:
      if (last > 255) return null;
      value = lead[0] * 0x1000000 + lead[1] * 0x10000 + lead[2] * 0x100 + last;
      break;
    default:
      return null;
  }
  if (value < 0 || value > 0xffffffff) return null;
  const a = Math.floor(value / 0x1000000) & 0xff;
  const b = Math.floor(value / 0x10000) & 0xff;
  const c = Math.floor(value / 0x100) & 0xff;
  const d = value & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

// Full host gate. Async because real hostnames are DNS-resolved and EVERY
// resolved address must be public. Returns true only for safe public targets.
async function assertHostAllowed(host: string): Promise<boolean> {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  // Named internal hosts.
  if (h === 'localhost' || h.endsWith('.localhost')) return false;
  if (h.endsWith('.local') || h === 'internal' || h.endsWith('.internal')) return false;
  if (h === 'metadata.google.internal') return false;

  // IP literal in any encoding — normalize and check directly (no DNS).
  const literal = parseIpLiteral(host);
  if (literal !== null) return !isPrivateAddress(literal);

  // Real hostname — resolve and reject if ANY answer is private/link-local.
  let addrs: string[] = [];
  const [v4, v6] = await Promise.allSettled([dns.resolve4(h), dns.resolve6(h)]);
  if (v4.status === 'fulfilled') addrs.push(...v4.value);
  if (v6.status === 'fulfilled') addrs.push(...v6.value);
  if (addrs.length === 0) {
    // Fall back to the system resolver (handles CNAME chains / hosts file).
    try {
      const looked = await dns.lookup(h, { all: true });
      addrs = looked.map((a) => a.address);
    } catch {
      return false;
    }
  }
  if (addrs.length === 0) return false;
  for (const a of addrs) {
    if (isPrivateAddress(a)) return false;
  }
  return true;
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
  if (!(await assertHostAllowed(parsed.hostname))) {
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
      // Prefer `mqdefault.jpg` (320×180) over `hqdefault.jpg` (480×360):
      // mq weighs in at ~6–8 KB vs ~12–15 KB and decodes in roughly a
      // third of the wall-clock time on weak devices. The thumbnail is
      // shown inside a 16:9 card that's almost always rendered at <360px
      // on screen, so mq is already past the device-pixel-ratio break-
      // even point — no perceptible quality drop, but the per-image
      // decode budget on `i.ytimg.com` (which the user's perf snapshot
      // flagged at 121 ms) drops well under 50 ms.
      image: `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
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
        // oEmbed's default `thumbnail_url` is `hqdefault.jpg`. Rewrite to
        // `mqdefault.jpg` for the same decode-cost reason as above; if
        // the URL ever stops being a known ytimg path we fall through to
        // whatever oEmbed returned so the preview still renders.
        if (j.thumbnail_url) {
          const t = String(j.thumbnail_url);
          preview.image = t.includes('/hqdefault.')
            ? t.replace('/hqdefault.', '/mqdefault.')
            : t;
        }
      }
    } catch {}
    send(res, 200, preview, 86400); // cache a day
    return;
  }

  // Generic Open Graph scrape.
  try {
    const resp = await fetchFollowingSafely(target, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
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

// Fetch a URL while following redirects MANUALLY so we can re-run the full
// SSRF host gate on every Location before following it. A public host that
// 302s to an internal/metadata address is therefore caught at the redirect
// hop. Capped at MAX_REDIRECTS hops; returns null if a hop is blocked, the
// chain is too long, or a redirect leaves http/https.
async function fetchFollowingSafely(
  initialUrl: string,
  init?: RequestInit,
  maxHops = MAX_REDIRECTS
): Promise<Response | null> {
  let url = initialUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const resp = await fetchWithTimeout(url, { ...init, redirect: 'manual' });
    if (!resp) return null;
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return resp; // 3xx without a target — hand back as-is
      let next: URL;
      try {
        next = new URL(loc, url);
      } catch {
        return null;
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return null;
      if (!(await assertHostAllowed(next.hostname))) return null;
      try {
        await resp.body?.cancel();
      } catch {}
      url = next.toString();
      continue;
    }
    return resp;
  }
  return null; // exceeded redirect cap
}
