import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { q } from '../db.js';
import { sign, auth, allow } from '../auth.js';
import { h, HttpError, need } from '../http.js';

const r = Router();
r.post('/login', rateLimit({ windowMs: 60_000, limit: 20 }), h(async (req, res) => {
  need(req.body, ['email', 'password']);
  const [u] = await q('SELECT * FROM users WHERE email=lower($1)', [req.body.email]);
  if (!u || !(await bcrypt.compare(req.body.password, u.password_hash))) throw new HttpError(401, 'Wrong email or password');
  res.json({ token: sign(u), user: { id: u.id, name: u.name, role: u.role, department: u.department } });
}));
r.get('/me', auth, (req, res) => res.json(req.user));
r.get('/users', auth, allow('admin', 'manager'), h(async (_req, res) =>
  res.json(await q('SELECT id,name,email,role,department FROM users ORDER BY name'))));
export default r;
