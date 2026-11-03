export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const h = fn => (req, res, next) => fn(req, res, next).catch(next);
export const need = (body, fields) => {
  const miss = fields.filter(f => body[f] === undefined || body[f] === '' || body[f] === null);
  if (miss.length) throw new HttpError(400, 'Missing: ' + miss.join(', '));
};
export const errorHandler = (e, req, res, _next) => {
  if (e.code === '23505') e = new HttpError(409, 'Duplicate value (serial number or tag already exists)');
  if (e.code === '23503' || e.code === '23514' || e.code === '22P02') e = new HttpError(400, 'Invalid data: ' + (e.detail || e.message));
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
};
