const { Pool } = require("pg");
require("dotenv").config();

// Create a pool connection to Supabase's PostgreSQL database
const pool = new Pool({
  host: process.env.SUPABASE_HOST,        // Pooler hostname
  port: 5432,                            // Default PostgreSQL port
  user: process.env.SUPABASE_USER,        // User (including project reference)
  password: process.env.SUPABASE_PASSWORD, // Password
  database: process.env.SUPABASE_DB_NAME,  // Database name (e.g., 'postgres')
  ssl: { rejectUnauthorized: false },    // SSL is required for Supabase
  max: 10                                 // Maximum number of connections
});

module.exports = pool;