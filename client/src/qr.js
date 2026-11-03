// What goes inside a label's QR code.
//  link: the server's signed public passport URL (any phone camera opens it, no login, forged labels are rejected)
//  text: plain details any scanner can show offline
export const isLocalUrl = u => /\/\/(localhost|127\.|\[::1\])/.test(u || '');

export function qrValue(a, mode = 'link') {
  if (mode === 'link') return a.passport_url;
  return ['AssetIQ ASSET', `Tag: ${a.tag}`, `${a.name} (${a.category})`, `SN: ${a.serial_no}`, `Status: ${a.status}${a.assignee_name ? ' - ' + a.assignee_name : ''}`,
    `Condition: ${a.condition}`, `Health: ${a.health}/100 (${a.rul_months} months left)`, `DECISION: ${a.rec.toUpperCase()}`].join('\n');
}
