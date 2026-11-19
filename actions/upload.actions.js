const path = require('path');
const fs = require('fs');
const supabase = require('../supabase');

// Accepted government-issued IDs (keep in sync with views/resident_register.html
// and views/request_document.html)
const VALID_ID_TYPES = [
  'PhilSys National ID',
  'Passport',
  "Driver's License",
  'UMID',
  'SSS ID',
  'GSIS ID',
  'PRC ID',
  'Postal ID',
  "Voter's ID",
  'PhilHealth ID',
  'TIN ID',
  'Senior Citizen ID',
  'PWD ID',
];
const ALLOWED_UPLOAD_MIME = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' };

/**
 * Upload a file to the `valid-ids` bucket. Returns "supabase:valid-ids/<name>" or null on failure.
 * @param {object} file   multer file (memory storage)
 * @param {string} folder optional sub-folder, e.g. "requests"
 * @param {string} label  used in the file name (email, resident id…)
 */
async function uploadToStorage(file, folder, label) {
  const ext = file.originalname.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const fileName = `${folder ? folder + '/' : ''}${Date.now()}-${String(label).replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
  const { error } = await supabase.storage
    .from('valid-ids')
    .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) {
    console.error('Supabase Storage upload error:', error);
    return null;
  }
  return `supabase:valid-ids/${fileName}`;
}

/** Best-effort removal of a stored file (ignores legacy/local paths). */
async function removeFromStorage(storedPath) {
  if (!storedPath || !storedPath.startsWith('supabase:')) return;
  const [bucket, ...parts] = storedPath.replace('supabase:', '').split('/');
  const { error } = await supabase.storage.from(bucket).remove([parts.join('/')]);
  if (error) console.error('Supabase Storage remove error:', error);
}

/**
 * Stream a stored file (Supabase "supabase:bucket/name" or legacy local "/uploads/…") to the response.
 * Returns false when the file could not be found (nothing has been sent yet).
 */
async function sendStoredFile(res, storedPath, { cache = false } = {}) {
  if (!storedPath || storedPath.startsWith('missing:')) return false;

  if (storedPath.startsWith('supabase:')) {
    const [bucket, ...parts] = storedPath.replace('supabase:', '').split('/');
    const fileName = parts.join('/');
    const { data, error } = await supabase.storage.from(bucket).download(fileName);
    if (error || !data) {
      console.error('Supabase Storage download error:', error);
      return false;
    }
    res.setHeader('Content-Type', MIME_BY_EXT[path.extname(fileName).toLowerCase()] || data.type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(fileName)}"`);
    if (!cache) res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(await data.arrayBuffer()));
    return true;
  }

  const absolutePath = path.join(__dirname, '..', storedPath.replace(/^\//, ''));
  if (!fs.existsSync(absolutePath)) return false;
  res.setHeader('Content-Type', MIME_BY_EXT[path.extname(absolutePath).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(absolutePath)}"`);
  fs.createReadStream(absolutePath).pipe(res);
  return true;
}

const FILE_NOT_FOUND_PAGE = `<!DOCTYPE html><html><head><title>File Not Found</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f0f1;}
  .box{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);}
  h2{color:#8b2131;margin:0 0 8px;}p{color:#666;margin:0;}</style></head>
  <body><div class="box"><h2>Valid ID Not Found</h2><p>No valid ID file was found for this request.</p></div></body></html>`;

module.exports = {
  VALID_ID_TYPES,
  ALLOWED_UPLOAD_MIME,
  uploadToStorage,
  removeFromStorage,
  sendStoredFile,
  FILE_NOT_FOUND_PAGE,
};
