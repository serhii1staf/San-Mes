-- 0004 — moderation tables + missing indexes
--
-- WHY
--
-- 1) `reports` and `blocked_users` were never in `schema.sql` or in any migration.
--    They were created LAZILY at request time by `ensureSchema()` in
--    `src/routes/reports.ts`, on the first moderation call per Worker isolate.
--    That is a bad place for DDL for two reasons: the schema is invisible to
--    `wrangler d1 migrations list`, so drift between environments cannot be seen;
--    and the report/block path is an App Store review REQUIREMENT (Guideline 1.2 —
--    user-generated content must be reportable and users must be blockable), so
--    having it depend on DDL succeeding mid-request is a compliance risk, not just
--    an operational one. Declaring them here makes the schema authoritative; the
--    runtime `CREATE TABLE IF NOT EXISTS` calls stay as a harmless no-op for
--    isolates running against a database that has not had this migration applied.
--
-- 2) `conversations.created_at` had no index, yet `GET /v1/conversations` sorts on
--    it. Without the index SQLite builds a temporary B-tree for every chat-list
--    sync; with it the ORDER BY is satisfied by an index scan.
--
-- Every statement is IF NOT EXISTS, so this migration is idempotent and safe to
-- apply to the production database that already has the runtime-created tables.

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  category    TEXT NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TEXT NOT NULL
);

-- Moderation queue: open reports, oldest first. Matches the admin queue query.
CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON reports (status, created_at);

-- "has this user already reported this thing" lookups, and per-target counts.
CREATE INDEX IF NOT EXISTS idx_reports_target
  ON reports (target_type, target_id);

CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

-- The reverse direction: "who has blocked me", needed to filter someone out of
-- another user's feed. The composite PRIMARY KEY only covers blocker_id first, so
-- this lookup had no index at all.
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked
  ON blocked_users (blocked_id);

-- Chat list ordering (see reason 2 above).
CREATE INDEX IF NOT EXISTS idx_conversations_created
  ON conversations (created_at);
