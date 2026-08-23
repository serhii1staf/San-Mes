/**
 * Which conversation / comment thread is on screen right now.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Reported as: "someone writes to me while I am sitting IN that chat, and I still get a push
 * notification. Why would I need a push for the chat I am looking at?" Same for comments.
 *
 * The foreground presentation decision is made in exactly one place —
 * `setNotificationHandler({ handleNotification })` in pushNotifications.ts — and that callback
 * returned four constants while ignoring the notification it was handed. To suppress a banner
 * for the thread already on screen, that callback needs to know what is on screen, and nothing
 * in the app knew: a repo-wide search for an active/current/focused conversation turned up
 * nothing, in any store or module.
 *
 * A module-level register rather than a store, deliberately:
 *
 *   - `handleNotification` is not a React component. It is a plain async callback the native
 *     module invokes, so it cannot use a hook and gains nothing from a subscription. It needs
 *     a synchronous read, which is exactly what this is.
 *   - Nothing renders from this. Putting it in a Zustand store would invite a component to
 *     subscribe to it, and a re-render on every screen focus change is a cost with no payoff.
 *
 * ── WHY BOTH IDS ────────────────────────────────────────────────────────────
 *
 * The chat screen's route `id` is EITHER a conversation id (from the messages list) OR a peer
 * USER id (from a profile) — the canonical conversation id is only resolved after an async
 * `POST /v1/conversations`. Pushes always carry the canonical `conversation_id`. So a screen
 * registers every id it answers to, and a match against any of them counts. Without that, a
 * chat opened from a profile would keep showing banners for the conversation it IS, for as
 * long as the resolve took.
 */

type ThreadKind = 'chat' | 'post';

/**
 * Ids the on-screen thread answers to. A Set because the chat screen registers both its route
 * id and its resolved conversation id, and they are usually different.
 */
let activeKind: ThreadKind | null = null;
let activeIds: Set<string> = new Set();

/**
 * Declare the thread currently on screen. Call with the ids it answers to; call `clearActive`
 * on blur/unmount.
 *
 * Idempotent and last-writer-wins. Two chat screens are never on screen at once (the router
 * pushes, so the previous one is covered), and the incoming screen's registration replacing
 * the outgoing one's is the correct resolution either way.
 */
export function setActiveThread(kind: ThreadKind, ids: readonly (string | undefined | null)[]): void {
  const next = new Set<string>();
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0) next.add(id);
  }
  if (next.size === 0) return;
  activeKind = kind;
  activeIds = next;
}

/**
 * Clear the register.
 *
 * Guarded by `kind` and an id so a screen unmounting AFTER another has already registered
 * cannot wipe the newcomer's entry. React unmount order is not something to rely on here:
 * navigating chat A → chat B mounts B before unmounting A.
 */
export function clearActiveThread(kind: ThreadKind, ids: readonly (string | undefined | null)[]): void {
  if (activeKind !== kind) return;
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0 && activeIds.has(id)) {
      activeKind = null;
      activeIds = new Set();
      return;
    }
  }
}

/** Is `id` the thread currently on screen? Synchronous — safe from a notification callback. */
export function isActiveThread(kind: ThreadKind, id: string | undefined | null): boolean {
  if (activeKind !== kind) return false;
  if (typeof id !== 'string' || id.length === 0) return false;
  return activeIds.has(id);
}

/**
 * Drop the register when the app leaves the foreground.
 *
 * A push that arrives while the app is backgrounded must ALWAYS be shown, even for the thread
 * that was on screen when the user switched away — otherwise the notification the user needs
 * in order to come back is the one thing they never get. The app-state wiring lives at the
 * call site; this is the mutation it performs.
 */
export function suspendActiveThread(): void {
  activeKind = null;
  activeIds = new Set();
}
