// PRESERVATION tests (music-and-performance-fixes spec, Task 2).
//
// Property 8 (Preservation) — поведение вне условий багов (¬C(X)) НЕ должно
// измениться при последующих фиксах. Observation-first: эти инварианты сначала
// наблюдались на ТЕКУЩЕМ (НЕисправленном) musicStore, затем зафиксированы здесь.
// Поэтому тесты ДОЛЖНЫ ПРОХОДИТЬ на unfixed-коде.
//
// Library: Jest (jest-expo preset) + fast-check, с лёгким моком expo-av,
// который трекает per-sound isPlaying/position и считает активные инстансы.
//
// Covered (¬C — последовательные, ненакладывающиеся вызовы):
//   3.1 Toggle того же трека: play(current.id) при загруженном sound →
//       переключает play/pause, current.id неизменен.
//   3.6 Выбор из очереди: play(queueItem) воспроизводит именно его (current → этот трек).
//
// DO NOT change app code in this task.

// --- expo-av mock: per-sound play state + active-instance counter -----------
// expo-av is gone (removed in Expo SDK 55). The mock for its replacement lives in ONE place —
// see src/test-utils/expoAudioMock.ts for why, and for the `__audioMock` contract this preserves.
jest.mock('expo-audio', () => require('../../test-utils/expoAudioMock').createExpoAudioMock());

import fc from 'fast-check';
import { useMusicStore } from '../musicStore';
import type { Track } from '../../services/musicService';

const audioMock = () => (globalThis as any).__audioMock as {
  active: number;
  maxActive: number;
  created: number;
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

describe('PRESERVATION: musicStore behaviour outside bug conditions (Property 8)', () => {
  beforeEach(async () => {
    await resetStore();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3.1 — Toggle того же трека сохраняет current.id и переключает play/pause.
  // EXPECTED: PASS on unfixed — play(sameId) при загруженном sound → toggle().
  it('3.1: повторный play(current.id) переключает play/pause, current.id неизменен', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.integer({ min: 1, max: 5 }),
        async (id, extraTaps) => {
          await resetStore();
          const t = track(`same-${id}`);

          // Первый play загружает звук и начинает воспроизведение.
          await useMusicStore.getState().play(t);
          expect(useMusicStore.getState().current?.id).toBe(t.id);
          expect(useMusicStore.getState().isPlaying).toBe(true);

          // Каждый последующий play того же трека → toggle (флип isPlaying).
          let expectedPlaying = true;
          for (let i = 0; i < extraTaps; i++) {
            await useMusicStore.getState().play(t);
            expectedPlaying = !expectedPlaying;
            // current.id НЕ меняется при toggle того же трека.
            expect(useMusicStore.getState().current?.id).toBe(t.id);
          }

          expect(useMusicStore.getState().isPlaying).toBe(expectedPlaying);
          // ¬C: одиночные последовательные вызовы → единственный активный звук.
          expect(audioMock().maxActive).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 50 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3.6 — Выбор трека из очереди воспроизводит ИМЕННО его.
  // EXPECTED: PASS on unfixed — play(other) меняет current на выбранный трек.
  it('3.6: play(элемент очереди) делает его текущим (воспроизводит именно его)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Уникальные id для очереди + индекс выбираемого элемента.
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 2, maxLength: 6 }),
        fc.nat(),
        async (ids, pickRaw) => {
          await resetStore();
          const tracks = ids.map((x, i) => track(`q-${i}-${x}`));

          // Текущий — первый; остальные образуют очередь.
          await useMusicStore.getState().play(tracks[0]);
          expect(useMusicStore.getState().current?.id).toBe(tracks[0].id);

          const queue = tracks.slice(1);
          const picked = queue[pickRaw % queue.length];

          // Тап по элементу очереди (как onPress в развёрнутой очереди виджета).
          await useMusicStore.getState().play(picked);

          // Корректно: текущим становится именно выбранный трек.
          expect(useMusicStore.getState().current?.id).toBe(picked.id);
          // ¬C: последовательные play() → один активный звук.
          expect(audioMock().maxActive).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 50 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3.6 (пример): явная последовательность recent=[A,B,C], current=A → play(B).
  it('3.6 (example): из очереди [B,C] выбор B делает current=B', async () => {
    const A = track('A');
    const B = track('B');
    const C = track('C');
    await useMusicStore.getState().play(A);
    // Прогреваем recent, не меняя факт, что выбор из очереди = play(track).
    useMusicStore.setState({ recent: [A, B, C] });
    expect(useMusicStore.getState().current?.id).toBe('A');

    await useMusicStore.getState().play(B);
    expect(useMusicStore.getState().current?.id).toBe('B');
  });
});
