import { Router } from 'express';
import { q, getSettings, metrics } from '../db.js';
import { h } from '../http.js';
import { analyse, forecast, healthBands, summarise } from '../engine.js';

const r = Router();

r.get('/dashboard', h(async (_req, res) => {
  const s = await getSettings(), all = (await metrics()).map(m => analyse(m, s));
  const live = all.filter(a => a.status !== 'retired'), sum = f => live.reduce((t, a) => t + f(a), 0);
  const [ledger] = await q('SELECT coalesce(sum(amount),0) AS realised, coalesce(sum(co2_kg),0) AS co2, count(*) AS n FROM savings_ledger');
  const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10), now = new Date().toISOString().slice(0, 10);
  const byCat = {};
  live.forEach(a => byCat[a.category] = (byCat[a.category] || 0) + a.lifecycle_cost);
  res.json({
    kpis: {
      in_service: live.length, lifecycle_cost: sum(a => a.lifecycle_cost), maintenance: sum(a => a.maint_cost),
      idle: live.filter(a => a.rec === 'Reuse').length, estimated_saving: sum(a => a.saving),
      fleet_health: live.length ? Math.round(sum(a => a.health) / live.length) : 100,
      co2_potential: sum(a => ['Reuse', 'Repair', 'Reassign'].includes(a.rec) ? a.co2_kg : 0),
      realised_saving: ledger.realised, co2_avoided: ledger.co2, decisions_accepted: ledger.n,
    },
    counts: summarise(live).counts,
    bands: healthBands(live),
    recommendations: live.filter(a => a.rec !== 'Retain').sort((a, b) => b.saving - a.saving),
    costs: live.map(a => ({ tag: a.tag, name: a.name, purchase: a.purchase_cost, maintenance: a.maint_cost })),
    by_category: Object.entries(byCat).map(([category, cost]) => ({ category, cost })),
    warranty_alerts: live.filter(a => a.warranty_until && a.warranty_until >= now && a.warranty_until <= soon)
      .map(a => ({ tag: a.tag, name: a.name, warranty_until: a.warranty_until, rec: a.rec })),
  });
}));

r.get('/forecast', h(async (_req, res) => res.json(forecast(await metrics(), await getSettings()))));

// What-if simulator: re-run the engine with overridden thresholds, without saving anything
r.get('/whatif', h(async (req, res) => {
  const base = await getSettings(), rows = (await metrics()).filter(m => m.status !== 'retired');
  const over = { ...base };
  for (const k of Object.keys(base)) if (req.query[k] !== undefined && !isNaN(+req.query[k])) over[k] = +req.query[k];
  const cur = rows.map(m => analyse(m, base)), sim = rows.map(m => analyse(m, over));
  res.json({
    current: summarise(cur), scenario: summarise(sim),
    changed: sim.map((a, i) => ({ tag: a.tag, name: a.name, from: cur[i].rec, to: a.rec })).filter(x => x.from !== x.to),
  });
}));

export default r;
