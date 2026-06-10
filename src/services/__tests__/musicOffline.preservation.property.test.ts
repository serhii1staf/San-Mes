// PRESERVATION tests (music-and-performance-fixes spec, Task 2).
//
// Property 8 (Preservation) — офлайн-история и кэш списков (¬C(X)).
// Observation-first: на ТЕКУЩЕМ коде история чата музыки и кэш списков читаются
// синхронно из локального хранилища (kvStore: MMKV → AsyncStorage fallback) БЕЗ
// сбоев, даже когда сеть недоступна; а searchTracks при недоступной сети возвращает
// пустой список, не выбрасывая исключение. Эти инварианты нельзя нарушить при фиксах.
// Тесты ДОЛЖНЫ ПРОХОДИТЬ на unfixed-коде.
//
// Library: fast-check + Jest (jest-expo preset). AsyncStorage мокается в jest.setup.js
// (in-memory); MMKV нативно недоступен в Jest → kvStore прозрачно использует fallback.
//
// Covered:
//   3.4 История запросов чата музыки восстанавливается/сохраняется локально (в т.ч. офлайн).
//   3.5 Кэшированные данные (история музыки, кэш списков) работают офлайн без сбоев.

import fc from 'fast-check';
import { searchTracks } from '../musicService';
import { kvGetJSONSync, kvSetJSON } from '../kvStore';

const HISTORY_KEY = 'music_chat_history';

interface MusicMessage {
  id: string;
  query: string;
  track: null;
  ts: number;
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as any).fetch;
});

describe('PRESERVATION: offline music history + list cache (Property 8 / 3.4, 3.5)', () => {
  // ───────────────────────────────────────────────────────────────────────
  // 3.4 — История запросов: round-trip через kvStore без сбоев (офлайн-путь).
  // EXPECTED: PASS on unfixed — kvSetJSON/kvGetJSONSync работают синхронно из кэша.
  it('3.4: история чата музыки сохраняется и восстанавливается из локального кэша', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 8 }),
            query: fc.string({ maxLength: 20 }),
            ts: fc.integer({ min: 0, max: 1_000_000 }),
          }),
          { maxLength: 30 }
        ),
        (rawMsgs) => {
          const messages: MusicMessage[] = rawMsgs.map((m) => ({
            id: m.id,
            query: m.query,
            track: null,
            ts: m.ts,
          }));

          // Точно как music.tsx: сохраняем последние 50 записей.
          kvSetJSON(HISTORY_KEY, messages.slice(-50));

          // Точно как music.tsx инициализирует messages при монтировании.
          const restored = kvGetJSONSync<MusicMessage[]>(HISTORY_KEY, []);

          expect(restored).toEqual(messages.slice(-50));
        }
      ),
      { numRuns: 50 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3.5 — Пустой/отсутствующий кэш списка читается без сбоев (fallback возвращается).
  it('3.5: чтение отсутствующего кэша списка возвращает fallback без исключений', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 16 }), (key) => {
        const fallback: unknown[] = [];
        const value = kvGetJSONSync<unknown[]>(`missing_${key}`, fallback);
        // Никаких исключений; возвращается заданный fallback.
        expect(Array.isArray(value)).toBe(true);
        expect(value).toEqual(fallback);
      }),
      { numRuns: 50 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3.5 — Офлайн поиск: сеть недоступна (fetch reject) → searchTracks возвращает []
  //        без выброса исключения (устойчивость к офлайну сохраняется).
  // EXPECTED: PASS on unfixed — fetchJson ловит ошибки и возвращает null по всем хостам.
  it('3.5: searchTracks при недоступной сети возвращает [] без сбоев', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 12 }), async (q) => {
        // Сеть недоступна — любой fetch падает.
        (global as any).fetch = jest.fn(async () => {
          throw new Error('Network request failed (offline)');
        });

        const results = await searchTracks(q.trim() || 'song');
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(0);
      }),
      { numRuns: 30 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3.5 (example): пустой запрос всегда даёт [] (без сети) — поведение сохраняется.
  it('3.5 (example): пустой запрос возвращает [] без обращения к сети', async () => {
    (global as any).fetch = jest.fn();
    const results = await searchTracks('   ');
    expect(results).toEqual([]);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
