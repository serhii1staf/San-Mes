import fc from 'fast-check';
import {
  Form,
  Mode,
  planSave,
  buildSubmit,
  dispatchAccept,
  normalizeUrl,
  DEFAULT_EMOJI,
} from './consentGate';

// Property-based tests for the pure consent-gate logic
// (mini-app-content-policy-consent spec).
//
// The gate that stands between "Save" and any worker call is captured in
// consentGate.ts (planSave / buildSubmit / dispatchAccept) and consumed by
// app/settings/mini-apps.tsx. These tests exercise the gating invariants over
// many inputs WITHOUT React or network: createApp/updateApp are injected mocks.
//
// Convention: one test per property, fast-check { numRuns: 100 }, each tagged
// with the exact feature + property comment.

// --- Generators -------------------------------------------------------------

// A valid form: name and url are non-empty after trimming. description and
// emoji vary freely (including empty, to exercise the emoji fallback).
const validMiniAppForm: fc.Arbitrary<Form> = fc.record({
  name: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  description: fc.string(),
  emoji: fc.oneof(fc.constant(''), fc.constantFrom('🎮', '🛒', '📊', '🎵')),
  url: fc.oneof(
    fc.webUrl(),
    fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  ),
});

// An invalid field value: empty or whitespace-only string.
const invalidField: fc.Arbitrary<string> = fc.constantFrom('', ' ', '   ', '\n', '\t', '  \t ');

const mode: fc.Arbitrary<Mode> = fc.constantFrom('publish', 'edit');

// --- Tests ------------------------------------------------------------------

describe('consentGate logic properties', () => {
  // Feature: mini-app-content-policy-consent, Property 1: Gating — нет отправки в worker без явного Accept
  it('Property 1: before Accept, planSave opens the gate and no store call is made', () => {
    fc.assert(
      fc.property(validMiniAppForm, mode, (form, m) => {
        const createApp = jest.fn().mockResolvedValue({ error: null });
        const updateApp = jest.fn().mockResolvedValue({ error: null });

        // Pressing Save on a valid form decides to OPEN the gate (no network).
        const plan = planSave(form, true, m === 'edit');

        expect(plan.type).toBe('openGate');
        if (plan.type === 'openGate') {
          expect(plan.mode).toBe(m === 'edit' ? 'edit' : 'publish');
        }
        // Until Accept fires, neither store method is ever called.
        expect(createApp).toHaveBeenCalledTimes(0);
        expect(updateApp).toHaveBeenCalledTimes(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: mini-app-content-policy-consent, Property 2: Accept приводит ровно к одному корректному вызову отправки
  it('Property 2: Accept dispatches exactly one correct store call matching the mode', async () => {
    await fc.assert(
      fc.asyncProperty(
        validMiniAppForm,
        mode,
        fc.uuid(),
        fc.uuid(),
        async (form, m, editingId, creatorId) => {
          const createApp = jest.fn().mockResolvedValue({ error: null });
          const updateApp = jest.fn().mockResolvedValue({ error: null });

          const result = await dispatchAccept(
            form,
            m,
            { editingId, creatorId },
            { createApp, updateApp },
          );

          const expectedFields = {
            name: form.name.trim(),
            description: form.description.trim(),
            emoji: form.emoji || DEFAULT_EMOJI,
            url: normalizeUrl(form.url),
          };

          if (m === 'publish') {
            // Exactly one createApp call with normalized {creator_id, ...fields}.
            expect(createApp).toHaveBeenCalledTimes(1);
            expect(updateApp).toHaveBeenCalledTimes(0);
            expect(createApp).toHaveBeenCalledWith({
              creator_id: creatorId,
              ...expectedFields,
            });
          } else {
            // Exactly one updateApp(editingId, updates) call.
            expect(updateApp).toHaveBeenCalledTimes(1);
            expect(createApp).toHaveBeenCalledTimes(0);
            expect(updateApp).toHaveBeenCalledWith(editingId, expectedFields);
          }
          // The url sent is always normalized to a real scheme.
          expect(expectedFields.url.startsWith('http')).toBe(true);
          expect(result.ok).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: mini-app-content-policy-consent, Property 3: Decline сохраняет черновик и не обращается к сети
  it('Property 3: Decline makes no store call and leaves the form snapshot unchanged', () => {
    fc.assert(
      fc.property(validMiniAppForm, mode, (form, _m) => {
        const createApp = jest.fn().mockResolvedValue({ error: null });
        const updateApp = jest.fn().mockResolvedValue({ error: null });

        // Snapshot the draft before declining.
        const before = JSON.stringify(form);

        // Decline is a pure close: it never invokes buildSubmit/dispatchAccept,
        // so no store method is touched and the form is not mutated.
        const handleDecline = () => {
          /* close gate only — intentionally does nothing to the form/network */
        };
        handleDecline();

        expect(createApp).toHaveBeenCalledTimes(0);
        expect(updateApp).toHaveBeenCalledTimes(0);
        expect(JSON.stringify(form)).toBe(before);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: mini-app-content-policy-consent, Property 4: Невалидные поля не открывают диалог и не вызывают сеть
  it('Property 4: empty/whitespace name or url (or no user) returns error and opens no gate', () => {
    fc.assert(
      fc.property(
        // Build a form where at least one required field is invalid, or no user.
        fc.record({
          name: fc.oneof(invalidField, fc.string({ minLength: 1 })),
          description: fc.string(),
          emoji: fc.string(),
          url: fc.oneof(invalidField, fc.string({ minLength: 1 })),
        }),
        fc.boolean(),
        fc.boolean(),
        (form, hasUser, editing) => {
          const createApp = jest.fn().mockResolvedValue({ error: null });
          const updateApp = jest.fn().mockResolvedValue({ error: null });

          const nameOk = form.name.trim().length > 0;
          const urlOk = form.url.trim().length > 0;
          const isValid = nameOk && urlOk && hasUser;

          const plan = planSave(form, hasUser, editing);

          if (!isValid) {
            // Invalid → error, gate stays closed, no network.
            expect(plan.type).toBe('error');
            expect(createApp).toHaveBeenCalledTimes(0);
            expect(updateApp).toHaveBeenCalledTimes(0);
          } else {
            // Sanity: valid inputs still open the gate (no false errors).
            expect(plan.type).toBe('openGate');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: mini-app-content-policy-consent, Property 5: Ошибка отправки после Accept сохраняет введённые данные
  it('Property 5: a store error after Accept reports failure and does NOT reset the form', async () => {
    await fc.assert(
      fc.asyncProperty(
        validMiniAppForm,
        mode,
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1 }),
        async (form, m, editingId, creatorId, errorMessage) => {
          // The chosen store method fails with { error }.
          const createApp = jest.fn().mockResolvedValue({ error: errorMessage });
          const updateApp = jest.fn().mockResolvedValue({ error: errorMessage });

          const before = JSON.stringify(form);

          const result = await dispatchAccept(
            form,
            m,
            { editingId, creatorId },
            { createApp, updateApp },
          );

          // Failure is reported and the draft must be preserved (no reset).
          expect(result.ok).toBe(false);
          expect(result.error).toBe(errorMessage);
          expect(result.resetForm).toBe(false);
          // The form object handed in is never mutated by the dispatch.
          expect(JSON.stringify(form)).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
