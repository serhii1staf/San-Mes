/**
 * How much text a user may put in one message or one comment.
 *
 * ── WHY A LIMIT AT ALL ──────────────────────────────────────────────────────────
 *
 * Neither composer had one. Not "a generous one" — none: no `maxLength` on the chat input,
 * none on the comment input. The only bound was server-side truncation, which is the worst
 * possible place for it: the user types 40 000 characters, sees them all, presses send, and
 * the server silently stores the first 16 000. Nothing tells them the rest is gone.
 *
 * Before that point it is also a rendering problem, which is what prompted this. One
 * enormous bubble means one enormous text layout, measured and re-measured by the list on
 * every pass, in a row whose height FlashList has to estimate. A handful of them in a
 * transcript is enough to make scrolling visibly worse, and a user can produce them by
 * accident with one paste.
 *
 * ── THE NUMBER ──────────────────────────────────────────────────────────────────
 *
 * Telegram's limit for a single text message is 4096 characters. Asked for "the same, maybe a
 * little more", so: 5000. That is comfortably above any realistic message, still small enough
 * that one bubble cannot dominate a layout pass, and it is a round number a user can be told.
 *
 * Comments get the SAME number rather than a smaller one. A comment that needs 5000
 * characters is unusual, but there is no reason for the two surfaces to disagree — a rule the
 * user has to learn twice is a worse rule.
 *
 * ── WHERE IT IS ENFORCED ────────────────────────────────────────────────────────
 *
 * `maxLength` on the input, which is the only enforcement that is honest: the field simply
 * stops accepting characters, so there is never text on screen that will not survive the
 * send. Validating on submit and rejecting would be worse (the user has already written it);
 * truncating on submit would be worse still (silent loss).
 *
 * The server caps stay as a backstop against a client that ignores this, and they should be
 * brought in line in the next Worker deploy — `messages.ts` truncates at 16000 and
 * `comments.ts` at 4000, so today the two ends disagree in both directions.
 */
export const MAX_MESSAGE_CHARS = 5000;

/** Same limit for comments — see the note above on why the two are deliberately equal. */
export const MAX_COMMENT_CHARS = 5000;

/**
 * When to start showing the user how much room is left.
 *
 * Showing a counter permanently is noise: it implies the limit is close when it is not, on
 * every message anyone ever types. It only carries information near the end, so it appears at
 * 90% and not before.
 */
export const COUNTER_VISIBLE_FROM = Math.floor(MAX_MESSAGE_CHARS * 0.9);
