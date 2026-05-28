-- Run this in Supabase Dashboard > SQL Editor
-- Adds badge and verification columns to profiles table

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS badge text DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false;

-- Create index for quick badge/verified lookups
CREATE INDEX IF NOT EXISTS idx_profiles_badge ON profiles(badge) WHERE badge IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_verified ON profiles(is_verified) WHERE is_verified = true;
