// Pure, dependency-free consent-gate logic for the Mini_Apps_Screen.
//
// The consent gate that stands between "Save" and any worker call lives inline
// in app/settings/mini-apps.tsx (handleSavePress / handleConsentAccept /
// handleConsentDecline). To make the gating invariants testable as pure logic
// (no React, no network), the decision-making is captured here:
//
//   - planSave   — validation + "open the gate vs show error" decision.
//   - buildSubmit — maps an accepted form + mode to the exact store call.
//   - dispatchAccept — runs the planned call against injected store deps and
//                      reports whether the draft should be reset.
//
// The screen imports these so behavior stays identical while the core logic is
// exercised by property tests (mini-app-content-policy-consent spec).

export type Mode = 'publish' | 'edit';

export interface Form {
  name: string;
  description: string;
  emoji: string;
  url: string;
}

/** Default emoji used when the user never picked one (mirrors the screen). */
export const DEFAULT_EMOJI = '🎮';

/**
 * A form is valid only when both required fields (name, url) are non-empty
 * after trimming AND there is an authenticated user. Whitespace-only values
 * are treated as empty.
 */
export function isFormValid(form: Form, hasUser: boolean): boolean {
  return Boolean(form.name.trim() && form.url.trim() && hasUser);
}

/**
 * Normalizes a raw URL: if it already starts with `http` it is used trimmed,
 * otherwise an `https://` prefix is added. Matches the screen's inline logic.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
}

export type SavePlan =
  | { type: 'error' }
  | { type: 'openGate'; mode: Mode };

/**
 * Decides what happens when the user presses Save:
 *   - invalid form → { type: 'error' } (caller shows fill-fields error, gate
 *     stays closed, no network).
 *   - valid form → { type: 'openGate', mode } where mode is 'edit' when
 *     editing an existing app, otherwise 'publish'. NO network call is made
 *     here — submission is deferred until explicit Accept.
 */
export function planSave(form: Form, hasUser: boolean, editing: boolean): SavePlan {
  if (!isFormValid(form, hasUser)) {
    return { type: 'error' };
  }
  return { type: 'openGate', mode: editing ? 'edit' : 'publish' };
}

export interface CreateAppPayload {
  creator_id: string;
  name: string;
  description: string;
  emoji: string;
  url: string;
}

export interface UpdateAppUpdates {
  name: string;
  description: string;
  emoji: string;
  url: string;
}

export type SubmitPlan =
  | { call: 'createApp'; payload: CreateAppPayload }
  | { call: 'updateApp'; id: string; updates: UpdateAppUpdates };

export interface SubmitIds {
  /** Id of the app being edited (null/undefined for a fresh publish). */
  editingId: string | null;
  /** Authenticated user id, used as creator_id on publish. */
  creatorId: string;
}

/**
 * Maps an accepted form + mode to exactly one store call:
 *   - publish → createApp with { creator_id, name, description, emoji, url }
 *   - edit    → updateApp(editingId, { name, description, emoji, url })
 * URL is normalized and string fields are trimmed; a blank emoji falls back to
 * the default. This is a pure data transform — it performs no I/O.
 */
export function buildSubmit(form: Form, mode: Mode, ids: SubmitIds): SubmitPlan {
  const fields = {
    name: form.name.trim(),
    description: form.description.trim(),
    emoji: form.emoji || DEFAULT_EMOJI,
    url: normalizeUrl(form.url),
  };
  if (mode === 'edit') {
    return { call: 'updateApp', id: ids.editingId as string, updates: fields };
  }
  return { call: 'createApp', payload: { creator_id: ids.creatorId, ...fields } };
}

export interface DispatchDeps {
  createApp: (payload: CreateAppPayload) => Promise<{ error: string | null }>;
  updateApp: (id: string, updates: UpdateAppUpdates) => Promise<{ error: string | null }>;
}

export interface DispatchResult {
  /** True when the store call succeeded (no error). */
  ok: boolean;
  /** Error message from the store, or null on success. */
  error: string | null;
  /**
   * Whether the caller should reset the form. Only true on success — on error
   * the draft MUST be preserved so the user can retry without re-entering data.
   */
  resetForm: boolean;
}

/**
 * Runs the planned submission against the injected store deps after Accept.
 * Performs exactly one store call (createApp OR updateApp, never both). On
 * `{ error }` the result reports failure and resetForm=false (draft kept); on
 * success it reports resetForm=true.
 */
export async function dispatchAccept(
  form: Form,
  mode: Mode,
  ids: SubmitIds,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const plan = buildSubmit(form, mode, ids);
  const { error } =
    plan.call === 'createApp'
      ? await deps.createApp(plan.payload)
      : await deps.updateApp(plan.id, plan.updates);
  if (error) {
    return { ok: false, error, resetForm: false };
  }
  return { ok: true, error: null, resetForm: true };
}
