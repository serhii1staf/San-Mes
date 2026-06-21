-- Migration: push_tokens table for Expo push notifications.
-- Apply to the live D1 database with:
--   cd workers/api
--   npx wrangler d1 execute san-mes --remote --file=../migrations/0001_push_tokens.sql
CREATE TABLE IF NOT EXISTS push_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  platform    TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
