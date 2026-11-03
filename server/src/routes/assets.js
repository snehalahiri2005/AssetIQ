import { Router } from 'express';
import { pool, q, tx, logEvent, getSettings, metrics } from '../db.js';
import { allow } from '../auth.js';
import { h, HttpError, need } from '../http.js';
import { analyse, tco } from '../engine.js';
import { passportUrl } from '../passport.js';
import { assignAsset, returnAsset, retireAsset, addMaintenance } from '../services.js';

const r = Router(), staff = allow('admin', 'manager'), admin = allow('admin');
const refWhere = ref => /^\d+$/.test(ref) ? ['WHERE id=$1', +ref] : ['WHERE tag=$1', ref.toUpperCase()];

async function load(req) {
  const [w, v] = refWhere(req.params.ref);
  const [m] = await metrics(w, [v]);
  if (!m) throw new HttpError(404, 'Asset not found');
  if (req.user.role === 'employee' && m.assigned_to !== req.user.id) throw new HttpError(403, 'This asset is not assigned to you');
  return m;
}

r.get('/', h(async (req, res) => {
  const s = await getSettings();
  const rows = req.user.role === 'employee' ? await metrics('WHERE assigned_to=$1', [req.user.id]) : await metrics();
  res.json(rows.map(m => ({ ...analyse(m, s), passport_url: passportUrl(m.tag) })));
}));

// Full record: metrics, explanation, break-even model, history and chain-of-custody check
r.get('/:ref', h(async (req, res) => {
  const m = await load(req), s = await getSettings(), a = analyse(m, s);
  const [events, maintenance, [chain]] = await Promise.all([
    q('SELECT e.*, u.name AS actor FROM lifecycle_events e LEFT JOIN users u ON u.id=e.actor_id WHERE asset_id=$1 ORDER BY e.id', [a.id]),
    q('SELECT * FROM maintenance_records WHERE asset_id=$1 ORDER BY performed_on DESC', [a.id]),
    q('SELECT * FROM verify_chain($1)', [a.id]),
  ]);
  res.json({ ...a, passport_url: passportUrl(a.tag), tco: a.status === 'retired' ? null : tco(a, s), events, maintenance, chain });
}));

r.post('/', admin, h(async (req, res) => {
  need(req.body, ['name', 'category_id', 'serial_no', 'purchase_date']);
  const b = req.body;
  const asset = await tx(async c => {
    const { rows: [cat] } = await c.query('SELECT avg_cost FROM categories WHERE id=$1', [b.category_id]);
    if (!cat) throw new HttpError(400, 'Unknown category');
    const { rows: [a] } = await c.query(
      `INSERT INTO assets(name,category_id,serial_no,purchase_date,purchase_cost,warranty_until,condition)
       VALUES($1,$2,$3,$4,$5,$6,'new') RETURNING *`,
      [b.name, b.category_id, b.serial_no, b.purchase_date, b.purchase_cost || cat.avg_cost, b.warranty_until || null]);
    await logEvent(c, a.id, 'Registered', b.name, req.user.id);
    return a;
  });
  res.status(201).json(asset);
}));

// Bulk import: name, category, serial, cost, bought, condition, assigned_to (name | IDLE | blank), maintenance_cost, service_count
r.post('/import', admin, h(async (req, res) => {
  const rows = (req.body.rows || []).filter(x => x.name);
  if (!rows.length) throw new HttpError(400, 'No rows to import');
  const cats = Object.fromEntries((await q('SELECT id,name,avg_cost FROM categories')).map(c => [c.name.toLowerCase(), c]));
  const users = Object.fromEntries((await q('SELECT id,name FROM users')).map(u => [u.name.toLowerCase(), u.id]));
  const warnings = [], iso = d => `${d}T09:00:00Z`, today = new Date().toISOString().slice(0, 10);
  const n = await tx(async c => {
    for (const [i, x] of rows.entries()) {
      const cat = cats[(x.category || 'other').toLowerCase()] || cats.other;
      const cond = ['new', 'good', 'fair', 'poor'].includes(x.condition) ? x.condition : 'good';
      const bought = /^\d{4}-\d{2}-\d{2}$/.test(x.bought || '') && x.bought <= today ? x.bought : today;
      const { rows: [a] } = await c.query(
        `INSERT INTO assets(name,category_id,serial_no,purchase_date,purchase_cost,condition)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [x.name, cat.id, x.serial || `SN-${Date.now().toString(36)}-${i}`, bought, +x.cost || cat.avg_cost, cond]);
      await logEvent(c, a.id, 'Registered', `${x.name} (bulk import)`, req.user.id, iso(bought));
      const mc = +x.maintenance_cost || 0, services = +x.service_count || (mc ? 1 : 0);
      for (let k = 1; k <= services; k++) {
        const d = new Date(+new Date(bought) + (Date.now() - +new Date(bought)) * k / (services + 1)).toISOString().slice(0, 10);
        await c.query('INSERT INTO maintenance_records(asset_id,performed_on,description,cost,condition_after,downtime_days) VALUES($1,$2,$3,$4,$5,1.5)',
          [a.id, d, 'Past service (import)', Math.round(mc / services), cond]);
        await logEvent(c, a.id, 'Maintenance', `Past service (Rs ${Math.round(mc / services)})`, req.user.id, iso(d));
      }
      const who = (x.assigned_to || '').trim(), idle = /^idle$/i.test(who);
      if (who && !idle) {
        const uid = users[who.toLowerCase()];
        if (uid) { await c.query('INSERT INTO assignments(asset_id,user_id,assigned_at) VALUES($1,$2,$3)', [a.id, uid, iso(bought)]); await logEvent(c, a.id, 'Assigned', `To ${who}`, req.user.id, iso(bought)); }
        else warnings.push(`${x.name}: no user named "${who}", left unassigned`);
      }
      if (!who || idle) await c.query(`UPDATE assets SET last_returned_at = greatest(purchase_date::timestamptz, now() - make_interval(days => $2)) WHERE id=$1`, [a.id, idle ? 100 : 10]);
    }
    return rows.length;
  });
  res.status(201).json({ imported: n, warnings });
}));

const op = fn => h(async (req, res) => {
  const [w, v] = refWhere(req.params.ref);
  const { rows: [a] } = await pool.query('SELECT id FROM assets ' + w, [v]);
  if (!a) throw new HttpError(404, 'Asset not found');
  await tx(c => fn(c, a.id, req));
  res.json({ ok: true });
});
r.post('/:ref/assign', admin, op((c, id, req) => { need(req.body, ['user_id']); return assignAsset(c, id, req.body.user_id, req.user.id); }));
r.post('/:ref/return', admin, op((c, id, req) => returnAsset(c, id, req.user.id)));
r.post('/:ref/retire', admin, op((c, id, req) => retireAsset(c, id, req.user.id)));
r.post('/:ref/maintenance', admin, op((c, id, req) => {
  need(req.body, ['description', 'condition']);
  return addMaintenance(c, id, req.body, req.user.id);
}));

// Accept the engine's recommendation: books the saving in the ledger (and retires the asset on Replace)
r.post('/:ref/accept', admin, h(async (req, res) => {
  const m = await load(req), a = analyse(m, await getSettings());
  if (!a.kind || !a.saving) throw new HttpError(400, `Nothing to accept: recommendation is ${a.rec}`);
  await tx(async c => {
    const dup = await c.query("SELECT 1 FROM savings_ledger WHERE asset_id=$1 AND kind=$2 AND created_at > now() - interval '30 days'", [a.id, a.kind]);
    if (dup.rowCount) throw new HttpError(409, 'This recommendation was already accepted recently');
    await c.query('INSERT INTO savings_ledger(asset_id,kind,amount,co2_kg,created_by) VALUES($1,$2,$3,$4,$5)',
      [a.id, a.kind, a.saving, a.rec === 'Reuse' ? a.co2_kg : 0, req.user.id]);
    await logEvent(c, a.id, 'Decision accepted', `${a.rec}: est. saving Rs ${a.saving}`, req.user.id);
    if (a.rec === 'Replace') await retireAsset(c, a.id, req.user.id, 'Replaced (recommendation accepted)');
  });
  res.json({ ok: true, rec: a.rec, saving: a.saving });
}));

export default r;
