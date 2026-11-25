-- 0010 — a participant can mute a conversation, and the server then stops pushing it.
--
-- Muting a chat from the chat list used to be local only (`chatSettingsStore.muted`): it silenced
-- the in-app alert and the foreground banner, but a closed app still got a push for every message,
-- because the push is sent by the Worker, which knew nothing about it. The app now tells the Worker
-- (`PUT` / `DELETE /v1/conversations/:id/mute`), and `fanOutNewMessage` skips the push for a
-- recipient who muted. The realtime ping still goes out, so the chat list and the badge stay right.
--
-- A column on `conversation_participants`, like `last_read_at` (0005): the row already IS the
-- (conversation, user) pair, and the fan-out reads those rows anyway, so knowing who muted costs
-- no extra query per message.
--
-- 0 / 1. NOT NULL with a default, so every existing row reads as "not muted" without a backfill.
-- SQLite has no `ADD COLUMN IF NOT EXISTS`; running this twice fails with "duplicate column name",
-- which leaves the table as it was.
--
-- MUST BE APPLIED BEFORE THE WORKER THAT READS IT IS DEPLOYED: the fan-out selects the column, and
-- without it that query fails, which would stop every message's realtime ping and push.

ALTER TABLE conversation_participants ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
