/**
 * Google Gemini client for Mabayuan Express.
 *
 * Resilience features (Finals Quiz 2, sections 1.2–1.4):
 *  - Request queuing:     at most GEMINI_MAX_CONCURRENT calls in flight; extra calls wait in a bounded queue
 *  - Quota management:    global per-minute and per-day caps kept under the Gemini free tier
 *  - Exponential backoff: retries 429 / 5xx / network errors with growing delays + jitter
 *  - Timeouts:            each attempt is aborted after GEMINI_TIMEOUT_MS
 *  - Invalid key guard:   a rejected API key is logged once and further calls are blocked for 10 minutes
 *  - Caching:             reusable answers are kept in memory with a TTL
 *  - Usage monitoring:    every request is written to ai_usage_logs
 * The API key only lives in the backend environment and is never sent to the browser.
 */
require('dotenv').config();
const pool = require('../db');

const CONFIG = {
  apiKey:        process.env.GEMINI_API_KEY || '',
  model:         process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  thinkingLevel: process.env.GEMINI_THINKING_LEVEL || 'minimal',   // Gemini 3.x: minimal | low | medium | high
  timeoutMs:     Number(process.env.GEMINI_TIMEOUT_MS || 20000),
  maxConcurrent: Number(process.env.GEMINI_MAX_CONCURRENT || 3),
  maxQueue:      Number(process.env.GEMINI_MAX_QUEUE || 25),
  rpm:           Number(process.env.GEMINI_RPM || 10),    // requests per minute across the whole app
  rpd:           Number(process.env.GEMINI_RPD || 250),   // requests per day across the whole app
  maxRetries:    2,
};

// ── Errors ────────────────────────────────────────────────────────────────────
const ERRORS = {
  INVALID_INPUT:   { status: 400, message: 'Please enter a valid question.' },
  THROTTLED:       { status: 429, message: 'You are sending messages too quickly. Please wait a moment and try again.' },
  RATE_LIMITED:    { status: 503, message: 'The AI assistant is busy right now. Please try again in a minute.' },
  BUSY:            { status: 503, message: 'The AI assistant is handling many requests right now. Please try again in a minute.' },
  QUOTA_EXHAUSTED: { status: 503, message: 'The AI assistant has reached its daily limit. Please try again tomorrow or contact the barangay office.' },
  TIMEOUT:         { status: 504, message: 'The AI assistant took too long to respond. Please try again later.' },
  NETWORK:         { status: 503, message: 'The AI service could not be reached. Please try again later.' },
  UNAVAILABLE:     { status: 503, message: 'The AI assistant is currently unavailable. Please contact the barangay office.' },
  BLOCKED:         { status: 422, message: 'I can only help with questions about Barangay Mabayuan services.' },
  EMPTY:           { status: 502, message: 'The AI assistant could not generate a response. Please try rephrasing your question.' },
  INTERNAL:        { status: 500, message: 'Something went wrong. Please try again later.' },
};

class AIError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = ERRORS[code] ? code : 'INTERNAL';
    this.status = ERRORS[this.code].status;
    this.userMessage = ERRORS[this.code].message;
  }
}

// Send an AIError (or any error) to the client without exposing technical details
function sendAIError(res, err, extra = {}) {
  const e = err instanceof AIError ? err : new AIError('INTERNAL');
  if (!(err instanceof AIError)) console.error('[AI] Unexpected error:', err);
  res.status(e.status).json({ ok: false, code: e.code, message: e.userMessage, ...extra });
}

// ── Request queue (concurrency limiter) ───────────────────────────────────────
let active = 0;
const waiting = [];

function acquireSlot() {
  if (active < CONFIG.maxConcurrent) { active++; return Promise.resolve(); }
  if (waiting.length >= CONFIG.maxQueue) return Promise.reject(new AIError('BUSY', 'queue full'));
  return new Promise(resolve => waiting.push(resolve));
}
function releaseSlot() {
  const next = waiting.shift();
  if (next) next(); else active--;
}

// ── Global quota guard (per-minute sliding window + per-day counter) ──────────
const minuteWindow = [];               // timestamps of Gemini calls in the last 60s
let dayKey = '', dayCount = 0;

function todayKey() { return new Date().toISOString().slice(0, 10); }

async function reserveQuota() {
  if (dayKey !== todayKey()) { dayKey = todayKey(); dayCount = 0; }
  if (dayCount >= CONFIG.rpd) throw new AIError('QUOTA_EXHAUSTED', 'daily cap reached');

  const now = Date.now();
  while (minuteWindow.length && now - minuteWindow[0] >= 60000) minuteWindow.shift();
  if (minuteWindow.length >= CONFIG.rpm) {
    const waitMs = 60000 - (now - minuteWindow[0]) + 50;
    if (waitMs > 8000) throw new AIError('RATE_LIMITED', 'per-minute cap reached');
    await sleep(waitMs);
    return reserveQuota();
  }
  minuteWindow.push(Date.now());
  dayCount++;
}

// ── Invalid API key guard ─────────────────────────────────────────────────────
let keyDisabledUntil = 0;

function disableKey(detail) {
  if (Date.now() >= keyDisabledUntil) {
    console.error(`[AI] Gemini rejected the API key — AI calls are paused for 10 minutes. Check GEMINI_API_KEY. (${detail})`);
  }
  keyDisabledUntil = Date.now() + 10 * 60 * 1000;
}

// ── Cache ─────────────────────────────────────────────────────────────────────
const cache = new Map();               // key -> { value, expires }
const CACHE_MAX = 300;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { cache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value, ttlMs) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function backoffDelay(attempt, retryAfterMs) {
  if (retryAfterMs) return retryAfterMs;
  return 1000 * 2 ** attempt + Math.floor(Math.random() * 400);  // 1s, 2s (+ jitter)
}

// Parse Gemini's RetryInfo ("retryDelay": "7s") when present
function parseRetryDelay(body) {
  const info = body?.error?.details?.find(d => d.retryDelay);
  const secs = info ? parseFloat(info.retryDelay) : NaN;
  return Number.isFinite(secs) ? Math.ceil(secs * 1000) : null;
}

/**
 * Remove obvious personal identifiers before text is sent to the AI provider.
 */
function redactPII(text) {
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g, '[phone]')
    .replace(/\b\d{4}-\d{4}-\d{4}-\d{4}\b|\b\d{10,16}\b/g, '[number]');
}

/**
 * Validate and clean user text. Throws INVALID_INPUT with a specific message.
 */
function validateText(value, { min = 2, max = 500, label = 'question' } = {}) {
  if (typeof value !== 'string') throw invalid(`Please enter a ${label}.`);
  // Strip control characters, collapse whitespace
  const text = value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) throw invalid(`Please enter a ${label}.`);
  if (text.length < min) throw invalid(`Your ${label} is too short. Please add more detail.`);
  if (text.length > max) throw invalid(`Your ${label} is too long. Please keep it under ${max} characters.`);
  if (!/[a-zA-ZÀ-ɏ]{2,}/.test(text)) throw invalid(`Please enter a valid ${label}.`);
  return text;
}
function invalid(message) {
  const e = new AIError('INVALID_INPUT');
  e.userMessage = message;
  return e;
}

// ── Core call ─────────────────────────────────────────────────────────────────
/**
 * Call Gemini generateContent.
 * @param {object} opts
 * @param {string} opts.system         system instruction
 * @param {Array}  opts.contents       Gemini contents array
 * @param {object} [opts.schema]       JSON response schema → returns parsed object
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @returns {Promise<{ data: any, attempts: number, latencyMs: number }>}
 */
async function generate({ system, contents, schema, maxTokens = 1024, temperature = 0.3 }) {
  if (!CONFIG.apiKey) throw new AIError('UNAVAILABLE', 'GEMINI_API_KEY not set');
  if (Date.now() < keyDisabledUntil) throw new AIError('UNAVAILABLE', 'API key disabled after rejection');

  await acquireSlot();
  const started = Date.now();
  let attempts = 0;
  try {
    const generationConfig = { temperature, maxOutputTokens: maxTokens };
    if (schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = schema; }
    // Gemini models "think" before answering by default, which makes simple answers slow.
    // Keep thinking to a minimum: Gemini 3.x uses thinkingLevel, Gemini 2.5 Flash uses thinkingBudget.
    if (/^gemini-[3-9]/.test(CONFIG.model)) generationConfig.thinkingConfig = { thinkingLevel: CONFIG.thinkingLevel };
    else if (/2\.5-flash/.test(CONFIG.model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

    const buildBody = () => JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig,
    });
    let body = buildBody();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(CONFIG.model)}:generateContent`;

    for (let attempt = 0; ; attempt++) {
      await reserveQuota();
      attempts++;
      let response, json;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CONFIG.apiKey },
          body,
          signal: controller.signal,
        });
        json = await response.json().catch(() => null);
      } catch (err) {
        clearTimeout(timer);
        const code = err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
        if (attempt < CONFIG.maxRetries && code === 'NETWORK') { await sleep(backoffDelay(attempt)); continue; }
        throw new AIError(code, err.message);
      }
      clearTimeout(timer);

      if (!response.ok) {
        const status = response.status;
        const msg = json?.error?.message || `HTTP ${status}`;
        if (status === 401 || status === 403 || (status === 400 && /api key/i.test(msg))) {
          disableKey(msg);
          throw new AIError('UNAVAILABLE', msg);
        }
        // Model rejected our thinking setting — retry once without it
        if (status === 400 && /thinking/i.test(msg) && generationConfig.thinkingConfig) {
          delete generationConfig.thinkingConfig;
          body = buildBody();
          continue;
        }
        // Model retired or misspelled
        if (status === 404) {
          console.error(`[AI] Gemini model "${CONFIG.model}" is not available — set GEMINI_MODEL to a current model. (${msg})`);
          throw new AIError('UNAVAILABLE', msg);
        }
        if (status === 429 || status >= 500) {
          const retryAfter = parseRetryDelay(json);
          if (attempt < CONFIG.maxRetries && (!retryAfter || retryAfter <= 10000)) {
            await sleep(backoffDelay(attempt, retryAfter));
            continue;
          }
          throw new AIError(status === 429 ? 'RATE_LIMITED' : 'NETWORK', msg);
        }
        console.error('[AI] Gemini request error:', status, msg);
        throw new AIError('INTERNAL', msg);
      }

      if (json?.promptFeedback?.blockReason) throw new AIError('BLOCKED', json.promptFeedback.blockReason);
      const candidate = json?.candidates?.[0];
      if (candidate?.finishReason === 'SAFETY') throw new AIError('BLOCKED', 'SAFETY');
      const text = (candidate?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
      if (!text) throw new AIError('EMPTY', `finishReason=${candidate?.finishReason}`);

      let data = text;
      if (schema) {
        try { data = JSON.parse(text); }
        catch { throw new AIError('EMPTY', 'invalid JSON from model'); }
      }
      return { data, attempts, latencyMs: Date.now() - started };
    }
  } catch (err) {
    err.attempts = attempts;
    err.latencyMs = Date.now() - started;
    throw err;
  } finally {
    releaseSlot();
  }
}

// ── Usage monitoring ──────────────────────────────────────────────────────────
async function logUsage({ feature, status, errorCode = null, cached = false, latencyMs = null, attempts = 0 }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO ai_usage_logs (feature, status, error_code, cached, latency_ms, attempts)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING log_id`,
      [feature, status, errorCode, cached, latencyMs, attempts]
    );
    return rows[0].log_id;
  } catch (err) {
    console.error('[AI] Could not write usage log:', err.message);
    return null;
  }
}

function liveStatus() {
  if (dayKey !== todayKey()) { dayKey = todayKey(); dayCount = 0; }
  const now = Date.now();
  return {
    configured: !!CONFIG.apiKey,
    model: CONFIG.model,
    key_paused: now < keyDisabledUntil,
    active_requests: active,
    queued_requests: waiting.length,
    calls_last_minute: minuteWindow.filter(t => now - t < 60000).length,
    per_minute_limit: CONFIG.rpm,
    calls_today: dayCount,
    per_day_limit: CONFIG.rpd,
    cache_entries: cache.size,
  };
}

// ── Per-user throttling middleware ────────────────────────────────────────────
/**
 * Limit how many AI requests one user (or IP for visitors) can make.
 */
function createThrottle({ perMinute, perDay }) {
  const hits = new Map();   // key -> { minute: number[], day: string, dayCount: number }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.day !== todayKey() && !v.minute.some(t => now - t < 60000)) hits.delete(k);
  }, 10 * 60 * 1000).unref();

  return (req, res, next) => {
    const key = req.session?.resident ? `r:${req.session.resident.resident_id}`
              : req.session?.user     ? `u:${req.session.user.user_id}`
              : `ip:${req.ip}`;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.day !== todayKey()) { h = { minute: [], day: todayKey(), dayCount: 0 }; hits.set(key, h); }
    h.minute = h.minute.filter(t => now - t < 60000);
    if (h.minute.length >= perMinute) {
      return sendAIError(res, new AIError('THROTTLED'), { retry_after: Math.ceil((60000 - (now - h.minute[0])) / 1000) });
    }
    if (h.dayCount >= perDay) {
      const e = new AIError('THROTTLED');
      e.userMessage = 'You have reached the daily limit for AI requests. Please try again tomorrow.';
      return sendAIError(res, e);
    }
    h.minute.push(now);
    h.dayCount++;
    next();
  };
}

module.exports = {
  AIError,
  sendAIError,
  generate,
  validateText,
  redactPII,
  cacheGet,
  cacheSet,
  logUsage,
  liveStatus,
  createThrottle,
};
