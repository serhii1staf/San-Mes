// Unit tests for searchTracks (music-and-performance-fixes spec, Task 8.1).
//
// Property 1 invariants — deterministic, single-shot examples:
//   - default limit > 1 (returns multiple ranked results),
//   - dedup by id when the same track surfaces from several Audius hosts,
//   - fallback hosts when the primary host fails,
//   - `sourceHost` agrees with `streamUrl` (host parsed from URL).
//
// `sourceHost` is stored as the full origin (`https://...`) for Audius and as
// the bare hostname for iTunes/SoundCloud — both forms are accepted as long as
// the host derived from `streamUrl` matches once the `https://` prefix is
// stripped.

import { searchTracks, Track } from '../musicService';

// Each test uses a unique query string. The kvStore in-memory mirror persists
// across tests within this module (MMKV is unavailable in jest), so reusing a
// query would hit the cache and bypass our fetch mock.
const Q_BASE = `unit-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let qCounter = 0;
const uniqueQuery = (label: string) => `${Q_BASE}-${qCounter++}-${label}`;

interface AudiusRaw {
  id: string;
  title: string;
  duration: number;
  user: { name: string };
  artwork: Record<string, string>;
}

const audiusRaw = (id: string, title = id): AudiusRaw => ({
  id,
  title,
  duration: 200,
  user: { name: 'Artist' },
  artwork: { '480x480': 'https://example.com/art.jpg' },
});

const okJson = (body: unknown) =>
  ({
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const notOk = () =>
  ({
    ok: false,
    json: async () => null,
    text: async () => '',
  }) as unknown as Response;

// Strip the `https://` prefix off `sourceHost` so it can be compared to the
// bare hostname returned by `new URL(streamUrl).host`.
const bareHost = (s: string) => s.replace(/^https?:\/\//, '');

/** Build a fetch mock keyed by URL prefix → response producer. */
function buildFetchMock(routes: Array<[RegExp | string, () => Response]>) {
  return jest.fn(async (url: any, _init?: any) => {
    const u = String(url);
    for (const [match, producer] of routes) {
      const hit = typeof match === 'string' ? u.startsWith(match) : match.test(u);
      if (hit) return producer();
    }
    // Default: anything we didn't explicitly route returns 404 / empty body so
    // soundcloud + itunes fallbacks degrade gracefully.
    return notOk();
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as any).fetch;
});

describe('searchTracks', () => {
  it('returns more than one ranked track when the host has multiple matches (limit > 1)', async () => {
    const q = uniqueQuery('multi');
    (global as any).fetch = buildFetchMock([
      [
        'https://api.audius.co/v1/tracks/search',
        () =>
          okJson({
            data: [
              audiusRaw('m1', 'Believer'),
              audiusRaw('m2', 'Believer Stripped'),
              audiusRaw('m3', 'Believer Live'),
            ],
          }),
      ],
    ]);

    const results = await searchTracks(q.replace(/.*-/, '') + ' Believer');
    // At least 2 distinct tracks come through (default limit defaults to 20).
    expect(results.length).toBeGreaterThan(1);
    // All ids unique.
    const ids = new Set(results.map((t) => t.id));
    expect(ids.size).toBe(results.length);
  });

  it('dedupes by id when the same track surfaces from multiple Audius hosts', async () => {
    const q = uniqueQuery('dedup');
    (global as any).fetch = buildFetchMock([
      [
        // Both hosts return the SAME track id "shared". Different hosts, same content.
        /^https:\/\/api\.audius\.co\/v1\/tracks\/search/,
        () => okJson({ data: [audiusRaw('shared', 'Shared Song'), audiusRaw('uniq-a', 'Unique A')] }),
      ],
      [
        /^https:\/\/discoveryprovider\.audius\.co\/v1\/tracks\/search/,
        () => okJson({ data: [audiusRaw('shared', 'Shared Song'), audiusRaw('uniq-b', 'Unique B')] }),
      ],
    ]);

    const results = await searchTracks(q + ' Shared');
    const ids = results.map((t) => t.id);
    // Exactly one occurrence of the shared id, no matter how many hosts returned it.
    expect(ids.filter((x) => x === 'shared')).toHaveLength(1);
    // Ids are globally unique (id-based dedup in searchTracks).
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to alternative hosts when the primary host fails', async () => {
    const q = uniqueQuery('fallback');
    (global as any).fetch = buildFetchMock([
      // Primary host fails with a non-2xx response (modelled offline / 5xx).
      [/^https:\/\/api\.audius\.co\/v1\/tracks\/search/, () => notOk()],
      // A secondary host responds with a relevant track.
      [
        /^https:\/\/discoveryprovider\.audius\.co\/v1\/tracks\/search/,
        () => okJson({ data: [audiusRaw('fb1', 'Fallback Hit')] }),
      ],
    ]);

    const results = await searchTracks(q + ' Fallback');
    expect(results.length).toBeGreaterThan(0);
    expect(results.find((t) => t.id === 'fb1')).toBeDefined();
    // The fallback track must carry the host that actually answered.
    const fb = results.find((t) => t.id === 'fb1') as Track;
    expect(bareHost(fb.sourceHost)).toBe('discoveryprovider.audius.co');
  });

  it('every result has sourceHost matching new URL(streamUrl).host', async () => {
    const q = uniqueQuery('host-invariant');
    (global as any).fetch = buildFetchMock([
      [
        /^https:\/\/api\.audius\.co\/v1\/tracks\/search/,
        () => okJson({ data: [audiusRaw('h1', 'Host A One'), audiusRaw('h2', 'Host A Two')] }),
      ],
      [
        /^https:\/\/discoveryprovider\.audius\.co\/v1\/tracks\/search/,
        () => okJson({ data: [audiusRaw('h3', 'Host B One')] }),
      ],
      [
        /^https:\/\/discoveryprovider2\.audius\.co\/v1\/tracks\/search/,
        () => okJson({ data: [audiusRaw('h4', 'Host C One')] }),
      ],
    ]);

    const results = await searchTracks(q + ' Host');
    expect(results.length).toBeGreaterThan(0);
    for (const t of results) {
      const parsed = new URL(t.streamUrl);
      expect(bareHost(t.sourceHost)).toBe(parsed.host);
    }
  });

  it('honours the explicit limit parameter as a cap on the returned size', async () => {
    const q = uniqueQuery('cap');
    const many = Array.from({ length: 12 }, (_, i) => audiusRaw(`cap-${i}`, `Cap Track ${i}`));
    (global as any).fetch = buildFetchMock([
      [/^https:\/\/api\.audius\.co\/v1\/tracks\/search/, () => okJson({ data: many })],
    ]);
    const results = await searchTracks(q + ' Cap', 3);
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results.length).toBeGreaterThan(0);
  });
});
