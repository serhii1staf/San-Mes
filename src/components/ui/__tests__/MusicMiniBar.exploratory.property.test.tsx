// EXPLORATORY bug-reproduction test (music-and-performance-fixes spec, Task 1).
//
// Library: react-test-renderer + Jest. Encodes the CORRECT behaviour for
// Property 3 and is EXPECTED TO FAIL on the unfixed MusicMiniBar.
//
// Covered:
//   Property 3 (Bug Condition) — крестик (1.5):
//     recent=[A,B,C], current=A → queue=[B,C] непуста, но виджет ВСЁ РАВНО
//     отрисовывает кнопку закрытия (<Pressable onPress={stop}> с иконкой Feather "x").
//     Корректно: при непустой очереди крестик должен быть скрыт.
//
// DO NOT fix this test or the app code here.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// --- Mock heavy/native deps so the widget renders in a plain JS environment ---
// expo-av pulls in a native module (ExponentAV) via musicStore; stub it out.
jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: { createAsync: jest.fn(async () => ({ sound: {}, status: { isLoaded: true } })) },
  },
}));
jest.mock('@expo/vector-icons', () => ({
  // Functional component returning null; still discoverable via props.name in the tree.
  Feather: (_props: { name: string }) => null,
}));
jest.mock('expo-blur', () => ({
  BlurView: ({ children }: any) => children ?? null,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  usePathname: () => '/', // не экран /chat/music → виджет показан
}));
jest.mock('../../../theme', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      accent: { primary: '#f00' },
      text: { primary: '#000', tertiary: '#888' },
    },
  }),
}));
jest.mock('../Text', () => ({ Text: (_props: any) => null }));
jest.mock('../CachedImage', () => ({ CachedImage: (_props: any) => null }));

import { MusicMiniBar } from '../MusicMiniBar';
import { useMusicStore } from '../../../store/musicStore';
import type { Track } from '../../../services/musicService';

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

function countCloseButtons(renderer: TestRenderer.ReactTestRenderer): number {
  // Кнопка закрытия — Feather с name="x".
  return renderer.root.findAll(
    (node) => !!node.props && (node.props as any).name === 'x',
    { deep: true }
  ).length;
}

describe('EXPLORATORY: MusicMiniBar close button (Property 3 — 1.5)', () => {
  afterEach(() => {
    act(() => {
      useMusicStore.setState({
        current: null,
        recent: [],
        isPlaying: false,
        positionMs: 0,
        durationMs: 0,
        isLoading: false,
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // EXPECTED: FAIL on unfixed — крестик рендерится безусловно.
  it('Property 3 (1.5): при непустой очереди (recent=[A,B,C], current=A) крестик SHALL быть скрыт', () => {
    useMusicStore.setState({
      current: track('A'),
      recent: [track('A'), track('B'), track('C')],
      isPlaying: true,
      positionMs: 1000,
      durationMs: 200000,
      isLoading: false,
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<MusicMiniBar />);
    });

    // queue=[B,C] непуста → крестик должен быть скрыт (0 экземпляров).
    expect(countCloseButtons(renderer)).toBe(0);

    act(() => renderer.unmount());
  });
});
