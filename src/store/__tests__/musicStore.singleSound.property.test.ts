// Property-based tests for the "only one active Audio.Sound" invariant.
// Spec: music-and-performance-fixes, Task 8.2.
//
// Property 4 (Expected Behavior) — единственный активный звук:
//   For ANY random interleaving of play(track), toggle(), and stop() calls
//   the count of concurrently-active Audio.Sound instances stays ≤ 1, and
//   after the sequence settles the active count is also ≤ 1.
//
//   This complements the unfixed-code exploratory test that fired a single
//   pair of overlapping play() calls. Here we drive the FIXED store through
//   long random sequences (3–12 actions, each with its own simulated load
//   delay) so the generation-token + promise-mutex pair gets exercised
//   under bursty, mixed-action traffic.
//
//   **Validates: Requirements 2.4, 2.7**
//
// Library: Jest + fast-check + a hand-rolled expo-av mock that counts the
// number of concurrently-loaded Sound objects and tracks the running max.

// --- expo-av mock: per-sound state + concurrent-instance counter ------------
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
          // Artificial load delay so overlapping play() calls actually race.
          // Smaller than the exploratory test's 20 ms — we run more iterations
          // here and do not need to demonstrate the bug, only its absence.
          await new Promise((r) => setTimeout(r, 5));
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

// ─── Action generator ────────────────────────────────────────────────────────
// Mix of:
//   - play(track) on a small pool of distinct tracks (so id-collisions toggle),
//   - toggle() (the widget's play/pause button),
//   - stop() (close-the-widget action).
// Some actions launch concurrently (via Promise.all) and some sequentially —
// real users tap with both patterns (autoplay + manual tap = concurrent;
// pause-then-resume = sequential).

type Action =
  | { kind: 'play'; id: string }
  | { kind: 'toggle' }
  | { kind: 'stop' };

const POOL = ['A', 'B', 'C', 'D'];

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...POOL).map((id) => ({ kind: 'play' as const, id })) },
  { weight: 3, arbitrary: fc.constant({ kind: 'toggle' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'stop' as const }) },
);

// A "burst" is a contiguous group of 1–3 actions launched concurrently. The
// outer sequence is the order in which bursts are issued; within a burst the
// actions are fired without awaiting each other (Promise.all). The store's
// generation-token + promise-mutex must survive both axes.
const burstArb = fc.array(actionArb, { minLength: 1, maxLength: 3 });
const sequenceArb = fc.array(burstArb, { minLength: 1, maxLength: 6 });

async function runAction(act: Action): Promise<void> {
  const s = useMusicStore.getState();
  switch (act.kind) {
    case 'play':
      await s.play(track(act.id));
      return;
    case 'toggle':
      await s.toggle();
      return;
    case 'stop':
      await s.stop();
      return;
  }
}

describe('musicStore PBT — single-Sound invariant under random sequences (Property 4)', () => {
  /**
   * Property 4 — countActiveSoundInstances() ≤ 1 after every burst.
   *
   * **Validates: Requirements 2.4, 2.7**
   */
  it('Property 4: random sequences of play/toggle/stop keep maxActive ≤ 1', async () => {
    await fc.assert(
      fc.asyncProperty(sequenceArb, async (sequence) => {
        await resetStore();

        for (const burst of sequence) {
          // Fire the burst concurrently; await all to drain queued generations.
          await Promise.all(burst.map(runAction));
          // After a burst settles, no two Sounds should be loaded at once.
          // (The internal counter tracks max-ever during the burst too — it
          // must never have crossed 1.)
          if (audioMock().maxActive > 1) {
            throw new Error(`maxActive=${audioMock().maxActive} after burst ${JSON.stringify(burst)}`);
          }
          if (audioMock().active > 1) {
            throw new Error(`active=${audioMock().active} after burst ${JSON.stringify(burst)}`);
          }
        }

        // Final settle assertion — clean teardown leaves at most one Sound.
        expect(audioMock().active).toBeLessThanOrEqual(1);
        expect(audioMock().maxActive).toBeLessThanOrEqual(1);
      }),
      { numRuns: 25 },
    );
  });
});
