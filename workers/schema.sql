-- ─────────────────────────────────────────────────────────────────────────────
-- Cloudflare D1 schema for the san-mes app.
--
-- This schema mirrors the Supabase Postgres schema reverse-engineered from
-- every `supabase.from(<table>)` call in the codebase. Postgres types were
-- translated to SQLite as follows:
--   uuid          → TEXT  (generate via crypto.randomUUID() in the Worker)
--   timestamptz   → TEXT  (ISO-8601 strings, default CURRENT_TIMESTAMP-ish
--                          via the Worker — SQLite's CURRENT_TIMESTAMP emits
--                          'YYYY-MM-DD HH:MM:SS' which the JS Date parser
--                          accepts but lacks the trailing 'Z'; we therefore
--                          let the Worker set ISO strings on insert and only
--                          fall back to CURRENT_TIMESTAMP if the column is
--                          ever omitted — preserves cross-DB compatibility).
--   boolean       → INTEGER (0/1; the Worker normalises it on the way out).
--   jsonb         → TEXT  (JSON.stringify on write, JSON.parse on read).
--   serial/bigint → not used — the schema is UUID-keyed throughout.
--
-- Foreign-key constraints are intentionally omitted; the Worker enforces
-- referential integrity (and brittle FK migrations are exactly the problem
-- we hit on Supabase). Authorization happens in the Worker, not via RLS.
--
-- Indexes are aligned with every WHERE / ORDER BY / IN observed in the
-- codebase — see `requirements.md` and `design.md` for the per-table notes.
-- ─────────────────────────────────────────────────────────────────────────────

-- profiles ────────────────────────────────────────────────────────────────
-- Reverse-engineered columns: id, username, display_name, emoji, bio,
-- pin_hash, device_key, banner_url, theme_id, links (jsonb in pg → text here),
-- badge, is_verified, created_at, updated_at.
-- `username` is queried with a unique constraint check on register
-- (`error.message.includes('duplicate')` branch), so a UNIQUE index is
-- mandatory. `device_key` is the lookup key for AccountSwitcher's
-- "Find profile by device key" flow, so it gets its own index.
CREATE TABLE IF NOT EXISTS profiles (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  emoji         TEXT NOT NULL DEFAULT '😀',
  bio           TEXT NOT NULL DEFAULT '',
  pin_hash      TEXT,
  device_key    TEXT,
  banner_url    TEXT,
  theme_id      TEXT,            -- selected profile theme id; NULL ⇒ default-dark
  header_scene  TEXT,            -- "build-your-own" header decorations; JSON {version,items,background?}
  links         TEXT,            -- JSON array of {type,url}
  badge         TEXT,
  is_verified   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username    ON profiles(username);
CREATE        INDEX IF NOT EXISTS idx_profiles_device_key  ON profiles(device_key);
CREATE        INDEX IF NOT EXISTS idx_profiles_created_at  ON profiles(created_at DESC);

-- posts ───────────────────────────────────────────────────────────────────
-- Columns: id, author_id, content, image_url, likes_count, comments_count,
-- shares_count, created_at. The feed sorts by created_at DESC and filters
-- by author_id on profile screens — composite index covers both shapes.
CREATE TABLE IF NOT EXISTS posts (
  id              TEXT PRIMARY KEY,
  author_id       TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  image_url       TEXT,
  likes_count     INTEGER NOT NULL DEFAULT 0,
  comments_count  INTEGER NOT NULL DEFAULT 0,
  shares_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_created_at        ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_created    ON posts(author_id, created_at DESC);

-- comments ────────────────────────────────────────────────────────────────
-- Columns: id, post_id, author_id, content, created_at.
-- Filtered by post_id ASC for the comments screen, and by author_id DESC
-- for the user's own replies tab.
CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post_created   ON comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_author_created ON comments(author_id, created_at DESC);

-- likes ───────────────────────────────────────────────────────────────────
-- Columns: user_id, post_id, created_at. Enforced uniqueness via composite
-- primary key — the existing toggleLike code path matches a row by
-- (user_id, post_id) and treats hits as "already liked".
CREATE TABLE IF NOT EXISTS likes (
  user_id     TEXT NOT NULL,
  post_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post_id           ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_created      ON likes(user_id, created_at DESC);

-- follows ─────────────────────────────────────────────────────────────────
-- Columns: follower_id, following_id, created_at. Idempotent inserts are
-- enforced via the composite primary key — `followUser` upserts with
-- onConflict:'follower_id,following_id'.
CREATE TABLE IF NOT EXISTS follows (
  follower_id   TEXT NOT NULL,
  following_id  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_follower_created  ON follows(follower_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_following_created ON follows(following_id, created_at DESC);

-- mini_apps ───────────────────────────────────────────────────────────────
-- Columns: id, creator_id, name, description, emoji, url, created_at.
-- Listed by created_at DESC; the share-link short-id lookup uses a
-- range query on `id` so we leave the PK index handle that.
CREATE TABLE IF NOT EXISTS mini_apps (
  id           TEXT PRIMARY KEY,
  creator_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  emoji        TEXT NOT NULL DEFAULT '🧩',
  url          TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_mini_apps_creator     ON mini_apps(creator_id);
CREATE INDEX IF NOT EXISTS idx_mini_apps_created_at  ON mini_apps(created_at DESC);

-- conversations ───────────────────────────────────────────────────────────
-- Columns: id, created_at. Inserted bare (`.insert({})`) — every other
-- column is nullable / has a default.
CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- conversation_participants ──────────────────────────────────────────────
-- Columns: conversation_id, user_id. Composite PK so a user can't be added
-- to a conversation twice.
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id  TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cp_user_id          ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_cp_conversation_id  ON conversation_participants(conversation_id);

-- messages ────────────────────────────────────────────────────────────────
-- Columns: id, conversation_id, sender_id, text, created_at.
-- Messages are listed in ascending order by created_at within a
-- conversation (`getMessages` orders ASC).
CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  sender_id        TEXT NOT NULL,
  text             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender       ON messages(sender_id);


-- push_tokens ──────────────────────────────────────────────────────────────
-- Expo push tokens, one row per device token. `token` is the PK so a device
-- that switches accounts simply rebinds to a new user_id (ON CONFLICT upsert
-- in routes/push.ts). Used by push.ts to fan out new-message / comment /
-- follow notifications via the Expo Push Service.
CREATE TABLE IF NOT EXISTS push_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  platform    TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
