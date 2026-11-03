import { rupee } from './api.js';

export const Tag = ({ rec }) => <span className={'tag ' + rec}>{rec}</span>;
export const Kpi = ({ label, value, good }) => <div className={'k' + (good ? ' sv' : '')}><small>{label}</small><b>{value}</b></div>;
export const Status = ({ s }) => <span className={'st st-' + s}>{s}</span>;
export const Loading = ({ state }) => state.loading ? <p className="mu">Loading…</p> : state.error ? <p className="err">{state.error}</p> : null;

/** Cumulative cost of keeping vs replacing an asset (36 months), drawn as SVG. */
export function TcoChart({ tco }) {
  const W = 560, H = 170, P = 36, max = Math.max(...tco.series.flatMap(p => [p.keep, p.replace]), 1);
  const x = m => P + (m / 36) * (W - P - 8), y = v => H - 22 - (v / max) * (H - 36);
  const line = key => tco.series.map((p, i) => `${i ? 'L' : 'M'}${x(p.month)},${y(p[key])}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Keep versus replace cumulative cost">
      {[0, 12, 24, 36].map(m => <text key={m} x={x(m)} y={H - 6} fontSize="10" textAnchor="middle" fill="currentColor">{m}m</text>)}
      <text x="2" y="12" fontSize="10" fill="currentColor">{rupee(max)}</text>
      <path d={line('replace')} fill="none" stroke="#2563eb" strokeWidth="2" />
      <path d={line('keep')} fill="none" stroke="#dc2626" strokeWidth="2" />
      {tco.breakeven && <g><line x1={x(tco.breakeven)} x2={x(tco.breakeven)} y1="10" y2={H - 22} stroke="#16a34a" strokeDasharray="4" />
        <text x={x(tco.breakeven) + 4} y="22" fontSize="11" fill="#16a34a">break-even {tco.breakeven}m</text></g>}
      <text x={W - 150} y="14" fontSize="11" fill="#dc2626">— keep (repairs + downtime)</text>
      <text x={W - 150} y="28" fontSize="11" fill="#2563eb">— replace with new</text>
    </svg>
  );
}

export const RiskBars = ({ a }) => (
  <>
    <h3>How the risk score ({a.risk}/100) was worked out</h3>
    {[['Age', a.breakdown.age, 30], ['Condition', a.breakdown.cond, 25], ['Repair cost vs price', a.breakdown.cost, 25], ['Repair frequency', a.breakdown.freq, 20]].map(([l, v, m]) => (
      <div className="row2" key={l}><span>{l}</span><div className="bar"><i style={{ width: v / m * 100 + '%', background: 'var(--wa)' }} /></div><span>{v}/{m}</span></div>
    ))}
  </>
);
