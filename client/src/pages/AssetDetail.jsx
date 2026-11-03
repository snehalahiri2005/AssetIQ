import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api, rupee } from '../api.js';
import { toast, useApi } from '../hooks.js';
import { qrValue } from '../qr.js';
import { Kpi, Loading, RiskBars, Tag, TcoChart } from '../ui.jsx';

const DECISION = { Retain: 'RETAIN: keep using it', Repair: 'REPAIR: fix it, don’t replace', Reassign: 'REASSIGN: move it to a heavier user', Reuse: 'REUSE: reissue it, don’t buy new', Replace: 'REPLACE: retire it and buy new', Retired: 'RETIRED: out of service' };

export default function AssetDetail({ user }) {
  const { ref } = useParams(), st = useApi('/assets/' + ref), a = st.data, admin = user.role === 'admin';
  const users = useApi(admin ? '/auth/users' : '/auth/me');
  const [m, setM] = useState({ description: '', cost: '', condition: 'good', downtime_days: '' }), [who, setWho] = useState(''), [issue, setIssue] = useState('');
  if (!a) return <Loading state={st} />;
  const act = (path, body, msg) => api(`/assets/${a.id}/${path}`, { method: 'POST', body }).then(() => { toast(msg); st.reload(); }).catch(e => toast(e.message));
  return (
    <div className="card">
      <div className="two">
        <div><QRCodeSVG value={qrValue(a)} size={160} level="M" bgColor="#fff" style={{ padding: 8, background: '#fff', borderRadius: 8 }} />
          <small className="mu">Signed label for {a.tag}. A phone camera opens its public passport.</small><br /><a className="small" href={a.passport_url} target="_blank" rel="noreferrer">Preview passport</a></div>
        <div><h2>{a.name} <Tag rec={a.rec} /></h2>
          <div className="mu">{a.category} · Serial {a.serial_no} · Bought {a.purchase_date} · Condition {a.condition}<br />
            Status: <b>{a.status}</b>{a.assignee_name && ' to ' + a.assignee_name}
            {a.warranty_until && <> · Warranty {a.warranty_active ? 'until ' + a.warranty_until : 'expired'}</>}</div>
          <div className="grid" style={{ marginTop: 10 }}>
            <Kpi label="Purchase" value={rupee(a.purchase_cost)} /><Kpi label="Maintenance" value={rupee(a.maint_cost)} />
            <Kpi label="Lifecycle cost" value={rupee(a.lifecycle_cost)} /><Kpi label="Book value" value={rupee(a.book_value)} />
            <Kpi label="Utilisation (90d)" value={a.util + '%'} /><Kpi label="Risk" value={a.risk + '/100'} />
            <Kpi label="Health" value={a.health + '/100'} /><Kpi label="Remaining life" value={a.rul_months + ' mo'} /></div></div>
      </div>
      <div className={'dec ' + a.rec}><small>DECISION BASED ON LIFECYCLE DATA</small><div className="big">{DECISION[a.rec]}</div></div>
      <p><b>Why:</b> {a.why} {a.saving > 0 && <b className="ok">Est. saving {rupee(a.saving)}</b>}</p>
      {admin && a.kind && a.saving > 0 && <button className="p" onClick={() => act('accept', undefined, 'Saving booked to the ledger')}>Accept recommendation</button>}
      <RiskBars a={a} />
      {a.tco && <><h3>Repair-or-replace horizon</h3><TcoChart tco={a.tco} /><p className="mu">{a.tco.verdict} Keeping costs about {rupee(a.tco.keepMonthly)}/month in expected repairs and downtime; replacing needs {rupee(a.tco.upfront)} up front.</p></>}

      <h3>Lifecycle history <span className={'chain ' + (a.chain.valid ? 'ok' : 'bad')}>{a.chain.valid ? '🔒 hash chain verified' : '⚠ history altered at event #' + a.chain.broken_at}</span></h3>
      <div className="tl">{a.events.map(e => <div key={e.id}><b>{e.event_type}</b> · {e.detail} <span className="mu">{e.occurred_at.slice(0, 10)}{e.actor && ' · ' + e.actor}</span></div>)}</div>

      {user.role === 'employee' && a.status === 'assigned' && <>
        <h3>Something wrong with this device?</h3>
        <div className="fl"><input style={{ flex: 1 }} placeholder="Describe the problem" value={issue} onChange={e => setIssue(e.target.value)} />
          <button className="p" onClick={() => api('/issues', { method: 'POST', body: { asset_id: a.id, description: issue } }).then(() => { toast('Issue reported to IT'); setIssue(''); st.reload(); }).catch(e => toast(e.message))}>Report issue</button></div></>}

      {admin && a.status !== 'retired' && <>
        <h3>Actions</h3>
        <div className="fl"><select value={who} onChange={e => setWho(+e.target.value)}><option value="">Choose user…</option>
          {Array.isArray(users.data) && users.data.filter(u => u.role === 'employee').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <button disabled={!who} onClick={() => act('assign', { user_id: who }, 'Assigned')}>{a.status === 'assigned' ? 'Transfer' : 'Assign'}</button>
          {a.status === 'assigned' && <button onClick={() => act('return', {}, 'Returned to stock')}>Return</button>}
          <button onClick={() => confirm('Retire this asset?') && act('retire', {}, 'Retired')}>Retire</button></div>
        <div className="fl" style={{ marginTop: 6 }}>
          <input placeholder="Maintenance note" value={m.description} onChange={e => setM({ ...m, description: e.target.value })} />
          <input type="number" placeholder="Cost ₹" style={{ width: 110 }} value={m.cost} onChange={e => setM({ ...m, cost: e.target.value })} />
          <input type="number" placeholder="Downtime days" style={{ width: 130 }} value={m.downtime_days} onChange={e => setM({ ...m, downtime_days: e.target.value })} />
          <select value={m.condition} onChange={e => setM({ ...m, condition: e.target.value })}>{['new', 'good', 'fair', 'poor'].map(c => <option key={c}>{c}</option>)}</select>
          <button onClick={() => act('maintenance', { ...m, cost: +m.cost || 0, downtime_days: +m.downtime_days || 0 }, 'Maintenance logged. Risk and decision recalculated.')}>Log maintenance</button></div></>}
    </div>
  );
}
