/**
 * The number on the app icon — one owner, two independent inputs.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Reported as: the icon badge appeared, but "maybe it has bugs". It did. Two of them, both caused by
 * the icon number being driven from a single store that only knows about part of the picture.
 *
 * `setOsBadgeCount` was called only from `notificationsBadgeStore`, whose count comes from
 * `computeUnread()` over the notifications feed. That feed's own type says what it carries:
 *
 *     export type NotificationKind = 'like' | 'comment' | 'follow';
 *
 * Direct messages are not in it. They live in `chatUnreadStore`, which already computes exactly the
 * right number and already exports `totalChatUnread`, but nothing ever forwarded it to the OS. So:
 *
 *   1. Unread DMs never reached the icon. Three unread messages and no likes showed no number at
 *      all — the most common case for a messenger, and the one the feature was asked for.
 *   2. `markAllSeen()` pushed a hard 0. Opening the notifications screen wiped the icon even while
 *      messages were still unread, because the one writer assumed it owned the whole number.
 *
 * ── THE SHAPE OF THE FIX ────────────────────────────────────────────────────
 *
 * Two setters, one flush. Each store reports ONLY its own component and never the total, so neither
 * can clear the other's contribution — that is what kills bug 2 structurally rather than by
 * remembering to be careful at each call site. `markAllSeen` zeroes the notifications component; the
 * chat component is untouched and the icon keeps showing the unread DMs.
 *
 * Deliberately NOT importing either store. Both stores import this module, so importing them back
 * would be a cycle, and a cycle here is nasty: these are module-scope `create()` calls, so a
 * half-initialised store is observable. Pushing values in also means this file has no opinion about
 * where the numbers come from.
 *
 * ── WHAT THIS DOES NOT FIX ──────────────────────────────────────────────────
 *
 * Still only correct while the process has run at least once. A push delivered to a terminated app
 * runs no JS, so the number can only come from `aps.badge` in the payload, which the Worker does not
 * send and cannot compute without read-state. That gap is written up at length in
 * `src/services/pushNotifications.ts`; nothing here changes it.
 */

/** Notifications-feed component (likes / comments / follows). */
let notificationsPart = 0;
/** Chat component (unread direct messages, summed across conversations). */
let chatPart = 0;

/** Last value actually handed to the OS, so an unchanged total costs no native call. `-1` is
 *  "nothing written yet" and can never equal a real total, so the first flush always writes. */
let lastWritten = -1;

function flush(): void {
  const total = notificationsPart + chatPart;
  if (total === lastWritten) return;
  lastWritten = total;
  // Fire-and-forget: an async native call that no part of the UI waits on, so awaiting it would only
  // give the reporting setters a reason to be async.
  //
  // A lazy `require`, not `await import`. This is the pattern `getModules()` in pushNotifications.ts
  // already uses, and the reason matters: babel-jest leaves a real dynamic `import()` in place, and
  // Node's VM then rejects it with ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG unless jest runs with
  // --experimental-vm-modules. On device it works, because Metro compiles `import()` down to a
  // require — so the previous form was not broken in the app, it was untestable, and a swallowed
  // rejection inside a `catch` is exactly the kind of thing that stays invisible until someone looks.
  // `require` behaves the same in both places.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setOsBadgeCount } = require('./pushNotifications') as typeof import('./pushNotifications');
    void setOsBadgeCount(total);
  } catch {
    // Never let the icon badge break the in-app badges.
  }
}

function sanitize(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

// Both setters assign and then flush unconditionally, leaving ALL deduplication to `flush`. An
// early return here on "my component did not change" looks like the same thing and is not: on a cold
// start where nothing is unread, both components are already 0, so both setters would return before
// flushing and the first write would never happen. That write matters — it is what actively clears a
// number the launcher is still showing from a previous session. Deduping on the total, against a
// `lastWritten` that starts at an impossible -1, gets both properties from one rule.

/** Report the notifications-feed unread count. Call on every change to it. */
export function setNotificationsBadgePart(count: number): void {
  notificationsPart = sanitize(count);
  flush();
}

/** Report the total unread direct-message count. Call on every change to it. */
export function setChatBadgePart(count: number): void {
  chatPart = sanitize(count);
  flush();
}

/** Test seam: forget both components and the dedupe memo. */
export function __resetOsBadgeForTests(): void {
  notificationsPart = 0;
  chatPart = 0;
  lastWritten = -1;
}
