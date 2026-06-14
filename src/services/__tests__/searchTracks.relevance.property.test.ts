// Property-based tests for searchTracks ranking + host invariants.
// Spec: music-and-performance-fixes, Task 8.2.
//
// Library: fast-check (v4) + Jest. No new dependencies.
//
// Property 1 (Expected Behavior) — релевантность поиска и согласованность host:
//   For any non-empty pool of relevant tracks returned by the network,
//   `searchTracks` returns a list that is
//     (a) length ≥ 1,
//     (b) sorted by `scoreTrackRelevance(track, query)` in non-increasing
//         order, with full-length preferred over preview on score ties, and
//     (c) every result has `bare(sourceHost) === new URL(streamUrl).host`.
//
//   **Validates: Requirements 2.1, 2.2, 2.3**
//
// Strategy:
//   - Mock fetch routing — Audius hosts return generated track lists, iTunes
//     and SoundCloud return empty so the property exercises ranking + host
//     consistency without preview/dedup interactions (those have their own
//     property file).
//   - Each fast-check iteration uses a fresh unique query string so the
//     in-memory MMKV-fallback cache from a previous iteration cannot
//     short-circuit a new call.

import fc from 'fast-check';
import { searchTracks, scoreTrackRelevance } from '../musicService';

const Q_BASE = `pbt-rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let qCounter = 0;
const uniqueQuery = (label: string) => `${Q_BASE}-${qCounter++}-${label}`;

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const notOk = () =>
  ({ ok: false, json: async () => null, text: async () => '' }) as unknown as Response;

interface AudiusRaw {
  id: string;
  title: string;
  duration: number;
  user: { name: string };
  artwork: Record<string, string>;
}
const audiusRaw = (id: string, title: string, artist: string): AudiusRaw => ({
  id,
  title,
  duration: 200,
  user: { name: artist },
  artwork: { '480x480': 'https://example.com/art.jpg' },
});

const bareHost = (s: string) => s.replace(/^https?:\/\//, '');

/** All audius hosts return identical bodies so dedup-by-id keeps one copy
 *  (canonical host = the first one in HOSTS, which the production code reads
 *  before others). Other endpoints (itunes, soundcloud) return empty. */
function buildFetchMock(audiusBody: { data: AudiusRaw[] }) {
  return jest.fn(async (url: any) => {
    const u = String(url);
    if (/\/v1\/tracks\/search/.test(u)) return okJson(audiusBody);
    return notOk();
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as any).fetch;
});

// ─── Generators ──────────────────────────────────────────────────────────────

// A small vocabulary of tokens — guarantees that random queries occasionally
// match generated tracks and exercises the "score > 0 wins" path.
const VOCAB = ['Believer', 'River', 'Sky', 'Echo', 'Linda', 'Run', 'Wave'];
const vocabArb = fc.constantFrom(...VOCAB);
const filler = fc.constantFrom('Live', 'Remix', 'Stripped', 'Acoustic', 'Edit', 'Original');

// Title generator — sometimes contains a vocab word, sometimes does not.
const titleArb = fc.oneof(
  // Pure-vocab: high-score candidate.
  vocabArb,
  // Vocab + filler: prefix/word-boundary match.
  fc.tuple(vocabArb, filler).map(([v, f]) => `${v} ${f}`),
  // Filler-prefix + vocab: word-boundary not at the start.
  fc.tuple(filler, vocabArb).map(([f, v]) => `${f} ${v}`),
  // Random ASCII: most likely zero-score, gets filtered out by the
  // "drop score-0 results when at least one match exists" rule.
  fc.string({ minLength: 3, maxLength: 12 }),
);

const artistArb = fc.constantFrom('Imagine Dragons', 'Linda', 'Kygo', 'Sia', 'Drake', 'Other');

const trackArb = fc.tuple(titleArb, artistArb).map(([title, artist]) => ({ title, artist }));

const queryArb = fc.oneof(vocabArb, fc.tuple(vocabArb, filler).map(([v, f]) => `${v} ${f}`));

// At least one track that scores > 0 against the query. Fast-check shrinks
// to the smallest counter-example, which keeps any failure trivially small.
const inputArb = fc
  .tuple(queryArb, fc.array(trackArb, { minLength: 1, maxLength: 8 }))
  .filter(([q, list]) => list.some((t) => {
    // Quick pre-filter: at least one title contains the query token (so
    // scoreTrackRelevance > 0 and the relevance branch is exercised).
    return t.title.toLowerCase().includes(q.toLowerCase().split(' ')[0]);
  }));

// ─── Properties ──────────────────────────────────────────────────────────────

describe('searchTracks PBT — relevance ordering + host invariant (Property 1)', () => {
  /**
   * Property 1 (a + b + c).
   *
   * **Validates: Requirements 2.1, 2.2, 2.3**
   */
  it('Property 1: results are sorted by score desc and host matches sourceHost', async () => {
    await fc.assert(
      fc.asyncProperty(inputArb, async ([query, pool]) => {
        const audiusList: AudiusRaw[] = pool.map((t, i) => audiusRaw(`r-${i}`, t.title, t.artist));
        (global as any).fetch = buildFetchMock({ data: audiusList });

        const q = uniqueQuery('p1') + ' ' + query;
        const tracks = await searchTracks(q);

        // (a) at least one result if the pool had a scoring candidate.
        // (Some randomly-generated pools may not actually score; in that case
        // the function legitimately returns []. We assert ≥1 only when our
        // local oracle confirms a positive score exists.)
        const oracleHasScore = audiusList.some((a) => {
          // Reconstruct what `searchTracks` will see: same Track shape minus
          // some fields the scorer doesn't read.
          const score = scoreTrackRelevance(
            {
              id: a.id,
              title: a.title,
              artist: a.user.name,
              artwork: '',
              streamUrl: 'https://api.audius.co/x',
              durationMs: 0,
              sourceHost: 'https://api.audius.co',
              isPreview: false,
            },
            q,
          );
          return score > 0;
        });

        if (oracleHasScore) {
          expect(tracks.length).toBeGreaterThanOrEqual(1);
        }

        // (b) sorted by score desc (full-length preferred on ties — but here
        // every track is full-length so the secondary key never disambiguates).
        for (let i = 0; i + 1 < tracks.length; i++) {
          const sa = scoreTrackRelevance(tracks[i], q);
          const sb = scoreTrackRelevance(tracks[i + 1], q);
          // Score must be non-increasing.
          if (sa < sb) {
            throw new Error(
              `not sorted: index ${i} score=${sa} < index ${i + 1} score=${sb} (titles: "${tracks[i].title}" / "${tracks[i + 1].title}")`,
            );
          }
        }

        // (c) every result has streamUrl host == bare(sourceHost).
        for (const t of tracks) {
          const parsed = new URL(t.streamUrl);
          expect(bareHost(t.sourceHost)).toBe(parsed.host);
        }
      }),
      { numRuns: 30 },
    );
  });
});
