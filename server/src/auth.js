import jwt from 'jsonwebtoken';

export const sign = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '8h' });

export function auth(req, res, next) {
  try { req.user = jwt.verify((req.headers.authorization || '').slice(7), process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please sign in' }); }
}
export const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not permitted for your role' });
