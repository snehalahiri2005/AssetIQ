# AssetIQ: IT Asset Lifecycle & Cost Optimization Platform

Multi-tier enterprise application: **React (Vite)** → **Node.js / Express REST API** → **PostgreSQL**.

```
database/schema.sql     Data layer: tables, constraints, triggers, hash-chained audit log, analytics view
server/src
  engine.js             Logical layer: health, risk, remaining life, recommendations, keep-vs-replace model, forecast, smart matching
  passport.js           Signed QR labels + public mobile "Asset Passport"
  services.js           Transactional lifecycle operations (assign / transfer / return / retire / maintenance)
  routes/ · auth.js     REST API · JWT + role-based access (admin / manager / employee)
client/src              Presentation layer: role-based React UI
sample_data/            Three CSV files for bulk import (10, 20 and minimal devices)
```

## Run it (Node 20+, PostgreSQL 14+)
```bash
docker compose up -d                       # PostgreSQL with the schema loaded (or run database/schema.sql in your own Postgres)
npm run setup                              # installs server and client
cp server/.env.example server/.env         # set JWT_SECRET to a long random string
npm run seed                               # 30 demo assets, 6 users
npm run build && npm start                 # one server on http://localhost:4000 (API + UI + QR passport)
```
Development with hot reload: `npm --prefix server run dev` and `npm --prefix client run dev` (UI on :5173).
Logins (password `password123`): `admin@assetiq.dev`, `manager@assetiq.dev`, `esha@assetiq.dev`.

## Scanning a label with a phone
1. Connect the phone to the **same Wi-Fi** as the computer.
2. Start the server. It prints `QR labels point to: http://<your-ip>:4000`. If that address is wrong, start it with `PUBLIC_URL=http://<your-ip>:4000` (Windows: `set PUBLIC_URL=...`).
3. Open **QR labels** (or any asset page) and scan with the phone's normal camera. The **Asset Passport** opens with no login: authenticity check, decision, health, remaining life, warranty and recent history.
4. A forged or edited label shows a red "not recognised" page and no asset data. Costs are never shown on the public page.
5. Staff can tap through to the full record (sign-in required) and employees can report a problem on their own device.
6. The in-app live scanner needs HTTPS on a phone: use `npm --prefix client run dev:phone`, or use "take a photo of the QR" in the Scan tab. "Details text" labels work with any scanner and no network.

## Features
**Core:** JWT login and role-based access · asset registration · bulk CSV import (assignees, idle, service history) · assign / transfer / return / retire · maintenance with cost and downtime · utilisation and idle analysis from assignment history · lifecycle cost · QR labels and scanner · dashboards.

**Decision support:** health score (0-100) and remaining useful life · risk score with a visible breakdown · Retain / Repair / Reassign / Reuse / Replace with a plain-English reason · 36-month keep-vs-replace chart with break-even month · what-if simulator and editable thresholds stored in the database.

**Beyond the brief:**
| Feature | Where |
|---|---|
| Tamper-evident history: SHA-256 hash chain created by a database trigger, append-only table, `verify_chain()` | `schema.sql` |
| Signed QR + public Asset Passport that rejects forged labels | `passport.js` |
| Purchase-avoidance: equipment requests are served from idle stock first | Requests page |
| 12-month refresh budget forecast, net of idle stock | Forecast page |
| Savings ledger: estimates become *realised* savings only when accepted | asset page, dashboard |
| Green IT: CO₂e avoided and avoidable through reuse and repair | dashboard |
| Warranty watch and "repair is free under warranty" | dashboard, asset page |
| Issue reporting by employees, resolved with the repair logged in one step | Issues page |

## How a decision is made (`engine.js`)
- **Health** = 100 − age vs expected life (up to 60) − condition − repair-cost ratio − repair frequency. **Remaining life** = years left × health.
- **Risk** (0-100) = age 30 + condition 25 + repair cost vs price 25 + repair frequency 20.
- **Replace** if risk ≥ threshold or health < 25. **Repair** if condition is poor. **Reuse** if idle ≥ 30 days and health ≥ 45. **Reassign** if assigned but under 20% utilised over 90 days. Otherwise **Retain**.
- **Keep vs replace** compares 36 months of expected repairs and downtime (rising 2% a month) against the price of a new device minus salvage.
- All thresholds live in the `settings` table and can be changed on the Settings page.

