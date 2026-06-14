// Property-based tests for the toggle invariant on the same track.
// Spec: music-and-performance-fixes, Task 8.2 (Block D — Property 11).
//
// Property 11 (Expected Behavior) — toggle-инвариант:
//   For ANY random sequence of play/pause taps issued against the SAME track
//   (matching the card-tap and widget-tap surfaces in Task 11.5), the store
//   guarantees:
//
//     (a) `current.id` never changes — the track is never replaced under the
//         user's finger;
//     (b) `isPlaying` flips on every tap — pause→play→pause→…
//
//   The two surfaces in the production app reach this code via:
//     - TrackCard.onPress  → useMusicStore.getState().play(track)
//                           (store's "same id ⇒ toggle" branch routes to
//                           toggle())
//     - MusicMiniBar play  → useMusicStore.getState().toggle()
//
//   The property generator interleaves these two entry points randomly so we
//   never accidentally constrain the test to one calling pattern.
//
//   **Validates: Requirements 2.17**
//
// Library: Jest + fast-check + a hand-rolled expo-av mock.

// --- expo-av mock (per-sound state, no artificial delay needed) -------------
jest.mock('expo-av', () => {
  const state: any = { active: 0, maxActive: 0, created: 0 };
  (globalThis as any).__audioMock = state;

  const makeSound = () => {
    let playing = true;
    let position = 0;
    return {
      unloadAsync: jest.fn(async () => {
        state.active = Math.max(0, state.active - 1);
      }),
      getStatusAsync: jest.fn(async () => ({
        isLoaded: true,
        isPlaying: playing,
        positionMillis: position,
        durationMillis: 1000,
      })),
      playAsync: jest.fn(async () => { playing = true; }),
      pauseAsync: jest.fn(async () => { playing = false; }),
      setPositionAsync: jest.fn(async (ms: number) => { position = ms; }),
      setStatusAsync: jest.fn(async (opts: { shouldPlay?: boolean; positionMillis?: number } = {}) => {
        if (typeof opts.shouldPlay === 'boolean') playing = opts.shouldPlay;
        if (typeof opts.positionMillis === 'number') position = opts.positionMillis;
      }),
      stopAsync: jest.fn(async () => { playing = false; }),
    };
  };

  return {
    Audio: {
      setAudioModeAsync: jest.fn(async () => {}),
      Sound: {
        createAsync: jest.fn(async (_source: any, _initial: any, _cb: any) => {
          state.active += 1;
          state.created += 1;
          if (state.active > state.maxActive) state.maxActive = state.active;
          return { sound: makeSound(), status: { isLoaded: true } };
        }),
      },
    },
  };
});

import fc from 'fast-check';
import { useMusicStore } from '../musicStore';
import type { Track } from '../../services/musicService';

const audioMock = () =>
  (globalThis as any).__audioMock as { active: number; maxActive: number; created: number };

const track = (id: string): Track =>
  ({
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    artwork: '',
    streamUrl: `https://api.audius.co/v1/tracks/${id}/stream`,
    durationMs: 200000,
    sourceHost: 'https://api.audius.co',
    isPreview: false,
  }) as Track;

async function resetStore() {
  await useMusicStore.getState().stop();
  const m = audioMock();
  m.active = 0;
  m.maxActive = 0;
  m.created = 0;
  useMusicStore.setState({
    current: null,
    recent: [],
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
    isLoading: false,
  });
}

// Each tap is one of the two production surfaces:
//   'card' = play(currentTrack) — the chat-card path
//   'widget' = toggle()        — the floating widget's play/pause button
type Tap = 'card' | 'widget';
const tapArb = fc.constantFrom<Tap>('card', 'widget');

describe('musicStore PBT — toggle invariant on the same track (Property 11)', () => {
  /**
   * **Validates: Requirements 2.17**
   */
  it('Property 11: random play/pause taps keep current.id stable and flip isPlaying', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 1–10 taps after the initial play. Bounded length keeps each iteration
        // fast while still reaching realistic burst sizes from a frustrated user.
        fc.array(tapArb, { minLength: 1, maxLength: 10 }),
        async (taps) => {
          await resetStore();
          const t = track('TOGGLE');

          // Initial play loads the sound and starts playing.
          await useMusicStore.getState().play(t);
          expect(useMusicStore.getState().current?.id).toBe(t.id);
          expect(useMusicStore.getState().isPlaying).toBe(true);

          // Track expected isPlaying — every tap flips it.
          let expected = true;

          for (const tap of taps) {
            if (tap === 'card') {
              // play(sameTrack) routes to toggle() inside the store, which is
              // the production wiring used by TrackCard.onPress in
              // app/chat/music.tsx.
              await useMusicStore.getState().play(t);
            } else {
              await useMusicStore.getState().toggle();
            }
            expected = !expected;

            // (a) current.id never changes during the run.
            expect(useMusicStore.getState().current?.id).toBe(t.id);
            // (b) isPlaying flips on every tap.
            expect(useMusicStore.getState().isPlaying).toBe(expected);
          }

          // Cross-check: the store loaded exactly one sound for the entire run
          // (no extra createAsync calls fired by toggle path).
          expect(audioMock().created).toBe(1);
          expect(audioMock().maxActive).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 30 },
    );
  });
});
