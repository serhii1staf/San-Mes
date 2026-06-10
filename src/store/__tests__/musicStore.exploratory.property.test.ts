// EXPLORATORY bug-reproduction tests (music-and-performance-fixes spec, Task 1).
//
// Library: Jest (jest-expo preset) with a hand-rolled expo-av mock that counts
// concurrently-active Audio.Sound instances and exposes the status callbacks so
// we can fire an ORPHAN callback after `current` changes.
//
// These encode the CORRECT behaviour and are EXPECTED TO FAIL on the unfixed
// store (the failures are the counterexamples confirming the race + orphan-callback bugs).
//
// Covered:
//   Property 4 (Bug Condition) — единственный активный звук (1.7):
//     два почти одновременных play(A)/play(B) → countActiveSoundInstances() достигает 2.
//   Property 2 (Bug Condition) — тап по виджету не подменяет показатели (1.4):
//     орфанный status-колбэк пишет в стор после смены current → isPlaying/позиция искажаются.
//
// DO NOT fix the store or these tests here.

// --- expo-av mock: counts active instances + records status callbacks --------
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
    stopAsync: jest.fn(async () => {}),
  });

  return {
    Audio: {
      setAudioModeAsync: jest.fn(async () => {}),
      Sound: {
        createAsync: jest.fn(async (_source: any, _initial: any, cb: any) => {
          // Artificial load delay so two overlapping play() calls interleave.
          await new Promise((r) => setTimeout(r, 20));
          state.active += 1;
          state.created += 1;
          if (state.active > state.maxActive) state.maxActive = state.active;
          state.callbacks.push(cb);
          const sound = makeSound(cb);
          return { sound, status: { isLoaded: true } };
        }),
      },
    },
  };
});

import { useMusicStore } from '../musicStore';
import type { Track } from '../../services/musicService';

const audioMock = () => (globalThis as any).__audioMock as {
  active: number;
  maxActive: number;
  created: number;
  callbacks: any[];
};

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    artwork: '',
    streamUrl: `https://api.audius.co/v1/tracks/${id}/stream`,
    durationMs: 200000,
  } as Track;
}

const countActiveSoundInstances = () => audioMock().active;

describe('EXPLORATORY: musicStore concurrency + orphan callback (Property 4 & 2)', () => {
  beforeEach(async () => {
    const m = audioMock();
    m.active = 0;
    m.maxActive = 0;
    m.created = 0;
    m.callbacks = [];
    // Reset module-level `sound` via stop(), then reset store state.
    await useMusicStore.getState().stop();
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
  });

  // ───────────────────────────────────────────────────────────────────────
  // Property 4 (1.7) — единственный активный экземпляр звука
  // EXPECTED: FAIL on unfixed — гонка в play() оставляет 2 активных Audio.Sound.
  it('Property 4 (1.7): после наложенных play(A)/play(B) countActiveSoundInstances() <= 1', async () => {
    const store = useMusicStore.getState();

    // Два почти одновременных запуска (повторный вход/выход в чат музыки).
    const pA = store.play(track('A'));
    const pB = store.play(track('B'));
    await Promise.all([pA, pB]);

    // Корректное поведение: предыдущий звук выгружается до старта следующего.
    expect(audioMock().maxActive).toBeLessThanOrEqual(1);
    expect(countActiveSoundInstances()).toBeLessThanOrEqual(1);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Property 2 (1.4) — орфанный status-колбэк не должен искажать стор
  // EXPECTED: FAIL on unfixed — старый колбэк пишет в стор после смены current.
  it('Property 2 (1.4): орфанный колбэк предыдущего трека SHALL игнорироваться', async () => {
    const store = useMusicStore.getState();

    await store.play(track('A'));
    await useMusicStore.getState().play(track('B'));

    // Теперь current === B, позиция = 0, играет B.
    expect(useMusicStore.getState().current?.id).toBe('B');
    expect(useMusicStore.getState().positionMs).toBe(0);

    // Орфанный колбэк, созданный для трека A, срабатывает ПОСЛЕ смены current.
    const cbA = audioMock().callbacks[0];
    expect(typeof cbA).toBe('function');
    cbA({
      isLoaded: true,
      isPlaying: false,
      positionMillis: 99999,
      durationMillis: 88888,
      didJustFinish: false,
    });

    // Корректное поведение: устаревший колбэк не меняет показатели текущего трека B.
    expect(useMusicStore.getState().current?.id).toBe('B');
    expect(useMusicStore.getState().positionMs).not.toBe(99999);
    expect(useMusicStore.getState().positionMs).toBe(0);
  });
});
