import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rupee, session } from '../api.js';
import { toast, useApi, useCategories } from '../hooks.js';
import { Loading } from '../ui.jsx';

const LABEL = { open: 'Open', fulfilled_from_stock: 'Served from idle stock ✔', needs_purchase: 'Needs purchase' };

export function NewRequest() {
  const st = useApi('/requests'), cats = useCategories(), [f, setF] = useState({ category_id: 1, justification: '' });
  const send = () => api('/requests', { method: 'POST', body: f }).then(() => { toast('Request sent. IT will check idle stock first.'); setF({ ...f, justification: '' }); st.reload(); }).catch(e => toast(e.message));
  return (
    <>
      <div className="card"><h2>Request equipment</h2>
        <p className="mu">Before buying anything, IT checks whether a suitable idle device can be reissued to you.</p>
        <div className="fl"><select value={f.category_id} onChange={e => setF({ ...f, category_id: +e.target.value })}>{cats.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input style={{ flex: 1 }} placeholder="Why do you need it?" value={f.justification} onChange={e => setF({ ...f, justification: e.target.value })} />
          <button className="p" onClick={send}>Send request</button></div></div>
      <div className="card"><h2>My requests</h2><Loading state={st} />
        {st.data?.map(r => <div key={r.id}>{r.category}: {r.justification || '—'} <b>{LABEL[r.status]}</b></div>)}</div>
    </>
  );
}

export function Requests() {
  const st = useApi('/requests'), isAdmin = session.user().role === 'admin';
  const call = (id, path, body) => api(`/requests/${id}/${path}`, { method: 'POST', body }).then(() => { toast('Done'); st.reload(); }).catch(e => toast(e.message));
  return (
    <div className="card"><h2>Equipment requests: purchase-avoidance engine</h2><Loading state={st} />
      {st.data?.map(r => (
        <div className="req" key={r.id}>
          <div><b>{r.requester}</b> wants a <b>{r.category}</b>: {r.justification || '—'} <span className="mu">({LABEL[r.status]})</span></div>
          {r.status === 'open' && (r.matches.length
            ? <div><div className="ok">💡 {r.matches.length} idle {r.category.toLowerCase()}(s) can serve this. Buying new would cost {rupee(r.avg_cost)}.</div>
                {r.matches.map(m => <div className="fl" key={m.id}><Link to={'/a/' + m.tag}>{m.tag}</Link> {m.name} · risk {m.risk} · idle {m.idle_days}d
                  {isAdmin && <button className="p" onClick={() => call(r.id, 'fulfil', { asset_id: m.id })}>Assign this one</button>}</div>)}</div>
            : <div className="mu">No suitable idle stock. {isAdmin && <button onClick={() => call(r.id, 'purchase')}>Mark as needs purchase</button>}</div>)}
        </div>))}
    </div>
  );
}

export function Issues() {
  const st = useApi('/issues'), [note, setNote] = useState({});
  const resolve = (i, fix) => api(`/issues/${i.id}/resolve`, { method: 'POST', body: fix ? { description: note[i.id] || i.description, cost: 0, condition: 'good' } : {} })
    .then(() => { toast('Issue resolved'); st.reload(); }).catch(e => toast(e.message));
  return (
    <div className="card scroll"><h2>Reported issues</h2><Loading state={st} />
      {st.data && <table><thead><tr><th>Asset</th><th>Reported by</th><th>Problem</th><th>Status</th><th /></tr></thead><tbody>
        {st.data.map(i => <tr key={i.id}><td><Link to={'/a/' + i.tag}>{i.tag}</Link> {i.asset}</td><td>{i.reporter}</td><td>{i.description}</td><td>{i.status}</td>
          <td>{i.status === 'open' && session.user().role === 'admin' && <div className="fl"><input placeholder="Fix note" onChange={e => setNote({ ...note, [i.id]: e.target.value })} />
            <button onClick={() => resolve(i, true)}>Fixed (log repair)</button><button onClick={() => resolve(i, false)}>Close</button></div>}</td></tr>)}
      </tbody></table>}
    </div>
  );
}
