/** migrate-invoices.mjs — import the legacy YTD sales-invoice register.
 *   node v2/test/migrate-invoices.mjs <execUrl> <tracker.json>
 * Idempotent (keyField=invoice_serial), batched, with retry for flaky network.
 */
import { readFileSync } from 'node:fs';
const exec = process.argv[2], jsonPath = process.argv[3];
const src = JSON.parse(readFileSync(jsonPath, 'utf8'));

function xdate(s) { const n = Number(s); if (!s || isNaN(n) || n < 1) return String(s || ''); return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10); }
const recs = src.filter(r => r['Invoice Serial']).map(r => ({
  invoice_serial: r['Invoice Serial'], supply_service: r['Supply / Service'], invoice_date: xdate(r['Month - Year']),
  client_name: r['Customer'], description: r['Short Description'],
  total_value: r['Total Value, EGP'], tax_deduction: r['Tax Deduction. EGP'], gross_value: r['Gross Value, EGP'],
  vat: r['Value add Tax (VAT)'], total_gross: r['Total Gross, EGP'], expenses: r['Total Expenses, EGP'],
  net_profit: r['Net Profit, EGP'], cheque_received: r['Cheque Received (Y/N)'], cheque_no: r['Cheque/Document No.'],
  form13_received: r['From 13 Received (Y/N)'], remarks: r['Remarks'], source: 'legacy-YTD'
}));

async function p(o, n) {
  for (let i = 0; i < (n || 6); i++) {
    try { const r = await fetch(exec, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(o) }); return JSON.parse(await r.text()); }
    catch (e) { await new Promise(s => setTimeout(s, 2500)); }
  }
  return { ok: false, err: 'network' };
}
(async () => {
  const l = await p({ action: 'auth.login', email: 'admin@ubcsis.com', password: 'UbcAdmin#2026' });
  if (!l.data) { console.log('login failed', JSON.stringify(l)); return; }
  const tok = l.data.token;
  console.log('mapped', recs.length, 'invoice rows; importing in batches of 150…');
  let ins = 0, skip = 0, errs = 0;
  for (let i = 0; i < recs.length; i += 150) {
    const chunk = recs.slice(i, i + 150);
    const r = await p({ action: 'admin.import', token: tok, entity: 'invoices', rows: chunk, keyField: 'invoice_serial' });
    if (r.data) { ins += r.data.inserted; skip += r.data.skipped; errs += r.data.error_count; console.log(`  batch ${i / 150 + 1}: +${r.data.inserted} inserted, ${r.data.skipped} skipped, ${r.data.error_count} err`); }
    else { console.log(`  batch ${i / 150 + 1}: FAILED`, JSON.stringify(r.error || r)); }
  }
  console.log(`TOTAL: inserted=${ins} skipped=${skip} errors=${errs}`);
  const cnt = await p({ action: 'list', token: tok, entity: 'invoices' });
  console.log('invoices in system now:', cnt.data && cnt.data.length);
})();
