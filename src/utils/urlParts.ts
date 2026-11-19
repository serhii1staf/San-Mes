/**
 * Host and path of an absolute URL, for display and grouping, without `new URL()`.
 *
 * Hermes has no native `URL`; the app's global one is the `whatwg-url-without-unicode` polyfill,
 * which is correct but slow for this job: it runs the full WHATWG state machine and punycode on
 * every call. Three render-time callers used it only to read the host and path. In the emulator
 * profile of opening a 462-message chat and fast-scrolling it, `new URL` took 49 ms of JS time:
 * FormattedText's link label 22.6 ms, the perf monitor's per-image host label 17.5 ms and the link
 * preview's site name 9.0 ms.
 *
 * Matches what those call sites read from `URL`: the hostname lower-cased, without user info or
 * port, and the path up to `?` / `#`. Unlike `URL` it keeps non-ASCII characters as they are instead
 * of percent-encoding the path, which reads better as a label. Returns null for anything that is not
 * `scheme://host...`, where the callers already had a fallback.
 */
export function urlHostAndPath(url: string): { host: string; path: string } | null {
  if (!url) return null;
  const m = URL_PARTS_RE.exec(url);
  if (!m) return null;
  return { host: m[1].toLowerCase(), path: m[2] || '/' };
}

/** The hostname of `url` without a leading `www.`, or '' when it is not an absolute URL. */
export function urlHostLabel(url: string): string {
  const p = urlHostAndPath(url);
  return p ? p.host.replace(/^www\./, '') : '';
}

// scheme :// [userinfo@] host [:port] path
const URL_PARTS_RE = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\\?#]*@)?(\[[^\]]+\]|[^/\\?#:]+)(?::\d*)?([^?#]*)/i;
