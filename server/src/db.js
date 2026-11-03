import 'dotenv/config';
import pg from 'pg';

pg.types.setTypeParser(1082, v => v);          // DATE   -> 'YYYY-MM-DD' string
pg.types.setTypeParser(1700, v => parseFloat(v)); // NUMERIC -> number
pg.types.setTypeParser(20, v => parseInt(v, 10)); // BIGINT  -> number

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text, params) => pool.query(text, params).then(r => r.rows);

export async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

export const logEvent = (c, assetId, type, detail, actor = null, at = null) =>
  c.query(`INSERT INTO lifecycle_events(asset_id,event_type,detail,actor_id,occurred_at)
           VALUES($1,$2,$3,$4,coalesce($5::timestamptz, now()))`, [assetId, type, detail, actor, at]);

export const getSettings = async (c = pool) =>
  Object.fromEntries((await c.query('SELECT key,value FROM settings')).rows.map(r => [r.key, r.value]));

export const metrics = async (where = '', params = [], c = pool) =>
  (await c.query(`SELECT * FROM v_asset_metrics ${where} ORDER BY id`, params)).rows;
