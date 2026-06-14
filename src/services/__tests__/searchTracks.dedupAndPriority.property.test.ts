// Property-based tests for searchTracks dedup + full-length priority.
// Spec: music-and-performance-fixes, Task 8.2 (Block D — Properties 9 & 10).
//
// Library: fast-check (v4) + Jest (jest-expo preset). No new dependencies.
//
// Properties (encoded directly from design.md):
//
//   Property 9 (часть 2, /11.2) — Дедуп по (title, artist).
//     For any mix of Audius full-length and iTunes preview tracks where some
//     (title, artist) pairs collide between the two sources, `searchTracks`
//     never emits two results with the same normalized (title, artist) pair.
//
//     **Validates: Requirements 2.15**
//
//   Property 10 (часть b, /11.3) — Приоритет full-length над preview.
//     When both a full-length (isPreview=false) AND a preview (isPreview=true)
//     copy of the SAME (title, artist) are available, the survivor in the
//     deduped result is the full-length copy.
//
//     **Validates: Requirements 2.16**
//
// Strategy — model the network only, drive the real `searchTracks` for trust:
//   - We mock `global.fetch` and route Audius requests to a generated list of
//     full-length tracks, iTunes requests to a generated list of 30s previews,
//     and SoundCloud requests to empty (the test exercises only the
//     Audius+iTunes interplay that creates the cross-source dupes).
//   - Each property iteration uses a UNIQUE query (cache key) so the in-memory
//     MMKV-fallback cache from a previous iteration never short-circuits a
//     fresh call.
//   - Generators produce arbitrary unicode-ish titles/artists with weighted
//     overlap so a healthy fraction of iterations exercise the dedup path.

import fc from 'fast-check';
import { searchTracks, Track } from '../musicService';

// ─── Test helpers ────────────────────────────────────────────────────────────

const Q_BASE = `pbt-dedup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let qCounter = 0;
const uniqueQuery = (label: string) => `${Q_BASE}-${qCounter++}-${label}`;

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const notOk = () =>
  ({ ok: false, json: async () => null, text: async () => '' }) as unknown as Response;

// Mirror the (private) `normalize` from musicService. We replicate it here ONLY
// for the test oracle — the production normalize is what searchTracks itself
// uses internally, and any drift would surface as a test failure.
function normalizeTitleArtist(title: string, artist: string): string {
  const norm = (s: string) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return `${norm(title)}|||${norm(artist)}`;
}

const bareHost = (s: string) => s.replace(/^https?:\/\//, '');

interface AudiusRaw {
  id: string;
  title: string;
  duration: number;
  user: { name: string };
  artwork: Record<string, string>;
}
interface ItunesRaw {
  trackId: number;
  trackName: string;
  artistName: string;
  previewUrl: string;
  trackTimeMillis: number;
  artworkUrl100: string;
}

const audiusRaw = (id: string, title: string, artist: string): AudiusRaw => ({
  id,
  title,
  duration: 200,
  user: { name: artist },
  artwork: { '480x480': 'https://example.com/art.jpg' },
});

const itunesRaw = (id: number, title: string, artist: string): ItunesRaw => ({
  trackId: id,
  trackName: title,
  artistName: artist,
  // iTunes always exposes a preview-only URL — explicitly hard-coded to keep
  // the test deterministic regardless of what apple's CDN looks like today.
  previewUrl: `https://audio-ssl.itunes.apple.com/itunes-assets/preview-${id}.m4a`,
  trackTimeMillis: 30000,
  artworkUrl100: 'https://example.com/itunes-100x100bb.jpg',
});

/** Build a fetch-routing helper keyed by URL prefix → response producer. */
function buildFetchMock(audiusBody: { data: AudiusRaw[] }, itunesBody: { results: ItunesRaw[] }) {
  return jest.fn(async (url: any) => {
    const u = String(url);
    if (u.startsWith('https://api.audius.co/v1/tracks/search')) return okJson(audiusBody);
    // Other Audius hosts return empty so dedup-by-id keeps the canonical host.
    if (/^https:\/\/[a-z0-9.-]*audius[a-z0-9.-]*\/v1\/tracks\/search/.test(u)) {
      return okJson({ data: [] });
    }
    if (u.startsWith('https://itunes.apple.com/search')) return okJson(itunesBody);
    // SoundCloud fully off — its search/extraction path returns empty and the
    // test never reaches a stream-resolve call.
    return notOk();
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as any).fetch;
});

// ─── Generators ──────────────────────────────────────────────────────────────

// Title/artist generator — weighted toward a small shared vocabulary so dedup
// scenarios surface frequently. Plain ASCII keeps the visual diff in
// counterexamples readable; normalize() handles diacritics anyway.
const titleArb = fc.constantFrom(
  'Believer',
  'Stay',
  'Linda',
  'Cafe',
  'Run',
  'River',
  'Sky',
  'Echo',
  'Forever',
  'Wave',
);
const artistArb = fc.constantFrom('Imagine Dragons', 'Linda', 'Kygo', 'Sia', 'Drake');

// One song = (title, artist) PLUS a flag deciding whether the song is published
// on Audius (full-length), iTunes (preview), or BOTH (the dedup-target case).
const songArb = fc.record({
  title: titleArb,
  artist: artistArb,
  inAudius: fc.boolean(),
  inItunes: fc.boolean(),
});

// At least one song with `inAudius || inItunes` so the network produces ≥1 hit.
const corpusArb = fc
  .array(songArb, { minLength: 1, maxLength: 6 })
  .map((arr) => {
    if (arr.every((s) => !s.inAudius && !s.inItunes)) {
      return [{ ...arr[0], inAudius: true } as typeof arr[number], ...arr.slice(1)];
    }
    return arr;
  });

// ─── Properties ──────────────────────────────────────────────────────────────

describe('searchTracks PBT — Block D dedup + full-length priority (Properties 9, 10)', () => {
  /**
   * Property 9 — no two results share the normalized (title, artist) pair.
   *
   * **Validates: Requirements 2.15**
   */
  it('Property 9: no duplicates by normalized (title, artist) across Audius+iTunes', async () => {
    await fc.assert(
      fc.asyncProperty(corpusArb, async (corpus) => {
        const audiusList: AudiusRaw[] = [];
        const itunesList: ItunesRaw[] = [];
        let nextId = 1;
        for (const s of corpus) {
          if (s.inAudius) audiusList.push(audiusRaw(`a-${nextId++}`, s.title, s.artist));
          if (s.inItunes) itunesList.push(itunesRaw(nextId++, s.title, s.artist));
        }

        (global as any).fetch = buildFetchMock(
          { data: audiusList },
          { results: itunesList },
        );

        const q = uniqueQuery('p9');
        const tracks = await searchTracks(q);

        // Build the post-search set of normalized keys; expect uniqueness.
        const seen = new Map<string, number>();
        for (const t of tracks) {
          const k = normalizeTitleArtist(t.title, t.artist);
          seen.set(k, (seen.get(k) ?? 0) + 1);
        }
        for (const [k, n] of seen.entries()) {
          if (n !== 1) {
            // shrinking will surface the smallest violating corpus
            throw new Error(`duplicate (title|artist) key "${k}" appeared ${n} times`);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  /**
   * Property 10 — full-length wins over preview when both exist for the same
   * (title, artist). We focus generators on overlapping pairs so the property
   * actually exercises the priority rule.
   *
   * **Validates: Requirements 2.16**
   */
  it('Property 10: full-length always survives over preview for the same (title, artist)', async () => {
    // Generator restricted to pairs where BOTH copies exist.
    const overlapSongArb = fc.record({ title: titleArb, artist: artistArb });
    const overlapCorpusArb = fc.uniqueArray(overlapSongArb, {
      minLength: 1,
      maxLength: 4,
      selector: (s) => `${s.title}|${s.artist}`,
    });

    await fc.assert(
      fc.asyncProperty(overlapCorpusArb, async (pairs) => {
        const audiusList: AudiusRaw[] = [];
        const itunesList: ItunesRaw[] = [];
        let nextId = 1;
        for (const p of pairs) {
          // Both copies for every pair → every dedup must resolve to full-length.
          audiusList.push(audiusRaw(`a-${nextId++}`, p.title, p.artist));
          itunesList.push(itunesRaw(nextId++, p.title, p.artist));
        }

        (global as any).fetch = buildFetchMock(
          { data: audiusList },
          { results: itunesList },
        );

        const q = uniqueQuery('p10');
        const tracks = await searchTracks(q);

        // For every overlapping pair we expect at most one result, and that
        // result MUST be the full-length copy (isPreview=false).
        const byKey = new Map<string, Track[]>();
        for (const t of tracks) {
          const k = normalizeTitleArtist(t.title, t.artist);
          const list = byKey.get(k) ?? [];
          list.push(t);
          byKey.set(k, list);
        }
        for (const p of pairs) {
          const k = normalizeTitleArtist(p.title, p.artist);
          const survivors = byKey.get(k) ?? [];
          // Dedup leaves at most one survivor for the pair.
          expect(survivors.length).toBeLessThanOrEqual(1);
          // When a survivor exists for an explicitly overlapping pair, it must
          // be the full-length copy. Audius full-length tracks have
          // sourceHost = 'https://api.audius.co' and isPreview=false.
          if (survivors.length === 1) {
            const s = survivors[0];
            expect(s.isPreview).toBe(false);
            // Cross-check: the surviving streamUrl host matches sourceHost
            // (Property 1 invariant rides along — the dedup must NOT scramble
            // host/streamUrl).
            expect(bareHost(s.sourceHost)).toBe(new URL(s.streamUrl).host);
          }
        }
      }),
      { numRuns: 25 },
    );
  });
});
