======================================================
  MABAYUAN EXPRESS — SETUP GUIDE
======================================================

1. INSTALL DEPENDENCIES
   Run: npm install

2. CONFIGURE .env
   Fill in your values in the .env file:

   --- PostgreSQL (Supabase) ---
   SUPABASE_HOST     = from Supabase > Project Settings > Database > Host
   SUPABASE_USER     = postgres.your-project-ref
   SUPABASE_PASSWORD = your database password
   SUPABASE_DB_NAME  = postgres

   --- Supabase Auth (for Forgot Password OTP) ---
   SUPABASE_URL      = https://your-project-ref.supabase.co
   SUPABASE_ANON_KEY = your anon/public key

   Both found at: Supabase Dashboard → Project Settings → API

   SESSION_SECRET    = any long random string
   PORT              = 3000

3. ENABLE SUPABASE AUTH (OTP EMAIL)
   In your Supabase Dashboard:
   a. Go to Authentication → Providers
   b. Make sure "Email" provider is ENABLED
   c. Go to Authentication → Email Templates
      → Customize the OTP email if you want (optional)
   d. Go to Authentication → Settings
      → Make sure "Enable email confirmations" is ON
      → OTP expiry: recommend 600 seconds (10 minutes)

   ⚠️  IMPORTANT: Supabase Auth and your app's residents/users tables
       are SEPARATE. Supabase Auth only sends the OTP email.
       Your passwords are still stored in residents/users via bcrypt.
       The OTP only verifies identity before allowing password reset.

4. RUN THE SERVER
   node server.js
   or: npm start

======================================================
  FEATURES SUMMARY
======================================================

✅ Forgot Password — OTP via Supabase Auth (no SMTP needed)
✅ Password visibility toggle on all login/register forms
✅ Password strength validation on registration
   (min 6 chars, letter + number + special character)
✅ Inline login errors — no more blank error pages
   "No account found" / "Incorrect password"
✅ System Admin Dashboard — sidebar layout, no redundant layout
✅ uploads/ids/ folder auto-created on server start

======================================================
