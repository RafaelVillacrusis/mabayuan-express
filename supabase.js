const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Use service role key for server-side operations (storage upload/download)
// This bypasses Row Level Security — safe because this client is only used server-side
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

module.exports = supabase;
