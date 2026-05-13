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

function requireRole(...roles) {
  return (req, res, next) => {
    noCache(res);
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) return res.status(403).send('Forbidden');
    next();
  };
}

module.exports = { noCache, requireResident, requireUser, requireRole };
