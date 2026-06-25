-- Migration: add header_scene column to profiles for "build-your-own" header
-- decorations. Nullable TEXT holding a JSON object {version,items[],background?}.
-- NULL ⇒ no decorations. Mirrors banner_url / theme_id (TEXT, nullable).
--
-- Apply to the live D1 database with:
--   cd workers/api
--   npx wrangler d1 execute san-mes --remote --file=../migrations/0003_profiles_header_scene.sql
ALTER TABLE profiles ADD COLUMN header_scene TEXT;
