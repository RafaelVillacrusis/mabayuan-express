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
