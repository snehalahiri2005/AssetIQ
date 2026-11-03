import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auth, allow } from './auth.js';
import { q } from './db.js';
import passport, { PUBLIC } from './passport.js';
import { errorHandler } from './http.js';
import authRoutes from './routes/auth.js';
import assetRoutes from './routes/assets.js';
import insightRoutes from './routes/insights.js';
import { requests, issues, settings } from './routes/workflow.js';

if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) throw new Error('Set DATABASE_URL and JWT_SECRET (see .env.example)');
const app = express();
// Helmet's default CSP upgrades http -> https, which breaks the app on a plain-HTTP LAN address, so that one directive is off.
app.use(helmet({ hsts: false, contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null } } }));
app.use(cors(), express.json({ limit: '1mb' }));

app.use(passport);                                   // public, signature-checked phone page
app.get('/api/categories', auth, async (_req, res) => res.json(await q('SELECT id,name,avg_cost FROM categories ORDER BY id')));
app.use('/api/auth', authRoutes);
app.use('/api/assets', auth, assetRoutes);
app.use('/api/insights', auth, allow('admin', 'manager'), insightRoutes);
app.use('/api/requests', auth, requests);
app.use('/api/issues', auth, issues);
app.use('/api/settings', auth, settings);

// One-server mode: after `npm run build` in client/, this API also serves the React app
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get(/^\/(?!api|passport).*/, (_q, r) => r.sendFile(path.join(dist, 'index.html'))); }
app.use(errorHandler);

app.listen(process.env.PORT || 4000, () => console.log(`AssetIQ on :${process.env.PORT || 4000}\nQR labels point to: ${PUBLIC}`));
