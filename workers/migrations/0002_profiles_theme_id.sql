-- Migration: add theme_id column to profiles for Seasonal Profile Themes.
-- Nullable; NULL ⇒ default-dark theme. Mirrors banner_url (TEXT, nullable).
-- Apply to the live D1 database with:
--   cd workers/api
--   npx wrangler d1 execute san-mes --remote --file=../migrations/0002_profiles_theme_id.sql
ALTER TABLE profiles ADD COLUMN theme_id TEXT;
