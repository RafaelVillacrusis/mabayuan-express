-- Migration: Create captain_messages table
-- Run this in your Supabase SQL editor (or psql) once before starting the server.

CREATE TABLE IF NOT EXISTS captain_messages (
  message_id       SERIAL PRIMARY KEY,
  captain_user_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  target_audience  VARCHAR(20) NOT NULL CHECK (target_audience IN ('resident', 'staff', 'all')),
  subject          VARCHAR(200) NOT NULL,
  body             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast history lookup
CREATE INDEX IF NOT EXISTS idx_captain_messages_created ON captain_messages (created_at DESC);

-- Scheduled announcements and expiry dates (also applied automatically on server start)
ALTER TABLE captain_messages ADD COLUMN IF NOT EXISTS publish_at  TIMESTAMPTZ;
ALTER TABLE captain_messages ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ;
ALTER TABLE captain_messages ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
UPDATE captain_messages SET publish_at = created_at, notified_at = created_at WHERE publish_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_captain_messages_publish ON captain_messages (publish_at DESC);

-- Optional image on an announcement (Supabase Storage path)
ALTER TABLE captain_messages ADD COLUMN IF NOT EXISTS image_path TEXT;
