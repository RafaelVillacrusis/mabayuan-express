-- Migration: AI integration (Google Gemini)
-- The server also runs these statements on startup (idempotent), so running this
-- manually in the Supabase SQL editor is optional.

-- Resident inquiries asked through the chatbot or entered by staff, with the AI classification
CREATE TABLE IF NOT EXISTS ai_inquiries (
  inquiry_id   SERIAL PRIMARY KEY,
  resident_id  INTEGER,                              -- NULL for public (not logged-in) visitors
  user_id      INTEGER,                              -- staff/captain who classified it manually
  source       VARCHAR(20)  NOT NULL DEFAULT 'chatbot', -- 'chatbot' | 'staff'
  message      TEXT         NOT NULL,
  category     VARCHAR(60),
  subcategory  VARCHAR(120),
  intent       VARCHAR(200),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_inquiries_created ON ai_inquiries (created_at DESC);

-- One row per AI request, used for usage monitoring and performance analysis
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  log_id        SERIAL PRIMARY KEY,
  feature       VARCHAR(30)  NOT NULL,              -- 'chatbot' | 'classifier' | 'report'
  status        VARCHAR(20)  NOT NULL,              -- 'success' | 'fallback' | 'error'
  error_code    VARCHAR(40),
  cached        BOOLEAN      NOT NULL DEFAULT FALSE,
  latency_ms    INTEGER,                            -- server-side time to get the AI response
  ui_render_ms  INTEGER,                            -- reported by the browser after rendering
  attempts      INTEGER      NOT NULL DEFAULT 0,    -- Gemini calls made (retries included)
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_logs (created_at DESC);
