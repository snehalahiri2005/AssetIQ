import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, session } from './api.js';
import { useToastHost } from './hooks.js';
import Dashboard from './pages/Dashboard.jsx';
import Assets from './pages/Assets.jsx';
import AssetDetail from './pages/AssetDetail.jsx';
import { Requests, Issues, NewRequest } from './pages/Workflow.jsx';
import { Forecast, Settings } from './pages/Insights.jsx';
import { Scan, Labels } from './pages/Scan.jsx';

const NAV = {
  admin:    [['/', 'Dashboard'], ['/assets', 'Assets'], ['/requests', 'Requests'], ['/issues', 'Issues'], ['/forecast', 'Forecast'], ['/labels', 'QR labels'], ['/scan', 'Scan'], ['/settings', 'Settings']],
  manager:  [['/', 'Dashboard'], ['/assets', 'Assets'], ['/forecast', 'Forecast'], ['/settings', 'What-if']],
  employee: [['/', 'My assets'], ['/request', 'Request device'], ['/scan', 'Scan QR']],
};

function Login() {
  const here = useLocation().pathname;
  const [f, setF] = useState({ email: 'admin@assetiq.dev', password: 'password123' }), [err, setErr] = useState('');
  const go = async e => {
    e.preventDefault();
    try { const r = await api('/auth/login', { method: 'POST', body: f }); session.save(r.token, r.user); location.assign(here.startsWith('/a/') ? here : '/'); }
    catch (x) { setErr(x.message); }
  };
  return (
    <form className="card login" onSubmit={go}>
      <h1>📦 AssetIQ</h1><p className="mu">IT Asset Lifecycle & Cost Optimization</p>
      <input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="Email" />
      <input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} placeholder="Password" />
      <button className="p">Sign in</button>{err && <p className="err">{err}</p>}
      {here.startsWith('/a/') && <small className="mu">Sign in to open {here.slice(3)}</small>}
      <small className="mu">Demo: admin@, manager@, esha@assetiq.dev · password123</small>
    </form>
  );
}

export default function App() {
  const user = session.user(), toast = useToastHost(), nav = useNavigate();
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  const emp = user.role === 'employee';
  return (
    <div className="wrap">
      <header>
        <h1>📦 AssetIQ</h1>
        <div className="fl"><span className="mu">{user.name} · {user.role}</span>
          <button onClick={() => { session.clear(); nav('/login'); location.reload(); }}>Sign out</button></div>
      </header>
      <nav>{NAV[user.role].map(([to, l]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'on' : ''}>{l}</NavLink>)}</nav>
      <main>
        <Routes>
          <Route path="/" element={emp ? <Assets mine /> : <Dashboard />} />
          <Route path="/assets" element={<Assets />} />
          <Route path="/a/:ref" element={<AssetDetail user={user} />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/request" element={<NewRequest />} />
          <Route path="/issues" element={<Issues />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/labels" element={<Labels />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/settings" element={<Settings user={user} />} />
          <Route path="/login" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <div id="toast" className={toast ? 'on' : ''} role="status">{toast}</div>
    </div>
  );
}
