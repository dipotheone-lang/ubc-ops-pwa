/** verify-phase4.mjs — live check: reseed + HSE risk-routing. node verify-phase4.mjs <url> */
const exec = process.argv[2];
async function p(o, tries) {
  for (let i = 0; i < (tries || 5); i++) {
    try {
      const r = await fetch(exec, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(o) });
      return JSON.parse(await r.text());
    } catch (e) { await new Promise(s => setTimeout(s, 2000)); }
  }
  return { ok: false, err: 'network' };
}
const L = (n, o) => console.log(n.padEnd(22), JSON.stringify(o));
(async () => {
  const l = await p({ action: 'auth.login', email: 'admin@ubcsis.com', password: 'UbcAdmin#2026' });
  L('login', { ok: l.ok }); const t = l.data && l.data.token; if (!t) return;
  const rs = await p({ action: 'admin.reseed', token: t });
  L('reseed', { ok: rs.ok, perms: rs.data && rs.data.seeded.permissions, doa: rs.data && rs.data.seeded.doa_bands, tabs: rs.data && rs.data.tabs.length });
  const cl = await p({ action: 'list', token: t, entity: 'clients' });
  const prj = await p({ action: 'list', token: t, entity: 'projects' });
  let projId = prj.data && prj.data[0] && prj.data[0].id;
  if (!projId) { const np = await p({ action: 'masters.project.create', token: t, record: { name_en: 'P4 Demo', client_id: cl.data[0].id, sector: 'chemicals' } }); projId = np.data && np.data.id; }
  // HIRA residual 14 → should route to COO
  const h = await p({ action: 'hse.hira.create', token: t, record: { project_id: projId, activity: 'Crane lift over live plant', hazards: 'Dropped load', risk_score: 20, controls: 'Exclusion zone, banksman', residual_score: 14 } });
  L('HIRA.create', { ok: h.ok, num: h.data && h.data.hira_number });
  const sub = await p({ action: 'doc.submit', token: t, entity: 'hira', id: h.data && h.data.id, project_id: projId });
  const roles = sub.data && sub.data.steps && JSON.parse(sub.data.steps[0].roles_json);
  L('HIRA.submit', { ok: sub.ok, status: sub.data && sub.data.request.status, band_signers: roles });
  // an employee + leave
  const emp = await p({ action: 'hr.employee.create', token: t, record: { full_name_en: 'Test Worker', full_name_ar: 'عامل', title: 'Fitter', contract_type: 'Permanent', basic_salary: 8000 } });
  L('employee.create', { ok: emp.ok, code: emp.data && emp.data.emp_code });
  console.log('\nExpected: HIRA residual 14 → band_signers = [COO].');
})();
