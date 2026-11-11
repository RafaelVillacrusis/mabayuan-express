const pool = require('../db');

/**
 * Idempotent schema updates, run once on server start.
 * The same statements are in resident_verification_migration.sql and ai_migration.sql
 * for running manually in the Supabase SQL editor.
 */
async function ensureSchema() {
  try {
    await pool.query(`
      ALTER TABLE residents ADD COLUMN IF NOT EXISTS valid_id_type VARCHAR(80);
      ALTER TABLE residents ADD COLUMN IF NOT EXISTS residency_cert_path TEXT;

      CREATE TABLE IF NOT EXISTS ai_inquiries (
        inquiry_id   SERIAL PRIMARY KEY,
        resident_id  INTEGER,
        user_id      INTEGER,
        source       VARCHAR(20)  NOT NULL DEFAULT 'chatbot',
        message      TEXT         NOT NULL,
        category     VARCHAR(60),
        subcategory  VARCHAR(120),
        intent       VARCHAR(200),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_inquiries_created ON ai_inquiries (created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_usage_logs (
        log_id        SERIAL PRIMARY KEY,
        feature       VARCHAR(30)  NOT NULL,
        status        VARCHAR(20)  NOT NULL,
        error_code    VARCHAR(40),
        cached        BOOLEAN      NOT NULL DEFAULT FALSE,
        latency_ms    INTEGER,
        ui_render_ms  INTEGER,
        attempts      INTEGER      NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_logs (created_at DESC);
    `);
  } catch (err) {
    console.error('Schema migration failed:', err.message);
  }
}

module.exports = { ensureSchema };
