// Unit tests for musicStore.play (music-and-performance-fixes spec, Task 8.1).
//
// Deterministic, single-shot assertions complementing the property-based tests
// in musicStore.exploratory.property.test.ts and musicStore.preservation.property.test.ts.
//
// Covered:
//   - generation-token: a stale status callback fired AFTER a newer play()
//     supersedes the previous track does NOT mutate the store (Property 2),
//   - "тот же трек → toggle": play(current) when a sound is already loaded
//     does not change current.id and does not load a second sound (Property 8 / 3.1),
//   - stop() invalidates any in-flight orphan callback the same way.
//
// Mock pattern matches the existing exploratory test: a per-run state object
// records active sound count and the captured status callbacks.

jest.mock('expo-av', () => {
  const state: any = { active: 0, maxActive: 0, created: 0, callbacks: [] };
  (globalThis as any).__audioMock = state;

  const makeSound = (cb: any) => ({
    _cb: cb,
    unloadAsync: jest.fn(async () => {
      state.active = Math.max(0, state.active - 1);
    }),
    getStatusAsync: jest.fn(async () => ({
      isLoaded: true,
      isPlaying: true,
      positionMillis: 0,
      durationMillis: 1000,
    })),
    playAsync: jest.fn(async () => {}),
    pauseAsync: jest.fn(async () => {}),
    setPositionAsync: jest.fn(async () => {}),
    setStatusAsync: jest.fn(async () => {}),
    stopAsync: jest.fn(async () => {}),
  });

  return {
    Audio: {
      setAudioModeAsync: jest.fn(async () => {}),
      Sound: {
        createAsync: jest.fn(async (_source: any, _initial: any, cb: any) => {
          state.active += 1;
          state.created += 1;
          if (state.active > state.maxActive) state.maxActive = state.active;
          state.callbacks.push(cb);
          return { sound: makeSound(cb), status: { isLoaded: true } };
        }),
      },
    },
  };
});

import { useMusicStore } from '../musicStore';
import type { Track } from '../../services/musicService';

const audioMock = () =>
  (globalThis as any).__audioMock as {
    active: number;
    maxActive: number;
    created: number;
    callbacks: any[];
  };

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

async function reset() {
  await useMusicStore.getState().stop();
  const m = audioMock();
  m.active = 0;
  m.maxActive = 0;
  m.created = 0;
  m.callbacks = [];
  useMusicStore.setState({
    current: null,
    recent: [],
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
    isLoading: false,
  });
}

describe('musicStore.play — generation-token + same-track toggle', () => {
  beforeEach(reset);

  it('orphan status callback from the previous track is ignored', async () => {
    await useMusicStore.getState().play(track('A'));
    await useMusicStore.getState().play(track('B'));

    expect(useMusicStore.getState().current?.id).toBe('B');
    expect(useMusicStore.getState().positionMs).toBe(0);

    // Trigger the OLD (track A) status callback after current has moved on to B.
    const cbA = audioMock().callbacks[0];
    expect(typeof cbA).toBe('function');
    cbA({
      isLoaded: true,
      isPlaying: false,
      positionMillis: 99999,
      durationMillis: 88888,
      didJustFinish: true,
    });

    // Stale callback must not leak into the current track's state.
    expect(useMusicStore.getState().current?.id).toBe('B');
    expect(useMusicStore.getState().positionMs).toBe(0);
    // The store's isPlaying is also untouched by the orphan didJustFinish.
    expect(useMusicStore.getState().isPlaying).toBe(true);
  });

  it('a fresh status callback for the CURRENT track still updates positionMs', async () => {
    await useMusicStore.getState().play(track('only'));
    const cb = audioMock().callbacks[audioMock().callbacks.length - 1];
    cb({ isLoaded: true, isPlaying: true, positionMillis: 4242, durationMillis: 200000 });

    expect(useMusicStore.getState().positionMs).toBe(4242);
    expect(useMusicStore.getState().current?.id).toBe('only');
  });

  it('play(current) re-tap toggles play/pause without reloading the sound', async () => {
    const t = track('same');
    await useMusicStore.getState().play(t);
    expect(useMusicStore.getState().isPlaying).toBe(true);
    expect(audioMock().created).toBe(1);

    // Same track tapped → toggle path; no new createAsync.
    await useMusicStore.getState().play(t);
    expect(useMusicStore.getState().current?.id).toBe(t.id);
    expect(useMusicStore.getState().isPlaying).toBe(false);
    expect(audioMock().created).toBe(1);
    expect(audioMock().maxActive).toBeLessThanOrEqual(1);

    // Toggle back.
    await useMusicStore.getState().play(t);
    expect(useMusicStore.getState().isPlaying).toBe(true);
    expect(audioMock().created).toBe(1);
  });

  it('stop() invalidates the generation so a late callback cannot resurrect state', async () => {
    await useMusicStore.getState().play(track('Z'));
    const cb = audioMock().callbacks[audioMock().callbacks.length - 1];

    await useMusicStore.getState().stop();
    expect(useMusicStore.getState().current).toBeNull();

    // Orphan callback fires after stop().
    cb({ isLoaded: true, isPlaying: true, positionMillis: 1234, durationMillis: 5000 });

    // stop() bumped the generation token → callback no-ops.
    expect(useMusicStore.getState().current).toBeNull();
    expect(useMusicStore.getState().positionMs).toBe(0);
    expect(useMusicStore.getState().isPlaying).toBe(false);
  });
});
