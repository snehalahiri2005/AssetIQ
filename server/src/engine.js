// Decision-support engine (Logical layer). Pure functions: no DB access, easy to unit-test.
const COND = { new: 0, good: 5, fair: 15, poor: 25 };
export const rupee = n => '₹' + Math.round(n).toLocaleString('en-IN');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const HCOND = { new: 0, good: 3, fair: 12, poor: 25 };
const today = () => new Date().toISOString().slice(0, 10);

/** Score one asset row from v_asset_metrics and recommend an action, with a full explanation. */
export function analyse(m, s) {
  const years = m.age_days / 365, life = m.lifespan_years;
  const util = Math.min(100, Math.round(m.assigned_days_90 / Math.min(90, m.age_days) * 100));
  const ratio = m.maint_cost / m.purchase_cost;
  const breakdown = {
    age:  Math.round(Math.min(years / life, 1) * 30),
    cond: COND[m.condition],
    cost: Math.round(Math.min(ratio / 0.5, 1) * 25),
    freq: Math.round(Math.min(m.maint_count / 6, 1) * 20),
  };
  const risk = breakdown.age + breakdown.cond + breakdown.cost + breakdown.freq;
  // Health (0-100) and Remaining Useful Life in months: age vs expected life, condition, repair burden, repair frequency
  const health = Math.round(clamp(100 - Math.min(years / life, 1.5) * 40 - HCOND[m.condition]
    - Math.min(ratio / 0.6, 1) * 20 - Math.min(m.maint_count / 8, 1) * 15, 0, 100));
  const rul_months = Math.round(Math.max(0, life - years) * 12 * health / 100);
  const warranty_active = !!m.warranty_until && m.warranty_until >= today();

  let rec = 'Retain', saving = 0, kind = null, why = 'Healthy and in productive use.';
  if (m.status === 'retired') { rec = 'Retired'; why = 'Removed from service.'; }
  else if (risk >= s.risk_replace || health < 25) {
    rec = 'Replace'; kind = 'upkeep_stopped'; saving = Math.round(m.maint_cost / Math.max(years, 1));
    why = `Risk ${risk}/100, health ${health}/100, and repairs already cost ${Math.round(ratio * 100)}% of the purchase price. Replacing stops about ${rupee(saving)}/yr of upkeep.`;
  } else if (m.condition === 'poor') {
    rec = 'Repair'; kind = 'repair_vs_new'; saving = Math.round(m.purchase_cost * (1 - s.repair_pct / 100));
    why = warranty_active ? 'Poor condition but still under warranty: repair at no cost.'
                          : `Repair (about ${s.repair_pct}% of price) is cheaper than buying new.`;
  } else if (m.idle_days >= s.idle_days && health >= 45) {
    rec = 'Reuse'; kind = 'purchase_avoided'; saving = m.category_avg_cost;
    why = `Idle for ${m.idle_days} days and still healthy (${health}/100): reissue it instead of buying new equipment.`;
  } else if (m.status === 'assigned' && util < s.util_min) {
    rec = 'Reassign'; kind = 'idle_cost_recovered'; saving = Math.round(m.category_avg_cost / life * (1 - util / 100));
    why = `Only ${util}% utilised over the last 90 days: move it to a heavier user.`;
  }
  return {
    ...m, years: +years.toFixed(1), util, risk, health, rul_months, breakdown, rec, kind, saving, why, warranty_active,
    lifecycle_cost: m.purchase_cost + m.maint_cost,
    book_value: Math.round(m.purchase_cost * Math.max(0.1, 1 - years / life)),
  };
}

/**
 * Repair-or-Replace horizon. Compares 36 months of cumulative cost for keeping the asset
 * (probability-weighted repairs + days of downtime, escalating 2%/month) against buying a new one
 * (price - salvage + low upkeep). Returns the break-even month, or null if keeping stays cheaper.
 */
export function tco(a, s, horizon = 36) {
  const yrs = Math.max(a.years, 0.5);
  const failuresPerYear = 0.3 + (a.risk / 100) * 2.5;
  const avgRepair = Math.max(a.maint_count ? a.maint_cost / a.maint_count : 0, a.purchase_cost * 0.1);
  const downtimeDays = Math.max((a.downtime_days || 0) / yrs, failuresPerYear * 1.5);   // observed, or expected from failure rate
  const keepMonthly = (failuresPerYear * avgRepair + downtimeDays * s.downtime_cost) / 12;
  const upfront = a.category_avg_cost - Math.round(a.book_value * 0.5);
  const newMonthly = a.category_avg_cost * 0.02 / 12;
  let keep = 0, series = [], breakeven = null;
  for (let t = 0; t <= horizon; t++) {
    if (t) keep += keepMonthly * Math.pow(1.02, t);
    const replace = upfront + newMonthly * t;
    series.push({ month: t, keep: Math.round(keep), replace: Math.round(replace) });
    if (breakeven === null && t > 0 && keep >= replace) breakeven = t;
  }
  return {
    series, breakeven, keepMonthly: Math.round(keepMonthly), upfront,
    verdict: breakeven ? `Replacing pays for itself in about ${breakeven} months.`
                       : `Keeping is cheaper for the next ${horizon} months.`,
  };
}

/** 12-month refresh budget: when each asset reaches end of life (pulled earlier by risk), net of idle stock. */
export function forecast(rows, s) {
  const now = Date.now(), live = rows.filter(r => r.status !== 'retired').map(r => analyse(r, s));
  const quarters = ['Next 3 months', '3–6 months', '6–9 months', '9–12 months']
    .map(label => ({ label, count: 0, gross: 0 }));
  const byCat = {};
  for (const a of live) {
    const lifeMonths = a.lifespan_years * 12, eolMonths = lifeMonths - (a.risk / 100) * lifeMonths * 0.5;
    const ahead = eolMonths - (now - new Date(a.purchase_date)) / (30.44 * 864e5);
    if (ahead > 12) continue;
    const q = Math.min(3, Math.max(0, Math.floor(ahead / 3)));
    quarters[q].count++; quarters[q].gross += a.category_avg_cost;
    (byCat[a.category] ??= { category: a.category, need: 0, stock: 0, unit: a.category_avg_cost }).need++;
  }
  for (const a of live) if (a.status === 'available' && a.risk < 60 && byCat[a.category]) byCat[a.category].stock++;
  const categories = Object.values(byCat).map(c => {
    const net = Math.max(0, c.need - c.stock);
    return { ...c, net, gross_budget: c.need * c.unit, net_budget: net * c.unit };
  });
  return {
    quarters,
    categories,
    gross: categories.reduce((t, c) => t + c.gross_budget, 0),
    net: categories.reduce((t, c) => t + c.net_budget, 0),
  };
}

/** Purchase-Avoidance: best idle asset in a category for a new request (lowest risk, then longest idle). */
export function bestMatches(rows, s, categoryId) {
  return rows.filter(r => r.category_id === categoryId && r.status === 'available')
    .map(r => analyse(r, s)).filter(a => a.rec !== 'Replace' && a.risk < 60)
    .sort((a, b) => a.risk - b.risk || b.idle_days - a.idle_days).slice(0, 3);
}

export const summarise = list => {
  const counts = {};
  list.forEach(a => counts[a.rec] = (counts[a.rec] || 0) + 1);
  return { counts, saving: list.reduce((t, a) => t + a.saving, 0) };
};

export const healthBands = list => [['Critical 0–24', 0, 25], ['Weak 25–59', 25, 60], ['Good 60–79', 60, 80], ['Excellent 80–100', 80, 101]]
  .map(([label, lo, hi]) => ({ label, count: list.filter(a => a.health >= lo && a.health < hi).length }));
