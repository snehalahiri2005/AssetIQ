import { useEffect, useState } from 'react';
import { api, rupee } from '../api.js';
import { toast, useApi } from '../hooks.js';
import { Kpi, Loading } from '../ui.jsx';

export function Forecast() {
  const st = useApi('/insights/forecast'), f = st.data;
  if (!f) return <Loading state={st} />;
  const max = Math.max(...f.quarters.map(q => q.gross), 1);
  return (
    <>
      <div className="grid"><Kpi label="Gross refresh budget (12 months)" value={rupee(f.gross)} /><Kpi label="Net after reusing idle stock" value={rupee(f.net)} good /><Kpi label="Avoided by stock offset" value={rupee(f.gross - f.net)} good /></div>
      <div className="card"><h2>When money will be needed</h2>
        <p className="mu small">Each asset’s end-of-life date is its category lifespan, pulled earlier by its risk score.</p>
        {f.quarters.map(q => <div className="row" key={q.label}><span>{q.label}</span><div className="bar" style={{ width: q.gross / max * 100 + '%' }}><i style={{ flex: 1, background: 'var(--ac)' }} /></div><span>{q.count} · {rupee(q.gross)}</span></div>)}</div>
      <div className="card scroll"><h2>By category</h2><table><thead><tr><th>Category</th><th>Due</th><th>Idle stock</th><th>To buy</th><th>Net budget</th></tr></thead><tbody>
        {f.categories.map(c => <tr key={c.category}><td>{c.category}</td><td>{c.need}</td><td>{c.stock}</td><td>{c.net}</td><td>{rupee(c.net_budget)}</td></tr>)}
        {!f.categories.length && <tr><td colSpan="5" className="mu">Nothing reaches end of life in the next 12 months.</td></tr>}</tbody></table></div>
    </>
  );
}

/** Threshold editor + live what-if simulator (nothing is saved until an admin presses Save). */
export function Settings({ user }) {
  const st = useApi('/settings'), [v, setV] = useState({}), [sim, setSim] = useState(null);
  useEffect(() => { if (st.data) setV(Object.fromEntries(st.data.map(s => [s.key, s.value]))); }, [st.data]);
  useEffect(() => {
    if (!Object.keys(v).length) return;
    const t = setTimeout(() => api('/insights/whatif?' + new URLSearchParams(v)).then(setSim).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [v]);
  if (!st.data) return <Loading state={st} />;
  const save = () => api('/settings', { method: 'PUT', body: v }).then(() => { toast('Thresholds saved'); st.reload(); }).catch(e => toast(e.message));
  return (
    <>
      <div className="card"><h2>Decision thresholds</h2>
        {st.data.map(s => <div className="row2 wide" key={s.key}><span>{s.label}</span>
          <input type="range" min="0" max={s.key === 'downtime_cost' ? 20000 : 100} step={s.key === 'downtime_cost' ? 500 : 1} value={v[s.key] ?? s.value} onChange={e => setV({ ...v, [s.key]: +e.target.value })} />
          <b>{v[s.key]}</b></div>)}
        {user.role === 'admin' && <button className="p" onClick={save}>Save thresholds</button>}</div>
      {sim && <div className="card"><h2>What-if: effect of these settings</h2>
        <div className="grid"><Kpi label="Est. savings now" value={rupee(sim.current.saving)} /><Kpi label="Est. savings with sliders" value={rupee(sim.scenario.saving)} good /></div>
        {sim.changed.length ? sim.changed.map(c => <div key={c.tag}>{c.tag} {c.name}: <span className={'tag ' + c.from}>{c.from}</span> → <span className={'tag ' + c.to}>{c.to}</span></div>) : <p className="mu">No asset changes its recommendation.</p>}</div>}
    </>
  );
}
