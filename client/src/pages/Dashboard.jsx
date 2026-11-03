import { Link } from 'react-router-dom';
import { rupee } from '../api.js';
import { useApi } from '../hooks.js';
import { Kpi, Loading, Tag } from '../ui.jsx';

export default function Dashboard() {
  const st = useApi('/insights/dashboard'), d = st.data;
  if (!d) return <Loading state={st} />;
  const k = d.kpis, max = Math.max(...d.costs.map(c => c.purchase + c.maintenance), 1);
  return (
    <>
      <div className="grid">
        <Kpi label="Assets in service" value={k.in_service} />
        <Kpi label="Fleet health" value={k.fleet_health + '/100'} />
        <Kpi label="Lifecycle cost" value={rupee(k.lifecycle_cost)} />
        <Kpi label="Maintenance spend" value={rupee(k.maintenance)} />
        <Kpi label="Estimated savings found" value={rupee(k.estimated_saving)} good />
        <Kpi label="Savings realised" value={rupee(k.realised_saving)} good />
        <Kpi label="CO₂e avoided so far" value={Math.round(k.co2_avoided) + ' kg'} good />
        <Kpi label="CO₂e avoidable (reuse/repair)" value={Math.round(k.co2_potential) + ' kg'} good />
      </div>
      {d.warranty_alerts.length > 0 && (
        <div className="card warn"><h2>⏰ Warranties ending within 60 days</h2>
          {d.warranty_alerts.map(w => <div key={w.tag}><Link to={'/a/' + w.tag}>{w.tag}</Link> {w.name}: expires {w.warranty_until}. Claim any pending repair now.</div>)}
        </div>)}
      <div className="card"><h2>Cost optimisation recommendations</h2>
        <div className="fl">{Object.entries(d.counts).map(([r, n]) => <span key={r} className={'tag ' + r}>{r} × {n}</span>)}</div>
        <div className="scroll"><table><thead><tr><th>Asset</th><th>Action</th><th>Why</th><th>Est. saving</th></tr></thead><tbody>
          {d.recommendations.map(a => <tr key={a.tag}><td><Link to={'/a/' + a.tag}>{a.tag}</Link> {a.name}</td><td><Tag rec={a.rec} /></td><td>{a.why}</td><td className="ok">{rupee(a.saving)}</td></tr>)}
        </tbody></table></div>
        <p className="mu small">Open an asset and press “Accept recommendation” to move an estimate into realised savings.</p></div>
      <div className="card"><h2>Fleet health distribution</h2>
        {d.bands.map(b => <div className="row" key={b.label}><span>{b.label}</span><div className="bar" style={{ width: b.count / Math.max(...d.bands.map(x => x.count), 1) * 100 + '%' }}><i style={{ flex: 1, background: 'var(--ac)' }} /></div><span>{b.count} assets</span></div>)}</div>
      <div className="card"><h2>Lifecycle cost per asset <span className="mu small">purchase ■ maintenance ■</span></h2>
        {d.costs.map(c => <div className="row" key={c.tag}><span>{c.name}</span>
          <div className="bar" style={{ width: (c.purchase + c.maintenance) / max * 100 + '%' }}>
            <i style={{ width: c.purchase / (c.purchase + c.maintenance) * 100 + '%', background: 'var(--ac)' }} /><i style={{ flex: 1, background: 'var(--er)' }} /></div>
          <span>{rupee(c.purchase + c.maintenance)}</span></div>)}
      </div>
    </>
  );
}
