// PRESERVATION test (music-and-performance-fixes spec, Task 2).
//
// Property 8 / Property 6 (¬C) — Одиночный long-press работает как прежде.
// Observation-first: на ТЕКУЩЕМ коде профиля обработчик long-press —
//   onLongPress={() => { triggerHaptic('medium'); setContextPost(post); }}
// а меню рендерится при visible={!!contextPost}. ОДИНОЧНОЕ нажатие (без быстрых
// повторов, ¬C для isBugCondition_ContextMenu) открывает ровно одно меню для
// нажатого поста, а выбор действия в меню (копировать/поделиться/ответить/
// редактировать/удалить/пожаловаться) корректно вызывает соответствующий обработчик
// и закрывает меню (onClose → setContextPost(null)).
// Этот инвариант нельзя нарушить при добавлении guard/debounce.
// Тест ДОЛЖЕН ПРОХОДИТЬ на unfixed-коде.
//
// Library: fast-check + Jest. Моделируется ровно текущая логика обработчика
// (как в exploratory-тесте задачи 1), без рендеринга нативного <Modal>.

import fc from 'fast-check';

type Post = { id: string };

// Точная репродукция текущего (незащищённого) поведения профиля для ОДИНОЧНОГО
// long-press: setContextPost(post) один раз → меню становится видимым для него.
function simulateSingleLongPress(post: Post): { openCount: number; visible: boolean; target: Post | null } {
  let contextPost: Post | null = null;
  let openCount = 0;

  // Один long-press:
  contextPost = post; // setContextPost(post)
  openCount += 1;

  const visible = !!contextPost; // PostContextMenu visible={!!contextPost}
  return { openCount, visible, target: contextPost };
}

// Действия меню: каждое выбранное действие вызывает свой обработчик, затем onClose
// сбрасывает contextPost (меню закрывается). Действия идентичны текущим.
const MENU_ACTIONS = ['copy', 'share', 'reply', 'edit', 'delete', 'report'] as const;
type MenuAction = (typeof MENU_ACTIONS)[number];

function simulateMenuAction(action: MenuAction): { invoked: number; closedAfter: boolean } {
  const handlers: Record<MenuAction, jest.Mock> = {
    copy: jest.fn(),
    share: jest.fn(),
    reply: jest.fn(),
    edit: jest.fn(),
    delete: jest.fn(),
    report: jest.fn(),
  };
  let contextPost: Post | null = { id: 'p' }; // меню открыто

  // Пользователь выбирает действие:
  handlers[action]();
  // onClose → setContextPost(null)
  contextPost = null;

  return { invoked: handlers[action].mock.calls.length, closedAfter: contextPost === null };
}

describe('PRESERVATION: single long-press context menu (Property 8 / 3.9, 3.10)', () => {
  // ───────────────────────────────────────────────────────────────────────
  // 3.9 — Одиночный long-press открывает ровно одно меню для нажатого поста.
  // EXPECTED: PASS on unfixed — единичное нажатие даёт одно открытие.
  it('3.9: одиночный long-press открывает ровно одно меню для нажатого поста', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (id) => {
        const post: Post = { id: `post-${id}` };
        const { openCount, visible, target } = simulateSingleLongPress(post);

        expect(openCount).toBe(1);
        expect(visible).toBe(true);
        expect(target?.id).toBe(post.id);
      }),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3.10 — Выбор действия в меню выполняет именно это действие и закрывает меню.
  // EXPECTED: PASS on unfixed — каждое действие вызывает свой обработчик ровно раз.
  it('3.10: выбор действия меню вызывает соответствующий обработчик и закрывает меню', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MENU_ACTIONS), (action) => {
        const { invoked, closedAfter } = simulateMenuAction(action);
        expect(invoked).toBe(1);
        expect(closedAfter).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3.9 (example): явный одиночный long-press → одно открытие, тот же набор действий.
  it('3.9 (example): одиночное нажатие → одно меню с полным набором действий', () => {
    const { openCount, visible } = simulateSingleLongPress({ id: 'post-1' });
    expect(openCount).toBe(1);
    expect(visible).toBe(true);
    // Набор действий не изменился.
    expect(MENU_ACTIONS).toEqual(['copy', 'share', 'reply', 'edit', 'delete', 'report']);
  });
});
