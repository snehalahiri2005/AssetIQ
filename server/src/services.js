// Lifecycle operations, always run inside a transaction passed in by the caller.
import { logEvent } from './db.js';
import { HttpError } from './http.js';

const lock = async (c, id) => {
  const { rows: [a] } = await c.query('SELECT * FROM assets WHERE id=$1 FOR UPDATE', [id]);
  if (!a) throw new HttpError(404, 'Asset not found');
  if (a.status === 'retired') throw new HttpError(409, 'Asset is retired');
  return a;
};
const userName = async (c, id) => {
  const { rows: [u] } = await c.query('SELECT name FROM users WHERE id=$1', [id]);
  if (!u) throw new HttpError(400, 'Unknown user');
  return u.name;
};

export async function assignAsset(c, assetId, userId, actor, note = '') {
  const a = await lock(c, assetId), to = await userName(c, userId);
  if (a.status === 'assigned') await c.query('UPDATE assignments SET returned_at=now() WHERE asset_id=$1 AND returned_at IS NULL', [assetId]);
  await c.query('INSERT INTO assignments(asset_id,user_id) VALUES($1,$2)', [assetId, userId]);
  await logEvent(c, assetId, a.status === 'assigned' ? 'Transferred' : 'Assigned', `To ${to}${note}`, actor);
}

export async function returnAsset(c, assetId, actor) {
  const a = await lock(c, assetId);
  if (a.status !== 'assigned') throw new HttpError(409, 'Asset is not assigned');
  const from = await userName(c, a.assigned_to);
  await c.query('UPDATE assignments SET returned_at=now() WHERE asset_id=$1 AND returned_at IS NULL', [assetId]);
  await logEvent(c, assetId, 'Returned', `From ${from}`, actor);
}

export async function retireAsset(c, assetId, actor, reason = 'Removed from service') {
  const a = await lock(c, assetId);
  if (a.status === 'assigned') await c.query('UPDATE assignments SET returned_at=now() WHERE asset_id=$1 AND returned_at IS NULL', [assetId]);
  await c.query("UPDATE assets SET status='retired', assigned_to=NULL WHERE id=$1", [assetId]);
  await logEvent(c, assetId, 'Retired', reason, actor);
}

export async function addMaintenance(c, assetId, { description, cost = 0, condition, downtime_days = 0 }, actor) {
  await lock(c, assetId);
  await c.query('INSERT INTO maintenance_records(asset_id,description,cost,condition_after,downtime_days) VALUES($1,$2,$3,$4,$5)',
    [assetId, description, cost, condition, Math.max(0, +downtime_days || 0)]);
  await logEvent(c, assetId, 'Maintenance', `${description} (Rs ${Math.round(cost)}) · condition now ${condition}`, actor);
}
