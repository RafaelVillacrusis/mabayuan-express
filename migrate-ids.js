/**
 * migrate-ids.js
 * Run once: node migrate-ids.js
 *
 * What it does:
 * 1. Finds all residents with old local-disk paths (/uploads/ids/...)
 * 2. If the file still exists on disk → uploads it to Supabase Storage
 * 3. If the file is gone (lost on redeploy) → marks valid_id_path as "missing:re-upload-required"
 * 4. Updates the DB record with the new path
 */

require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const pool = require('./db');
const supabase = require('./supabase');

async function migrate() {
  console.log('🔄 Starting ID migration to Supabase Storage...\n');

  const { rows } = await pool.query(
    `SELECT resident_id, email, first_name, last_name, valid_id_path
     FROM residents
     WHERE valid_id_path IS NOT NULL
       AND valid_id_path NOT LIKE 'supabase:%'
       AND valid_id_path != 'missing:re-upload-required'`
  );

  console.log(`Found ${rows.length} resident(s) with old-style local paths.\n`);

  let uploaded = 0, missing = 0, failed = 0;

  for (const resident of rows) {
    const { resident_id, email, first_name, last_name, valid_id_path } = resident;
    const absPath = path.join(__dirname, valid_id_path.replace(/^\//, ''));

    process.stdout.write(`  [${resident_id}] ${last_name}, ${first_name} (${email}) — `);

    if (!fs.existsSync(absPath)) {
      // File is gone — mark for re-upload
      await pool.query(
        `UPDATE residents SET valid_id_path = 'missing:re-upload-required' WHERE resident_id = $1`,
        [resident_id]
      );
      console.log('⚠️  File missing — marked for re-upload');
      missing++;
      continue;
    }

    // File exists — upload to Supabase Storage
    try {
      const fileBuffer = fs.readFileSync(absPath);
      const ext = path.extname(absPath).toLowerCase();
      const mimeTypes = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.webp':'image/webp', '.pdf':'application/pdf' };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const fileName = `migrated-${resident_id}-${Date.now()}${ext}`;

      const { error } = await supabase.storage
        .from('valid-ids')
        .upload(fileName, fileBuffer, { contentType, upsert: false });

      if (error) throw error;

      const newPath = `supabase:valid-ids/${fileName}`;
      await pool.query(
        `UPDATE residents SET valid_id_path = $1 WHERE resident_id = $2`,
        [newPath, resident_id]
      );
      console.log(`✅ Uploaded → ${fileName}`);
      uploaded++;
    } catch (err) {
      console.log(`❌ Upload failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Migration complete:`);
  console.log(`   ✅ Uploaded to Supabase: ${uploaded}`);
  console.log(`   ⚠️  Missing (marked for re-upload): ${missing}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`\nResidents marked "missing" will see a re-upload prompt when staff views their record.`);

  await pool.end();
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
