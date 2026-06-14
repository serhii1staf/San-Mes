// Unit tests for scoreTrackRelevance (music-and-performance-fixes spec, Task 8.1).
//
// Property 1 (relevance ordering) — deterministic, single-shot examples that
// complement the property-based tests in *.property.test.ts. These verify the
// scoring rules:
//   - title match weighs more than artist match,
//   - exact > prefix > word-boundary > substring,
//   - case + diacritics are normalized away,
//   - Cyrillic queries match transliterated Latin titles.

import { scoreTrackRelevance, Track } from '../musicService';

const baseTrack = (over: Partial<Track>): Track => ({
  id: 'x',
  title: '',
  artist: '',
  artwork: '',
  streamUrl: 'https://api.audius.co/v1/tracks/x/stream',
  durationMs: 0,
  sourceHost: 'api.audius.co',
  isPreview: false,
  ...over,
});

describe('scoreTrackRelevance', () => {
  it('exact title match outranks every other match shape', () => {
    const exact = baseTrack({ title: 'Believer', artist: 'Imagine Dragons' });
    const prefix = baseTrack({ title: 'Believer Stripped', artist: 'Imagine Dragons' });
    const wordBoundary = baseTrack({ title: 'I am a Believer', artist: 'Imagine Dragons' });
    const substring = baseTrack({ title: 'Disbelievers', artist: 'Imagine Dragons' });

    const sExact = scoreTrackRelevance(exact, 'Believer');
    const sPrefix = scoreTrackRelevance(prefix, 'Believer');
    const sWord = scoreTrackRelevance(wordBoundary, 'Believer');
    const sSub = scoreTrackRelevance(substring, 'Believer');

    expect(sExact).toBeGreaterThan(sPrefix);
    expect(sPrefix).toBeGreaterThan(sWord);
    expect(sWord).toBeGreaterThan(sSub);
    expect(sSub).toBeGreaterThan(0);
  });

  it('a title match scores higher than the same string in the artist field', () => {
    const titleHit = baseTrack({ title: 'Linda', artist: 'Other Band' });
    const artistHit = baseTrack({ title: 'Other Song', artist: 'Linda' });

    expect(scoreTrackRelevance(titleHit, 'Linda')).toBeGreaterThan(
      scoreTrackRelevance(artistHit, 'Linda'),
    );
  });

  it('normalizes case so MIXEDCASE queries match lowercase metadata', () => {
    const t = baseTrack({ title: 'Believer', artist: 'Imagine Dragons' });
    expect(scoreTrackRelevance(t, 'BELIEVER')).toBe(scoreTrackRelevance(t, 'believer'));
    expect(scoreTrackRelevance(t, 'BeLiEvEr')).toBe(scoreTrackRelevance(t, 'believer'));
  });

  it('strips diacritics so accented queries still match', () => {
    const t = baseTrack({ title: 'Cafe', artist: 'Stromae' });
    expect(scoreTrackRelevance(t, 'café')).toBeGreaterThan(0);
  });

  it('cyrillic query matches transliterated Latin title', () => {
    // "Линда" → "Linda" via the transliteration table.
    const t = baseTrack({ title: 'Linda', artist: 'Linda' });
    expect(scoreTrackRelevance(t, 'Линда')).toBeGreaterThan(0);
  });

  it('returns 0 for a query that does not occur in title or artist', () => {
    const t = baseTrack({ title: 'Believer', artist: 'Imagine Dragons' });
    expect(scoreTrackRelevance(t, 'completely-unrelated')).toBe(0);
  });

  it('empty query returns 0 (no normalisation candidates)', () => {
    const t = baseTrack({ title: 'Believer', artist: 'Imagine Dragons' });
    expect(scoreTrackRelevance(t, '')).toBe(0);
    expect(scoreTrackRelevance(t, '   ')).toBe(0);
  });

  it('multi-word query rewards both word-boundary hits in title', () => {
    const both = baseTrack({ title: 'Imagine Dragons Believer', artist: '' });
    const onlyOne = baseTrack({ title: 'Believer Live', artist: '' });

    expect(scoreTrackRelevance(both, 'Imagine Believer')).toBeGreaterThan(
      scoreTrackRelevance(onlyOne, 'Imagine Believer'),
    );
  });
});
