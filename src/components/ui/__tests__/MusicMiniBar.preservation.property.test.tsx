// PRESERVATION test (music-and-performance-fixes spec, Task 2).
//
// Property 8 / Property 3 (¬C) — Без очереди крестик виден.
// Observation-first: на ТЕКУЩЕМ MusicMiniBar крестик (Feather "x") рендерится,
// и при ПУСТОЙ очереди (queue(recent,current).length === 0) он ДОЛЖЕН отображаться.
// Этот инвариант нельзя нарушить при фиксе крестика (фикс скрывает крестик только
// при НЕпустой очереди). Тест ДОЛЖЕН ПРОХОДИТЬ на unfixed-коде.
//
// Library: react-test-renderer + Jest + fast-check (мок тяжёлых/нативных deps).
//
// Covered:
//   3.5 (¬C): recent=[A] (или []), current=A → queue=[] → крестик отображается.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import fc from 'fast-check';

// --- Mock heavy/native deps so the widget renders in a plain JS environment ---
jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: { createAsync: jest.fn(async () => ({ sound: {}, status: { isLoaded: true } })) },
  },
}));
jest.mock('@expo/vector-icons', () => ({
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
  return renderer.root.findAll(
    (node) => !!node.props && (node.props as any).name === 'x',
    { deep: true }
  ).length;
}

describe('PRESERVATION: MusicMiniBar close button without a queue (Property 8 / 3.5)', () => {
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
  // EXPECTED: PASS on unfixed — крестик рендерится; при пустой очереди он виден.
  it('3.5: при пустой очереди (recent=[A], current=A) крестик отображается', () => {
    useMusicStore.setState({
      current: track('A'),
      recent: [track('A')], // queue = recent.filter(id !== current.id) = []
      isPlaying: true,
      positionMs: 1000,
      durationMs: 200000,
      isLoading: false,
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<MusicMiniBar />);
    });

    // Очередь пуста → крестик должен быть виден (ровно один экземпляр).
    expect(countCloseButtons(renderer)).toBe(1);

    act(() => renderer.unmount());
  });

  // ───────────────────────────────────────────────────────────────────────
  // Property-based: для любого current и recent, состоящего ТОЛЬКО из current
  // (или пустого) → очередь пуста → крестик виден.
  it('Property 8: пустая очередь ⇒ крестик виден (closeButtonVisible === true)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 4 }),
        (id, dupCount) => {
          const cur = track(`c-${id}`);
          // recent содержит только копии current.id → queue пуста.
          const recent = dupCount === 0 ? [] : Array.from({ length: dupCount }, () => track(cur.id));

          act(() => {
            useMusicStore.setState({
              current: cur,
              recent,
              isPlaying: true,
              positionMs: 0,
              durationMs: 200000,
              isLoading: false,
            });
          });

          let renderer!: TestRenderer.ReactTestRenderer;
          act(() => {
            renderer = TestRenderer.create(<MusicMiniBar />);
          });

          const visible = countCloseButtons(renderer) >= 1;
          act(() => renderer.unmount());

          expect(visible).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});
