// Signed QR labels + the public "Asset Passport" page a phone shows after scanning.
// Security notes: the signature key is derived from JWT_SECRET (never the raw secret), compared in constant time,
// an invalid/unknown label reveals nothing, and every value is HTML-escaped.
import crypto from 'node:crypto';
import os from 'node:os';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { q, getSettings, metrics } from './db.js';
import { analyse } from './engine.js';

const PORT = process.env.PORT || 4000;
const key = crypto.createHmac('sha256', process.env.JWT_SECRET).update('assetiq-qr-label-v1').digest();
export const sign = tag => crypto.createHmac('sha256', key).update(tag).digest('hex').slice(0, 32);
const validSig = (tag, s) => { const a = Buffer.from(sign(tag)), b = Buffer.from(String(s || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };

const lan = () => { for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === 'IPv4' && !i.internal) return i.address; return 'localhost'; };
export const PUBLIC = (process.env.PUBLIC_URL || `http://${lan()}:${PORT}`).replace(/\/+$/, '');
export const passportUrl = tag => `${PUBLIC}/passport/${tag}?s=${sign(tag)}`;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { Retain: '#16a34a', Repair: '#d97706', Reassign: '#2563eb', Reuse: '#7c3aed', Replace: '#dc2626', Retired: '#64748b' };
const page = body => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AssetIQ passport</title>
<body style="font:15px system-ui,sans-serif;margin:0;background:#f4f6fb;color:#1b2030"><div style="max-width:480px;margin:auto;padding:16px">${body}</div></body></html>`;

const router = Router();
router.get('/passport/:tag', rateLimit({ windowMs: 60_000, limit: 60 }), async (req, res) => {
  const tag = String(req.params.tag).toUpperCase();
  res.set('Cache-Control', 'no-store');
  if (!validSig(tag, req.query.s))
    return res.status(403).send(page(`<div style="padding:14px;border-radius:10px;color:#fff;background:#dc2626"><b>✘ Label not recognised</b><br>This QR code is not a genuine AssetIQ label (the signature is missing or wrong). Do not trust it, and tell IT.</div>`));
  const [m] = await metrics('WHERE tag=$1', [tag]);
  if (!m) return res.status(404).send(page('<p>Asset not found.</p>'));
  const a = analyse(m, await getSettings());
  const [chain] = await q('SELECT * FROM verify_chain($1)', [m.id]);
  const events = await q('SELECT event_type, detail, occurred_at FROM lifecycle_events WHERE asset_id=$1 ORDER BY id DESC LIMIT 5', [m.id]);
  const warranty = !m.warranty_until ? 'Unknown' : a.warranty_active ? `In warranty until ${m.warranty_until}` : `Expired ${m.warranty_until}`;
  const row = (k, v) => `<tr><td style="padding:5px 0">${esc(k)}</td><td style="text-align:right"><b>${esc(v)}</b></td></tr>`;
  res.send(page(`
<div style="padding:10px;border-radius:10px;color:#fff;background:#16a34a">✔ Authentic AssetIQ label</div>
<h2 style="margin:14px 0 2px">${esc(a.name)}</h2><div style="color:#667085">${esc(a.tag)} · ${esc(a.category)} · SN ${esc(a.serial_no)}</div>
<div style="margin:12px 0;padding:14px;border-radius:12px;color:#fff;background:${COLORS[a.rec] || '#64748b'}"><small>DECISION</small><div style="font-size:24px;font-weight:700">${esc(a.rec.toUpperCase())}</div></div>
<table style="width:100%;background:#fff;border-radius:12px;padding:8px 14px">
${row('Health score', a.health + '/100')}${row('Remaining useful life', a.rul_months + ' months')}${row('Status', a.status)}${row('Condition', a.condition)}
${row('Age', a.years + ' years')}${row('Warranty', warranty)}${row('Services done', a.maint_count)}
${row('History integrity', chain.valid ? 'Verified' : 'TAMPERED')}</table>
<h3>Recent history</h3>${events.map(e => `<div style="font-size:13px;margin:4px 0"><b>${esc(e.event_type)}</b> ${esc(e.detail)} <span style="color:#667085">${esc(String(e.occurred_at.toISOString?.() ?? e.occurred_at).slice(0, 10))}</span></div>`).join('')}
<p style="margin-top:18px"><a href="/a/${esc(a.tag)}" style="color:#4f46e5">Staff: open the full record and report a problem →</a></p>`));
});
export default router;
