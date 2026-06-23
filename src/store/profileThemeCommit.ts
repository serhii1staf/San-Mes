import type { ProfileThemeState } from './profileThemeStore';

/**
 * profileThemeCommit — pure orchestration of the optimistic commit / revert
 * flow used by the Theme_Selection_Screen (`app/settings/profile-theme.tsx`).
 *
 * Extracted from the screen so the commit/revert behavior (design Property 13)
 * can be unit/property tested without mounting React or hitting the network.
 * The screen wires the real `profileThemeStore` setters, the Supabase profile
 * `PATCH`, the auth-store commit, and the error toast into these dependencies;
 * tests inject in-memory equivalents and a mocked persist function forced to
 * succeed / reject / never-resolve.
 *
 * Behavior (Req 2.4, 2.5, 2.6, 3.8):
 *  1. Optimistically set the per-account active Theme_Id to `nextId`
 *     (synchronously, before the first await, so the displayed selection
 *     updates immediately — Req 2.4).
 *  2. Persist via the injected `persist` fn raced against a hard timeout
 *     (`timeoutMs`, default 5000 — Req 2.5). A timeout counts as a failure.
 *  3. On rejection / timeout / `invalid_theme_id` (any truthy `error`), revert
 *     the active id back to `prevId` and signal the error (Req 2.6, 3.8).
 *  4. On success, keep the selected id and run `onSuccess` so the owner mirror
 *     reflects it without waiting for a realtime round-trip.
 */

/** Result of a profile-update persistence attempt (mirrors `updateProfile`). */
export interface PersistResult {
  error: string | null;
}

/** Outcome of the commit flow: the optimistic value was kept, or rolled back. */
export type CommitOutcome = 'committed' | 'reverted';

export interface ThemeSelectionDeps {
  /** The account whose Theme_Id is being changed. */
  accountId: string;
  /** The newly selected (known) Theme_Id to commit. */
  nextId: string;
  /**
   * The previously persisted Theme_Id captured BEFORE the optimistic write, so
   * a failure can restore the exact prior value (which may be `undefined`).
   */
  prevId: string | undefined;
  /** Persist the selection (e.g. `PATCH /v1/profiles/me { theme_id }`). */
  persist: (accountId: string, themeId: string) => Promise<PersistResult>;
  /** Optimistic / commit setter (the store's `setThemeId`). */
  setThemeId: ProfileThemeState['setThemeId'];
  /** Revert setter (the store's `revertThemeId`). */
  revertThemeId: ProfileThemeState['revertThemeId'];
  /** Called with the committed id on success (e.g. mirror into the auth store). */
  onSuccess: (themeId: string) => void;
  /** Called when persistence fails / times out (e.g. show an error toast). */
  onError: () => void;
  /** Persistence deadline in ms; exceeding it is treated as failure (Req 2.5). */
  timeoutMs?: number;
}

/** The persistence attempt must complete or fail within 5 seconds (Req 2.5). */
export const PERSIST_TIMEOUT_MS = 5000;

/**
 * Run the optimistic commit/revert flow. Resolves with `'committed'` when the
 * selected id was retained, or `'reverted'` when it was rolled back to `prevId`.
 *
 * The optimistic `setThemeId` runs synchronously before the first `await`, so
 * callers can rely on the active id already equalling `nextId` immediately
 * after invoking this function (before the returned promise settles).
 */
export async function persistThemeSelection(
  deps: ThemeSelectionDeps,
): Promise<CommitOutcome> {
  const {
    accountId,
    nextId,
    prevId,
    persist,
    setThemeId,
    revertThemeId,
    onSuccess,
    onError,
    timeoutMs = PERSIST_TIMEOUT_MS,
  } = deps;

  // 1. Optimistic per-account commit (synchronous — Req 2.4).
  setThemeId(accountId, nextId);

  // 2. Persist with a hard timeout race; a timeout counts as failure (Req 2.5).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PersistResult>((resolve) => {
    timer = setTimeout(() => resolve({ error: 'timeout' }), timeoutMs);
  });

  let result: PersistResult;
  try {
    result = await Promise.race([persist(accountId, nextId), timeout]);
  } catch {
    result = { error: 'persist_failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }

  // 3. Failure → revert to the previously persisted id and signal (Req 2.6, 3.8).
  if (result.error) {
    revertThemeId(accountId, prevId);
    onError();
    return 'reverted';
  }

  // 4. Success → keep the selected id.
  onSuccess(nextId);
  return 'committed';
}
