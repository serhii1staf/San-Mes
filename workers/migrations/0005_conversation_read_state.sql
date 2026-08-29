-- 0005 — server-side read state for conversations
--
-- Apply to the live D1 database with:
--   cd workers/api
--   npx wrangler d1 execute san-mes --remote --file=../migrations/0005_conversation_read_state.sql --yes
--
-- WHY
--
-- The unread badge could only ever show the number `1`.
--
-- Not a rendering bug — a missing-data bug. `chatUnreadStore.reconcile` is what fills in
-- counts for messages that arrived while the app was not running, and the only input it had
-- was `last_message_at` from `GET /v1/conversations`. A timestamp answers "is there anything
-- new" and cannot answer "how many", so `reconcile` writes the literal `1` and there is no
-- arithmetic anywhere that could turn that into a real count. Counts above 1 came exclusively
-- from `bump`, i.e. only from messages the device personally witnessed over the realtime
-- socket while running. Close the app, receive nine messages, reopen: the row said 1.
--
-- Reported as "те, которые у меня были до этого, они сбрасываются, типа на один" — and that
-- is exactly what happens, because a real observed count of 9 is discarded and re-derived as
-- 1 the moment the store rehydrates from a source that only carries a timestamp.
--
-- The second half of the same report — "когда приложение неактивно, я захожу, и оно всё равно
-- показывается" — has the same root cause seen from the other side: the read watermark lives
-- in per-install MMKV, so it is not shared between devices and does not survive a reinstall.
-- Reading a chat on one device left it unread on the other, for ever.
--
-- WHERE THIS COLUMN GOES, AND WHY NOT A NEW TABLE
--
-- `conversation_participants` already IS the (conversation, user) join, with
-- `PRIMARY KEY (conversation_id, user_id)`. Read state is one value per participant, so it is
-- a column on that row: no new table, no new index, no extra join in the list query — the
-- existing `cp` alias in `GET /v1/conversations` already has the row in hand. A separate
-- `conversation_reads` table would have needed its own index and a LEFT JOIN on the hottest
-- query in the app to hold strictly less information.
--
-- The unread COUNT this enables is served by an index that already exists,
-- `idx_messages_conv_created ON messages(conversation_id, created_at)` — a range scan from the
-- watermark forward, not a table scan. Verified present on the live database before writing
-- this migration.
--
-- NOT IDEMPOTENT (the ALTER, at least)
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so re-running line 1 errors with "duplicate column
-- name". That matches 0002 and 0003, which also add columns bare. The backfill below IS
-- idempotent (`WHERE last_read_at IS NULL`), so a partial application is safe to re-run once
-- the ALTER is skipped.

ALTER TABLE conversation_participants ADD COLUMN last_read_at TEXT;

-- ── BACKFILL: EXISTING HISTORY IS READ, NOT UNREAD ──────────────────────────
--
-- Leaving the new column NULL would make every message ever sent count as unread, because
-- "no watermark" honestly means "we have no record of you reading this". The first sync after
-- this migration would hand every existing user a wall of unread counts for conversations they
-- read months ago. That is a worse lie than the `1` this migration exists to remove.
--
-- So each participant starts at their conversation's newest message: everything that exists
-- right now is considered read, and counting begins from the next message. Using the newest
-- message's own timestamp rather than `now` keeps the watermark on the same clock as the
-- values it will be compared against — `messages.created_at` is written by the Worker, and
-- mixing in a migration-time `now` would put the boundary at a moment no message occupies.
--
-- COALESCE covers a conversation with no messages at all, where MAX() is NULL; such a row has
-- nothing to be unread about, and a concrete watermark is easier to reason about than a NULL
-- that would have to be special-cased for ever.
UPDATE conversation_participants
   SET last_read_at = COALESCE(
         (SELECT MAX(m.created_at)
            FROM messages m
           WHERE m.conversation_id = conversation_participants.conversation_id),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
 WHERE last_read_at IS NULL;
