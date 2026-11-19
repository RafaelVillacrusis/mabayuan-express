function noCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

function requireResident(req, res, next) {
  noCache(res);
  if (!req.session.resident) return res.redirect('/login');
  next();
}

function requireUser(req, res, next) {
  noCache(res);
  if (!req.session.user) return res.redirect('/login');
  next();
}

// Current role of each personnel account, re-read from the database at most every 30s,
// so role changes and deleted accounts take effect without waiting for the person to log out.
const ROLE_TTL_MS = 30 * 1000;
const roleCache = new Map(); // user_id → { role, at } (role null = account deleted)

async function currentRole(userId) {
  const hit = roleCache.get(userId);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.role;
  const pool = require('../db');
  const { rows } = await pool.query('SELECT role FROM users WHERE user_id = $1 LIMIT 1', [userId]);
  const role = rows[0] ? rows[0].role : null;
  roleCache.set(userId, { role, at: Date.now() });
  return role;
}

/** Call after changing or deleting an account so the change applies on the next request. */
function forgetUserRole(userId) {
  roleCache.delete(Number(userId));
}

function requireRole(...roles) {
  return async (req, res, next) => {
    noCache(res);
    if (!req.session.user) return res.redirect('/login');
    try {
      const role = await currentRole(Number(req.session.user.user_id));
      if (!role) {                                   // account was deleted
        return req.session.destroy(() => res.redirect('/login'));
      }
      if (role !== req.session.user.role) req.session.user.role = role;
    } catch (err) {
      console.error('Role check failed, using session role:', err.message);
    }
    if (!roles.includes(req.session.user.role)) {
      // Moved to another role — send pages to that role's home instead of a bare "Forbidden"
      const home = { staff: '/staff/dashboard', captain: '/captain/dashboard', system_admin: '/system-admin/dashboard' }[req.session.user.role];
      if (home && req.method === 'GET' && !req.path.startsWith('/api/')) return res.redirect(home);
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

module.exports = { noCache, requireResident, requireUser, requireRole, forgetUserRole };
