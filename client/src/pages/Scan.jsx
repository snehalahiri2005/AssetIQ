import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import { useApi } from '../hooks.js';
import { isLocalUrl, qrValue } from '../qr.js';
import { Loading, Tag } from '../ui.jsx';

export function Labels() {
  const st = useApi('/assets'), [mode, setMode] = useState('link'), first = st.data?.[0]?.passport_url;
  return (
    <>
      <div className="card noprint"><h2>QR labels</h2>
        <div className="fl"><label><input type="radio" checked={mode === 'link'} onChange={() => setMode('link')} /> Signed passport link: any phone camera opens it, no login</label>
          <label><input type="radio" checked={mode === 'text'} onChange={() => setMode('text')} /> Details text: any scanner, works offline</label></div>
        {mode === 'link' && first && <p className="mu small">Labels point to <b>{new URL(first).origin}</b>. A forged or edited label is rejected by the server.</p>}
        {mode === 'link' && isLocalUrl(first) && <p className="err small">This address only works on this computer. Start the server with PUBLIC_URL=http://&lt;your-computer-ip&gt;:4000 (phone and computer on the same Wi-Fi), or your deployed URL.</p>}
        <div className="fl" style={{ marginTop: 8 }}><button className="p" onClick={() => window.print()}>Print labels</button></div></div>
      <Loading state={st} />
      <div className="grid labels">{st.data?.map(a => (
        <div className="card center" key={a.id}><QRCodeSVG value={qrValue(a, mode)} size={180} level={mode === 'text' ? 'L' : 'M'} bgColor="#fff" style={{ padding: 8, background: '#fff', borderRadius: 8 }} />
          <div><b>{a.tag}</b> · {a.name}</div><Tag rec={a.rec} /> <Link to={'/a/' + a.tag} className="noprint">Open</Link></div>))}</div>
    </>
  );
}

export function Scan() {
  const nav = useNavigate(), video = useRef(), canvas = useRef(), stream = useRef(), raf = useRef();
  const [msg, setMsg] = useState(''), [tag, setTag] = useState('');
  const open = text => {
    stop();
    const m = String(text).match(/\/(?:a|passport)\/([\w-]+)/) || String(text).match(/Tag:\s*(AIQ-\d+)/i) || String(text).match(/(AIQ-\d+)/i);
    m ? nav('/a/' + m[1].toUpperCase()) : setMsg('That QR code is not an AssetIQ label.');
  };
  const stop = () => { cancelAnimationFrame(raf.current); stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  useEffect(() => stop, []);
  const tick = () => {
    const v = video.current;
    if (v && v.readyState === 4) {
      const c = canvas.current, x = c.getContext('2d', { willReadFrequently: true });
      c.width = v.videoWidth; c.height = v.videoHeight; x.drawImage(v, 0, 0);
      const img = x.getImageData(0, 0, c.width, c.height), r = jsQR(img.data, img.width, img.height);
      if (r) return open(r.data);
    }
    raf.current = requestAnimationFrame(tick);
  };
  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.current.srcObject = stream.current; video.current.style.display = 'block'; await video.current.play(); tick();
    } catch { setMsg(window.isSecureContext ? 'Camera unavailable. Take a photo of the QR instead, or type the tag.' : 'Phones only allow the live camera on HTTPS pages. Use “take a photo” below, or run npm run dev:phone for HTTPS.'); }
  };
  const fromFile = f => {
    if (!f) return;
    const im = new Image();
    im.onload = () => {
      const c = canvas.current, x = c.getContext('2d'); c.width = im.width; c.height = im.height; x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height), r = jsQR(d.data, d.width, d.height);
      r ? open(r.data) : setMsg('No QR code found in that image.');
    };
    im.src = URL.createObjectURL(f);
  };
  return (
    <div className="card"><h2>Scan an asset QR code</h2>
      <div className="fl"><button className="p" onClick={start}>Start camera</button>
        <label className="fl">or take / upload a photo of the QR <input type="file" accept="image/*" capture="environment" onChange={e => fromFile(e.target.files[0])} /></label></div>
      <div className="fl" style={{ margin: '8px 0' }}><input placeholder="Type tag, e.g. AIQ-004" value={tag} onChange={e => setTag(e.target.value)} /><button onClick={() => open(tag)}>Look up</button></div>
      <p className="mu">{msg}</p><video ref={video} playsInline muted style={{ display: 'none' }} /><canvas ref={canvas} style={{ display: 'none' }} />
      <p className="mu small">Employees can only open assets assigned to them, and can report a problem straight from the record.</p></div>
  );
}
