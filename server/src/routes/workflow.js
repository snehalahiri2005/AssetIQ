import { Router } from 'express';
import { q, tx, logEvent, getSettings, metrics } from '../db.js';
import { allow } from '../auth.js';
import { h, HttpError, need } from '../http.js';
import { bestMatches } from '../engine.js';
import { assignAsset, addMaintenance } from '../services.js';

export const requests = Router(), issues = Router(), settings = Router();
const staff = allow('admin', 'manager'), admin = allow('admin');

// ---------------------------------------------------------------- equipment requests + purchase avoidance
const REQ_SQL = `SELECT r.*, u.name AS requester, c.name AS category, c.avg_cost
                 FROM asset_requests r JOIN users u ON u.id=r.requester_id JOIN categories c ON c.id=r.category_id`;

requests.get('/', h(async (req, res) => {
  const mine = req.user.role === 'employee';
  const rows = await q(`${REQ_SQL} ${mine ? 'WHERE r.requester_id=$1' : ''} ORDER BY r.status='open' DESC, r.id DESC`, mine ? [req.user.id] : []);
  if (mine) return res.json(rows);
  const s = await getSettings(), stock = await metrics();
  res.json(rows.map(r => ({ ...r, matches: r.status === 'open' ? bestMatches(stock, s, r.category_id) : [] })));
}));

requests.post('/', allow('employee'), h(async (req, res) => {
  need(req.body, ['category_id']);
  const [row] = await q('INSERT INTO asset_requests(requester_id,category_id,justification) VALUES($1,$2,$3) RETURNING *',
    [req.user.id, req.body.category_id, req.body.justification || null]);
  res.status(201).json(row);
}));

// Serve the request from idle stock (picks the best match unless asset_id is given): books a purchase-avoided saving
requests.post('/:id/fulfil', admin, h(async (req, res) => {
  const [rq] = await q(`${REQ_SQL} WHERE r.id=$1`, [req.params.id]);
  if (!rq || rq.status !== 'open') throw new HttpError(404, 'Open request not found');
  const pick = req.body.asset_id || bestMatches(await metrics(), await getSettings(), rq.category_id)[0]?.id;
  if (!pick) throw new HttpError(409, 'No suitable idle asset in stock. Mark it as needs-purchase instead.');
  await tx(async c => {
    await assignAsset(c, pick, rq.requester_id, req.user.id, ' (fulfilled from idle stock)');
    const { rows: [cat] } = await c.query('SELECT avg_cost, co2_kg FROM categories WHERE id=$1', [rq.category_id]);
    await c.query('INSERT INTO savings_ledger(asset_id,kind,amount,co2_kg,created_by) VALUES($1,$2,$3,$4,$5)',
      [pick, 'purchase_avoided', cat.avg_cost, cat.co2_kg, req.user.id]);
    await c.query("UPDATE asset_requests SET status='fulfilled_from_stock', fulfilled_asset_id=$2, closed_at=now() WHERE id=$1", [rq.id, pick]);
    await logEvent(c, pick, 'Reused', `Purchase avoided: saved Rs ${cat.avg_cost}`, req.user.id);
  });
  res.json({ ok: true, asset_id: pick });
}));

requests.post('/:id/purchase', admin, h(async (req, res) => {
  await q("UPDATE asset_requests SET status='needs_purchase', closed_at=now() WHERE id=$1 AND status='open'", [req.params.id]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- issue reports (raised after scanning a QR label)
issues.get('/', h(async (req, res) => {
  const mine = req.user.role === 'employee';
  res.json(await q(`SELECT i.*, a.tag, a.name AS asset, u.name AS reporter FROM issue_reports i
                    JOIN assets a ON a.id=i.asset_id JOIN users u ON u.id=i.reported_by
                    ${mine ? 'WHERE i.reported_by=$1' : ''} ORDER BY i.status='open' DESC, i.id DESC`, mine ? [req.user.id] : []));
}));

issues.post('/', h(async (req, res) => {
  need(req.body, ['asset_id', 'description']);
  await tx(async c => {
    const { rows: [a] } = await c.query('SELECT id, assigned_to FROM assets WHERE id=$1', [req.body.asset_id]);
    if (!a) throw new HttpError(404, 'Asset not found');
    if (req.user.role === 'employee' && a.assigned_to !== req.user.id) throw new HttpError(403, 'You can only report on your own assets');
    await c.query('INSERT INTO issue_reports(asset_id,reported_by,description) VALUES($1,$2,$3)', [a.id, req.user.id, req.body.description]);
    await logEvent(c, a.id, 'Issue reported', req.body.description, req.user.id);
  });
  res.status(201).json({ ok: true });
}));

// Resolve; optionally log the repair (cost + resulting condition) in the same step
issues.post('/:id/resolve', admin, h(async (req, res) => {
  await tx(async c => {
    const { rows: [i] } = await c.query("UPDATE issue_reports SET status='resolved', resolved_at=now() WHERE id=$1 AND status='open' RETURNING *", [req.params.id]);
    if (!i) throw new HttpError(404, 'Open issue not found');
    if (req.body.condition) await addMaintenance(c, i.asset_id, { description: req.body.description || 'Issue repair', cost: +req.body.cost || 0, condition: req.body.condition }, req.user.id);
    await logEvent(c, i.asset_id, 'Issue resolved', req.body.description || i.description, req.user.id);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- thresholds
settings.get('/', staff, h(async (_req, res) => res.json(await q('SELECT * FROM settings ORDER BY key'))));
settings.put('/', admin, h(async (req, res) => {
  await tx(async c => {
    for (const [k, v] of Object.entries(req.body)) {
      if (isNaN(+v) || +v < 0) throw new HttpError(400, `Invalid value for ${k}`);
      const r = await c.query('UPDATE settings SET value=$2 WHERE key=$1', [k, +v]);
      if (!r.rowCount) throw new HttpError(400, `Unknown setting ${k}`);
    }
  });
  res.json({ ok: true });
}));
