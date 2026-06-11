/** verify-phase2.mjs — live check of the Phase-2 chain on the deployed web app.
 *   node v2/test/verify-phase2.mjs <execUrl>
 */
const exec = process.argv[2];
async function post(o) {
  const r = await fetch(exec, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(o) });
  try { return JSON.parse(await r.text()); } catch (e) { return { ok: false }; }
}
const line = (n, o) => console.log(n.padEnd(24), JSON.stringify(o));
(async () => {
  let l = await post({ action: 'auth.login', email: 'admin@ubcsis.com', password: 'UbcAdmin#2026' });
  const tok = l.data && l.data.token; line('login', { ok: l.ok });
  if (!tok) return;
  let rs = await post({ action: 'admin.reseed', token: tok });
  line('reseed', { ok: rs.ok, perms_added: rs.data && rs.data.seeded.permissions, doa_added: rs.data && rs.data.seeded.doa_bands, tabs: rs.data && rs.data.tabs.length });
  let cl = await post({ action: 'list', token: tok, entity: 'clients' });
  const clientId = cl.data[0].id;
  let pr = await post({ action: 'masters.project.create', token: tok, record: { name_en: 'Phase2 Demo', name_ar: 'مشروع تجريبي', client_id: clientId, client_ref: 'PO-DEMO-1', sector: 'chemicals', contract_value: 1000000, currency: 'EGP' } });
  line('project.create', { ok: pr.ok, code: pr.data && pr.data.project_code });
  const projId = pr.data && pr.data.id;
  let mr = await post({ action: 'procurement.mr.create', token: tok, record: { project_id: projId, required_date: '2026-03-01', priority: 'High', lines: [{ description: 'Cement', unit: 'bag', qty: 100, est_unit_price: 300 }, { description: 'Steel', unit: 'ton', qty: 1, est_unit_price: 20000 }] } });
  line('MR.create', { ok: mr.ok, num: mr.data && mr.data.header.mr_number, est_total: mr.data && mr.data.header.est_total, lines: mr.data && mr.data.lines.length });
  const mrId = mr.data && mr.data.header.id;
  let sub = await post({ action: 'doc.submit', token: tok, entity: 'material_requisitions', id: mrId, project_id: projId });
  const roles = sub.data && sub.data.steps && JSON.parse(sub.data.steps[0].roles_json);
  line('MR.submit', { ok: sub.ok, status: sub.data && sub.data.request.status, band_signers: roles });
  let got = await post({ action: 'get', token: tok, entity: 'material_requisitions', id: mrId });
  line('MR.status', { ok: got.ok, status: got.data && got.data.status, approval_id: !!(got.data && got.data.approval_id) });
  console.log('\nExpected: band_signers = [CONSTRUCTION_MGR, PROCUREMENT_MGR] for a 50,000 EGP MR.');
})();
