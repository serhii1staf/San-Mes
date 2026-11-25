-- 0009: failed sign-ins per device key, for the login lockout (routes/auth.ts, "THE PIN CANNOT BE
-- WALKED THROUGH").
--
-- `key_hash` is the SHA-256 of the device key, never the key itself: this table must not become a
-- second copy of the login secret. Rows are deleted on a successful sign-in and age out of their
-- window on their own; nothing else reads them.
--
-- Idempotent, like every migration here.

CREATE TABLE IF NOT EXISTS auth_failures (
  key_hash      TEXT PRIMARY KEY,
  failures      INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,
  locked_until  INTEGER NOT NULL DEFAULT 0
);
