-- Migration: Resident verification documents
-- Adds the valid ID type and the Barangay Certificate of Residency upload to residents.
-- The server also runs these statements on startup (idempotent), so running this
-- manually in the Supabase SQL editor is optional.

ALTER TABLE residents ADD COLUMN IF NOT EXISTS valid_id_type       VARCHAR(80);
ALTER TABLE residents ADD COLUMN IF NOT EXISTS residency_cert_path TEXT;

-- Valid ID uploaded with each document request
ALTER TABLE requests ADD COLUMN IF NOT EXISTS valid_id_path TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS valid_id_type VARCHAR(80);

-- Gender chosen at sign-up (Male, Female, Prefer not to say)
ALTER TABLE residents ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

-- Email verification codes for resident profile changes (email / password)
CREATE TABLE IF NOT EXISTS profile_verifications (
  verification_id   SERIAL PRIMARY KEY,
  resident_id       INTEGER     NOT NULL,
  purpose           VARCHAR(20) NOT NULL,
  new_email         VARCHAR(160),
  new_password_hash TEXT,
  code_hash         TEXT        NOT NULL,
  attempts          INTEGER     NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ NOT NULL,
  consumed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profile_verif_resident ON profile_verifications (resident_id, purpose);
