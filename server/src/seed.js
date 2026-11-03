// Demo data: node src/seed.js   (all demo accounts use the password "password123")
import bcrypt from 'bcryptjs';
import { pool, tx, logEvent } from './db.js';

const users = [
  ['Arjun Shetty', 'admin@assetiq.dev', 'admin', 'IT'], ['Kavya Reddy', 'manager@assetiq.dev', 'manager', 'Operations'],
  ['Esha Rao', 'esha@assetiq.dev', 'employee', 'Design'], ['Dev Menon', 'dev@assetiq.dev', 'employee', 'Engineering'],
  ['Ravi Iyer', 'ravi@assetiq.dev', 'employee', 'Finance'], ['Meera Nair', 'meera@assetiq.dev', 'employee', 'HR'],
];
// [name, category, serial, ageDays, cost, condition, warrantyDaysFromNow, assignee, assignedDaysAgo, returnedDaysAgo, maintenance[[daysAgo, desc, cost]]]
const assets = [
  ['Dell Latitude 5440', 'Laptop', 'SN-48213', 1700, 85000, 'fair', -900, 'Esha Rao', 120, null, [[400, 'Battery replacement', 18000], [200, 'Keyboard repair', 9000]]],
  ['MacBook Air M2', 'Laptop', 'SN-77120', 650, 110000, 'good', 35, 'Dev Menon', 250, null, []],
  ['LG 27UL500 Monitor', 'Monitor', 'SN-33901', 1100, 22000, 'good', -300, null, null, 95, []],
  ['HP EliteDesk 800', 'Desktop', 'SN-90455', 2400, 60000, 'poor', -1500, null, null, 40,
    [[900, 'PSU replacement', 12000], [500, 'Motherboard repair', 15000], [300, 'RAM + SSD', 8000], [120, 'Fan + PSU', 6000]]],
  ['Lenovo ThinkPad E14', 'Laptop', 'SN-61288', 900, 72000, 'good', 300, 'Ravi Iyer', 60, null, []],
  ['Dell P2419H Monitor', 'Monitor', 'SN-20877', 1500, 18000, 'poor', -600, null, null, 10, []],
  ['iPad 9th Gen', 'Tablet', 'SN-55102', 800, 38000, 'good', 20, null, null, 150, []],
];
// 23 more deterministic demo assets so the dashboard has a realistic fleet (30 in total)
const POOL = [['Dell OptiPlex 7090', 'Desktop', 62000], ['Lenovo ThinkCentre M70', 'Desktop', 50000], ['HP ProBook 450', 'Laptop', 68000], ['Dell Latitude 7420', 'Laptop', 95000],
  ['Samsung 22in Monitor', 'Monitor', 12000], ['HP LaserJet Pro', 'Printer', 28000], ['Cisco Switch 24p', 'Networking', 45000], ['Logitech MX Keys', 'Accessory', 9000],
  ['Galaxy Tab A8', 'Tablet', 22000], ['iPhone 13', 'Phone', 65000], ['Acer Aspire 5', 'Laptop', 52000], ['ASUS ProArt Monitor', 'Monitor', 30000]];
const EMP = ['Esha Rao', 'Dev Menon', 'Ravi Iyer', 'Meera Nair'];
let seedN = 7; const rnd = () => (seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648;
POOL.concat(POOL).slice(0, 23).forEach(([name, cat, cost], i) => {
  const age = Math.round(200 + rnd() * 2300), worn = age > 1600, mc = worn ? Math.round(cost * (0.1 + rnd() * 0.5)) : 0, n = worn ? 1 + Math.floor(rnd() * 4) : 0;
  const maint = Array.from({ length: n }, (_, k) => [Math.round(age * (0.2 + 0.6 * (k + 1) / (n + 1))), ['Battery replacement', 'PSU replacement', 'Screen repair', 'Fan + cleaning'][k % 4], Math.round(mc / n)]);
  const idle = rnd() < 0.3, cond = age > 2000 ? (rnd() < 0.6 ? 'poor' : 'fair') : age > 1200 ? 'fair' : 'good';
  assets.push([name, cat, 'SN-G' + (1000 + i), age, cost, cond, 1095 - age, idle ? null : EMP[i % 4], idle ? null : Math.min(age - 1, 30 + Math.round(rnd() * 600)), idle ? 5 + Math.round(rnd() * 150) : null, maint]);
});
const day = n => `now() - interval '${n} days'`;

await tx(async c => {
  await c.query('TRUNCATE users, assets, asset_requests, savings_ledger, issue_reports RESTART IDENTITY CASCADE');
  await c.query('ALTER SEQUENCE asset_tag_seq RESTART WITH 1');
  const hash = await bcrypt.hash('password123', 10), uid = {};
  for (const [name, email, role, dept] of users)
    uid[name] = (await c.query('INSERT INTO users(name,email,password_hash,role,department) VALUES($1,$2,$3,$4,$5) RETURNING id', [name, email, hash, role, dept])).rows[0].id;
  const admin = uid['Arjun Shetty'];
  const { rows: cats } = await c.query('SELECT id,name FROM categories'), cid = Object.fromEntries(cats.map(x => [x.name, x.id]));

  for (const [name, cat, ser, age, cost, cond, warr, who, since, ret, maint] of assets) {
    const { rows: [a] } = await c.query(
      `INSERT INTO assets(name,category_id,serial_no,purchase_date,purchase_cost,warranty_until,condition)
       VALUES($1,$2,$3,CURRENT_DATE - $4::int,$5,CURRENT_DATE + $6::int,'good') RETURNING id`, [name, cid[cat], ser, age, cost, warr]);
    await logEvent(c, a.id, 'Registered', `${cat} · ${name}`, admin, null);
    for (const [d, desc, mc] of maint) {
      await c.query('INSERT INTO maintenance_records(asset_id,performed_on,description,cost,condition_after,downtime_days) VALUES($1,CURRENT_DATE - $2::int,$3,$4,$5,2)', [a.id, d, desc, mc, 'good']);
      await logEvent(c, a.id, 'Maintenance', `${desc} (Rs ${mc})`, admin);
    }
    if (who) {
      await c.query(`INSERT INTO assignments(asset_id,user_id,assigned_at) VALUES($1,$2,${day(since)})`, [a.id, uid[who], ]);
      await logEvent(c, a.id, 'Assigned', `To ${who}`, admin);
    } else {
      await c.query(`INSERT INTO assignments(asset_id,user_id,assigned_at) VALUES($1,$2,${day(ret + 60)})`, [a.id, uid['Meera Nair']]);
      await c.query(`UPDATE assignments SET returned_at=${day(ret)} WHERE asset_id=$1`, [a.id]);
      await logEvent(c, a.id, 'Returned', 'From Meera Nair', admin);
    }
    await c.query('UPDATE assets SET condition=$2 WHERE id=$1', [a.id, cond]);   // final condition after history
  }
  await c.query("INSERT INTO asset_requests(requester_id,category_id,justification) VALUES($1,$2,'Second monitor for dashboards')", [uid['Meera Nair'], cid.Monitor]);
  await c.query("INSERT INTO issue_reports(asset_id,reported_by,description) VALUES(1,$1,'Battery drains in under an hour')", [uid['Esha Rao']]);
});
await pool.end();
console.log('Seeded. Log in as admin@assetiq.dev / manager@assetiq.dev / esha@assetiq.dev, password: password123');
