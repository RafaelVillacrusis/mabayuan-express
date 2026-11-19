-- Migration: Resident verification documents
-- Adds the valid ID type and the Barangay Certificate of Residency upload to residents.
-- The server also runs these statements on startup (idempotent), so running this
-- manually in the Supabase SQL editor is optional.

ALTER TABLE residents ADD COLUMN IF NOT EXISTS valid_id_type       VARCHAR(80);
ALTER TABLE residents ADD COLUMN IF NOT EXISTS residency_cert_path TEXT;

-- Valid ID uploaded with each document request
ALTER TABLE requests ADD COLUMN IF NOT EXISTS valid_id_path TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS valid_id_type VARCHAR(80);
