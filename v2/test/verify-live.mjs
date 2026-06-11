/** verify-live.mjs — exercise the deployed v2 web app exactly like the PWA (fetch).
 *   node v2/test/verify-live.mjs <execUrl>
 */
const exec = process.argv[2];
if (!exec) { console.error('Usage: node verify-live.mjs <execUrl>'); process.exit(1); }

async function post(obj) {
  const r = await fetch(exec, { method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(obj) });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return { ok: false, raw: t.slice(0, 200) }; }
}
const line = (n, o) => console.log(n.padEnd(28), JSON.stringify(o));

(async () => {
  let r = await post({ action: 'setup.claim', email: 'admin@ubcsis.com', password: 'UbcAdmin#2026' });
  line('1 setup.claim', { ok: r.ok, claimed: r.data && r.data.claimed, err: r.error && r.error.code, msg: r.error && r.error.message, raw: r.raw });

  r = await post({ action: 'auth.login', email: 'admin@ubcsis.com', password: 'UbcAdmin#2026' });
  line('2 login', { ok: r.ok, role: r.data && r.data.roles[0] && r.data.roles[0].role_code, err: r.error && r.error.code });
  const tok = r.data && r.data.token;
  if (!tok) { console.log('No token — stopping.'); return; }

  r = await post({ action: 'bootstrap', token: tok });
  line('3 bootstrap', { ok: r.ok, perms: r.data && r.data.permissions.length, lookups: r.data && r.data.lookups.length, CR: r.data && r.data.company.commercial_register });

  r = await post({ action: 'list', token: tok, entity: 'clients' });
  line('4 list clients', { ok: r.ok, count: r.data && r.data.length, first: r.data && r.data[0] && r.data[0].name_en });

  r = await post({ action: 'masters.client.create', token: tok, record: { name_en: 'Live Test Client', name_ar: 'عميل تجريبي', sector: 'chemicals' } });
  line('5 create client', { ok: r.ok, code: r.data && r.data.client_code });

  r = await post({ action: 'admin.user.create', token: tok, record: { email: 'siteeng@ubcsis.com', full_name_en: 'Site Engineer 1', role_code: 'SITE_ENGINEER' } });
  line('6 create user', { ok: r.ok, temp: r.data && r.data.temporary_password, err: r.error && r.error.code });

  r = await post({ action: 'list', token: tok, entity: 'doa_bands' });
  line('7 DoA bands', { ok: r.ok, count: r.data && r.data.length });

  r = await post({ action: 'list', token: tok, entity: 'users' });
  line('8 users', { ok: r.ok, count: r.data && r.data.length });
})();
