import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, session } from '../api.js';
import { toast, useApi, useCategories } from '../hooks.js';
import { Loading, Status, Tag } from '../ui.jsx';

const COLS = ['name', 'category', 'serial', 'cost', 'bought', 'condition', 'assigned_to', 'maintenance_cost', 'service_count'];
const ALIAS = { purchase_cost: 'cost', price: 'cost', purchase_date: 'bought', serial_no: 'serial', assignee: 'assigned_to' };
/** CSV with or without a header row; header names may use common aliases. */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.split(',').map(x => x.trim())).filter(r => r[0] || r.length > 1);
  let cols = COLS;
  if (lines.length && /^name$/i.test(lines[0][0])) cols = lines.shift().map(c => { c = c.toLowerCase(); return ALIAS[c] || c; });
  return lines.filter(r => r[0]).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}
const SAMPLE = 'Dell Latitude 5440,Laptop,SN-9001,85000,2022-03-10,fair,Esha Rao,27000,2\nHP EliteDesk 800,Desktop,SN-9002,60000,2020-02-20,poor,,41000,4\nLG 27 Monitor,Monitor,SN-9003,22000,2023-06-01,good,IDLE,0,0';

function Admin({ onDone }) {
  const cats = useCategories();
  const [csv, setCsv] = useState(''), [f, setF] = useState({ name: '', category_id: 1, serial_no: '', purchase_date: new Date().toISOString().slice(0, 10) });
  const run = async fn => { try { await fn(); onDone(); } catch (e) { toast(e.message); } };
  const importCsv = () => run(async () => {
    const r = await api('/assets/import', { method: 'POST', body: { rows: parseCsv(csv) } });
    toast(`${r.imported} devices imported and analysed` + (r.warnings.length ? `. ${r.warnings.length} warning(s): ${r.warnings[0]}` : '')); setCsv('');
  });
  return (
    <>
      <div className="card"><h2>Bulk import (CSV)</h2>
        <p className="mu small">Columns: {COLS.join(', ')} (a header row is optional). Only name is required; blank cost uses the category average; assigned_to is a user's name, IDLE, or blank.</p>
        <textarea rows="3" value={csv} onChange={e => setCsv(e.target.value)} placeholder={SAMPLE.split('\n')[0]} />
        <div className="fl"><button className="p" onClick={importCsv}>Import</button><button onClick={() => setCsv(SAMPLE)}>Fill sample</button>
          <input type="file" accept=".csv" onChange={e => e.target.files[0]?.text().then(setCsv)} /></div></div>
      <div className="card"><h2>Register asset</h2>
        <div className="fl">
          <input placeholder="Name / model" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <select value={f.category_id} onChange={e => setF({ ...f, category_id: +e.target.value })}>
            {cats.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input placeholder="Serial no." value={f.serial_no} onChange={e => setF({ ...f, serial_no: e.target.value })} />
          <input type="number" placeholder="Cost ₹ (blank = category average)" onChange={e => setF({ ...f, purchase_cost: +e.target.value || undefined })} />
          <input type="date" value={f.purchase_date} onChange={e => setF({ ...f, purchase_date: e.target.value })} />
          <button className="p" onClick={() => run(() => api('/assets', { method: 'POST', body: f }).then(() => toast('Asset registered')))}>Add</button></div></div>
    </>
  );
}

export default function Assets({ mine }) {
  const st = useApi('/assets'), role = session.user().role, a = st.data;
  const [search, setSearch] = useState('');
  return (
    <>
      {role === 'admin' && <Admin onDone={st.reload} />}
      <div className="card scroll">
        <div className="fl"><h2 style={{ margin: 0 }}>{mine ? 'My assets' : 'All assets'}</h2>
          <input placeholder="Search tag or name" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Loading state={st} />
        {a && <table><thead><tr><th>Tag</th><th>Asset</th><th>Status</th><th>Assignee</th><th>Utilisation</th><th>Risk</th><th>Action</th></tr></thead><tbody>
          {a.filter(x => (x.tag + x.name).toLowerCase().includes(search.toLowerCase())).map(x => (
            <tr key={x.id}><td><Link to={'/a/' + x.tag}>{x.tag}</Link></td><td>{x.name}<br /><small className="mu">{x.category} · {x.condition}</small></td>
              <td><Status s={x.status} /></td><td>{x.assignee_name || '—'}</td><td>{x.util}%</td><td>{x.risk}</td><td><Tag rec={x.rec} /></td></tr>))}
          {!a.length && <tr><td colSpan="7" className="mu">No assets.</td></tr>}
        </tbody></table>}
      </div>
    </>
  );
}
