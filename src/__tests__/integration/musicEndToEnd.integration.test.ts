// Integration test: music end-to-end (Task 8.3, music-and-performance-fixes spec).
//
// Wires together the real `searchTracks` service, the real `useMusicStore`
// (with its generation-token + promise-mutex `play()`), and the real
// `MusicBottomIndicator` widget — exercising the full flow:
//
//   1. user types a query → searchTracks returns N>1 tracks via mocked fetch,
//   2. play(tracks[0]) → exactly ONE Audio.Sound, store.current = tracks[0],
//   3. user "leaves" the music chat (inMusicChat → false) → MusicBottomIndicator
//      becomes visible and shows the current track,
//   4. play/pause (toggle) continues the SAME track (Property 2 — current.id
//      unchanged after every toggle, isPlaying inverts),
//   5. switch to tracks[1] → still one Sound, recents ordered (most-recent first),
//   6. repeated enter/leave (setInMusicChat toggling) does NOT plod the
//      Audio.Sound count — Property 4 (countActiveSoundInstances ≤ 1) holds
//      across the entire scenario.
//
//   _Requirements: 2.4, 2.7, 3.2 / Property 2, 4, 8_
//
// One level higher than the per-module unit + property tests: those exercise
// each piece in isolation, this composes them into the user-visible scenario.
//
// Library: Jest (jest-expo preset) + react-test-renderer. No new dependencies.

// ─── Mocks (mirror the existing music PBT files: minimal, hand-rolled) ──────
jest.mock('expo-router', () => ({ usePathname: () => '/' }));

jest.mock('../../theme', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      accent: { primary: '#3478F6' },
      background: { primary: '#FFF', elevated: '#F5F5F5' },
      text: { primary: '#000', secondary: '#444', tertiary: '#888' },
      border: { light: '#EEE' },
    },
  }),
}));

jest.mock('../../utils/haptics', () => ({ triggerHaptic: jest.fn() }));

jest.mock('../../components/ui/CachedImage', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CachedImage: (props: any) => React.createElement(View, { ...props, testID: 'cached-image' }),
  };
});

jest.mock('../../components/ui/Text', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  return {
    Text: (props: any) => React.createElement(RNText, props, props.children),
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Feather: ({ name, ...rest }: any) =>
      React.createElement(View, { ...rest, 'data-icon-name': name, testID: `icon-${name}` }),
  };
});

// expo-av mock — counts active Sound instances and per-instance play state
// so we can assert "always at most 1" across the full scenario.
jest.mock('expo-av', () => {
  const state: any = { active: 0, maxActive: 0, created: 0, callbacks: [] };
  (globalThis as any).__audioMock = state;

  const makeSound = (cb: any) => {
    let playing = true;
    let position = 0;
    return {
      _cb: cb,
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
        createAsync: jest.fn(async (_source: any, _initial: any, cb: any) => {
          // Tiny artificial delay so consecutive play() calls actually exercise
          // the serialization (without a delay everything would resolve in the
          // same microtask and the race wouldn't appear).
          await new Promise((r) => setTimeout(r, 5));
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

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { searchTracks, Track } from '../../services/musicService';
import { useMusicStore } from '../../store/musicStore';
import { MusicBottomIndicator } from '../../components/ui/MusicBottomIndicator';

const audioMock = () =>
  (globalThis as any).__audioMock as {
    active: number;
    maxActive: number;
    created: number;
    callbacks: any[];
  };

// Each test uses a unique query so the in-memory MMKV-fallback search cache
// (which the production code uses to short-circuit identical queries) cannot
// pollute the next test.
const Q_BASE = `int-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

const audiusRaw = (id: string, title: string, artist = 'Artist'): AudiusRaw => ({
  id,
  title,
  duration: 200,
  user: { name: artist },
  artwork: { '480x480': 'https://example.com/art.jpg' },
});

function buildFetchMock(routes: Array<[RegExp | string, () => Response]>) {
  return jest.fn(async (url: any) => {
    const u = String(url);
    for (const [match, producer] of routes) {
      const hit = typeof match === 'string' ? u.startsWith(match) : match.test(u);
      if (hit) return producer();
    }
    return notOk();
  });
}

async function resetState() {
  await useMusicStore.getState().stop();
  const m = audioMock();
  m.active = 0;
  m.maxActive = 0;
  m.created = 0;
  m.callbacks = [];
  useMusicStore.setState({
    current: null,
    recent: [],
    discovered: [],
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
    isLoading: false,
    playerOpen: false,
    inMusicChat: false,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as any).fetch;
});

// ───────────────────────────────────────────────────────────────────────────
// Scenario tests
// ───────────────────────────────────────────────────────────────────────────

describe('Music end-to-end integration (Task 8.3)', () => {
  /** Walk a react-test-renderer JSON tree and find the outermost View's
   *  pointerEvents prop — the indicator uses it as the synchronous truth
   *  for "the user can interact with this widget". `show=true` →
   *  pointerEvents="box-none" (visible); `show=false` → "none" (hidden). */
  function outerPointerEvents(json: any): string | undefined {
    if (!json) return undefined;
    if (Array.isArray(json)) return outerPointerEvents(json[0]);
    return json?.props?.pointerEvents;
  }

  it('search → play → leave screen → widget visible → toggle keeps current track (Property 2 + 4)', async () => {
    await resetState();

    // 1. Mock the network: Audius returns three relevant tracks.
    (global as any).fetch = buildFetchMock([
      [
        /^https:\/\/api\.audius\.co\/v1\/tracks\/search/,
        () =>
          okJson({
            data: [
              audiusRaw('e2e-1', 'Believer'),
              audiusRaw('e2e-2', 'Believer Stripped'),
              audiusRaw('e2e-3', 'Believer Live'),
            ],
          }),
      ],
    ]);

    const tracks = await searchTracks(uniqueQuery('e2e') + ' Believer');
    expect(tracks.length).toBeGreaterThan(1);
    // Host invariant from Property 1 — not the focus here, but a cheap sanity check.
    for (const t of tracks) {
      expect(new URL(t.streamUrl).host).toBe(t.sourceHost.replace(/^https?:\/\//, ''));
    }

    // 2. Mount the indicator FIRST while there is no current track →
    //    component returns null (matches production: zero cost when nothing
    //    is playing).
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(MusicBottomIndicator));
    });
    expect(renderer.toJSON()).toBeNull();

    // 3. Simulate the user being on the music chat → flip inMusicChat first.
    await act(async () => {
      useMusicStore.getState().setInMusicChat(true);
    });
    // Play the first track. With inMusicChat=true the widget is HIDDEN
    // (pointerEvents='none' on the outer View) but its subtree is still
    // mounted because `current` exists.
    await act(async () => {
      await useMusicStore.getState().play(tracks[0]);
    });
    expect(useMusicStore.getState().current?.id).toBe(tracks[0].id);
    expect(useMusicStore.getState().isPlaying).toBe(true);
    expect(audioMock().active).toBe(1);
    expect(audioMock().maxActive).toBe(1);
    // While on the music chat the widget is hidden.
    expect(outerPointerEvents(renderer.toJSON())).toBe('none');

    // 4. User leaves the music chat — flip inMusicChat false (the chat
    //    screen's unmount effect does this).
    await act(async () => {
      useMusicStore.getState().setInMusicChat(false);
    });
    // pointerEvents flips to 'box-none' synchronously based on `show`.
    expect(outerPointerEvents(renderer.toJSON())).toBe('box-none');

    // 5. Toggle play/pause — Property 2: current.id unchanged, isPlaying flips.
    const idBefore = useMusicStore.getState().current?.id;
    const playingBefore = useMusicStore.getState().isPlaying;
    await act(async () => {
      await useMusicStore.getState().toggle();
    });
    expect(useMusicStore.getState().current?.id).toBe(idBefore);
    expect(useMusicStore.getState().isPlaying).toBe(!playingBefore);
    // No second Sound was loaded by toggle().
    expect(audioMock().created).toBe(1);
    expect(audioMock().active).toBe(1);

    // Toggle back — still the same track.
    await act(async () => {
      await useMusicStore.getState().toggle();
    });
    expect(useMusicStore.getState().current?.id).toBe(idBefore);
    expect(useMusicStore.getState().isPlaying).toBe(playingBefore);
    expect(audioMock().created).toBe(1);

    await act(async () => renderer.unmount());
  });

  it('switching tracks from the chat keeps a single Sound and orders recents most-recent-first', async () => {
    await resetState();

    (global as any).fetch = buildFetchMock([
      [
        /^https:\/\/api\.audius\.co\/v1\/tracks\/search/,
        () =>
          okJson({
            data: [
              audiusRaw('switch-1', 'Echo One'),
              audiusRaw('switch-2', 'Echo Two'),
              audiusRaw('switch-3', 'Echo Three'),
            ],
          }),
      ],
    ]);

    const tracks = await searchTracks(uniqueQuery('switch') + ' Echo');
    expect(tracks.length).toBeGreaterThanOrEqual(2);

    // Play each in turn — like the user tapping different result cards.
    await useMusicStore.getState().play(tracks[0]);
    await useMusicStore.getState().play(tracks[1]);

    expect(useMusicStore.getState().current?.id).toBe(tracks[1].id);
    // Property 4 — never more than one Sound loaded across both plays.
    expect(audioMock().active).toBe(1);
    expect(audioMock().maxActive).toBeLessThanOrEqual(1);

    // Recents are most-recent first, with no duplicates.
    const recent = useMusicStore.getState().recent;
    expect(recent[0].id).toBe(tracks[1].id);
    expect(recent[1].id).toBe(tracks[0].id);
    expect(new Set(recent.map((r) => r.id)).size).toBe(recent.length);

    // Tap track[0] again — switch back, still one Sound.
    await useMusicStore.getState().play(tracks[0]);
    expect(useMusicStore.getState().current?.id).toBe(tracks[0].id);
    expect(audioMock().active).toBe(1);
    expect(audioMock().maxActive).toBeLessThanOrEqual(1);
    // Recents reorder — track[0] now at the front, track[1] right behind it,
    // and the queue is still deduped.
    const recentAfter = useMusicStore.getState().recent;
    expect(recentAfter[0].id).toBe(tracks[0].id);
    expect(recentAfter[1].id).toBe(tracks[1].id);
    expect(new Set(recentAfter.map((r) => r.id)).size).toBe(recentAfter.length);
  });

  it('repeated enter/exit of the music chat does not plod the Sound count (Property 4 + 8)', async () => {
    await resetState();

    (global as any).fetch = buildFetchMock([
      [
        /^https:\/\/api\.audius\.co\/v1\/tracks\/search/,
        () =>
          okJson({ data: [audiusRaw('rep-1', 'River'), audiusRaw('rep-2', 'River Live')] }),
      ],
    ]);

    const tracks = await searchTracks(uniqueQuery('rep') + ' River');
    expect(tracks.length).toBeGreaterThanOrEqual(1);

    // Mount the widget BEFORE play() so all subsequent state updates can be
    // wrapped in act() — keeps the test runner quiet about React updates.
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(MusicBottomIndicator));
    });
    expect(renderer.toJSON()).toBeNull();

    // Play and let the widget mount its subtree.
    await act(async () => {
      await useMusicStore.getState().play(tracks[0]);
    });
    expect(audioMock().active).toBe(1);

    // Simulate the user entering and leaving the music chat several times —
    // the widget hides and re-shows but the underlying Sound is not re-created.
    for (let i = 0; i < 5; i++) {
      await act(async () => useMusicStore.getState().setInMusicChat(true));
      // While in the chat the widget is hidden (pointerEvents='none').
      expect(outerPointerEvents(renderer.toJSON())).toBe('none');
      await act(async () => useMusicStore.getState().setInMusicChat(false));
      // After leaving the chat the widget is interactable again.
      expect(outerPointerEvents(renderer.toJSON())).toBe('box-none');
    }

    // No additional Sound instances were spawned by the visibility flips.
    expect(audioMock().created).toBe(1);
    expect(audioMock().active).toBe(1);
    expect(audioMock().maxActive).toBeLessThanOrEqual(1);
    // current.id survives the entry/exit storm.
    expect(useMusicStore.getState().current?.id).toBe(tracks[0].id);

    // Toggle still works after the storm.
    const playingBefore = useMusicStore.getState().isPlaying;
    await act(async () => useMusicStore.getState().toggle());
    expect(useMusicStore.getState().isPlaying).toBe(!playingBefore);
    expect(useMusicStore.getState().current?.id).toBe(tracks[0].id);
    expect(audioMock().created).toBe(1);

    await act(async () => renderer.unmount());
  });

  it('a flurry of overlapping play() calls (autoplay + manual tap race) keeps maxActive ≤ 1', async () => {
    await resetState();

    (global as any).fetch = buildFetchMock([
      [
        /^https:\/\/api\.audius\.co\/v1\/tracks\/search/,
        () =>
          okJson({
            data: [
              audiusRaw('race-1', 'Sky'),
              audiusRaw('race-2', 'Sky High'),
              audiusRaw('race-3', 'Sky Low'),
              audiusRaw('race-4', 'Sky Edit'),
            ],
          }),
      ],
    ]);

    const tracks = await searchTracks(uniqueQuery('race') + ' Sky');
    expect(tracks.length).toBeGreaterThanOrEqual(2);

    // Fire all play() calls without awaiting between them — this is the worst
    // case the generation-token + promise-mutex have to survive.
    await Promise.all([
      useMusicStore.getState().play(tracks[0]),
      useMusicStore.getState().play(tracks[1]),
      useMusicStore.getState().play(tracks[0]),
      useMusicStore.getState().play(tracks[1]),
    ]);

    expect(audioMock().maxActive).toBeLessThanOrEqual(1);
    expect(audioMock().active).toBeLessThanOrEqual(1);
    // Final winner = the LAST play() to claim the generation token (not
    // necessarily the LAST in source order — the mutex serialises the loads
    // and a later claim wins). What we DO require: current is one of the two
    // played tracks, never null, and the store is in a consistent state.
    const finalId = useMusicStore.getState().current?.id;
    expect([tracks[0].id, tracks[1].id]).toContain(finalId);
  });
});
