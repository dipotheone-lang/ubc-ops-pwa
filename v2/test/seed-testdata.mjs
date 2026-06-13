/** seed-testdata.mjs — fill every module with test data (tagged @ubcsis.test).
 *   node v2/test/seed-testdata.mjs <execUrl>
 * Cleanup later: POST admin.purgeTestData (deletes everything created_by *@ubcsis.test).
 */
const exec = process.argv[2];
async function p(o, n) {
  for (let i = 0; i < (n || 6); i++) {
    try { const r = await fetch(exec, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(o) }); return JSON.parse(await r.text()); }
    catch (e) { await new Promise(s => setTimeout(s, 2500)); }
  }
  return { ok: false, err: 'network' };
}
let adminTok; const U = {}; let n = 0;
const log = (m) => console.log(m);
async function mkUser(key, name, role) {
  const email = key + '@ubcsis.test';
  const r = await p({ action: 'admin.user.create', token: adminTok, record: { email, full_name_en: name, full_name_ar: name, role_code: role } });
  if (!r.data) { log('  user ' + email + ' FAILED ' + JSON.stringify(r.error)); return; }
  const l = await p({ action: 'auth.login', email, password: r.data.temporary_password });
  U[key] = { id: r.data.user.id, token: l.data && l.data.token };
}
async function mk(token, action, record) { const r = await p({ action, token, record }); if (r.data) n++; else log('  ' + action + ' ERR ' + JSON.stringify(r.error)); return r.data; }
async function submit(token, entity, id, pid) { const r = await p({ action: 'doc.submit', token, entity, id, project_id: pid }); return r.data && r.data.request && r.data.request.id; }
async function approve(token, reqId) { return p({ action: 'approvals.decide', token, request_id: reqId, decision: 'approve', comment: 'Approved (test)' }); }
const T = (k) => U[k] && U[k].token;
const pick = (a, i) => a[i % a.length];

(async () => {
  const al = await p({ action: 'auth.login', email: 'admin@ubcsis.com', password: 'UbcAdmin#2026' });
  adminTok = al.data && al.data.token; if (!adminTok) { log('admin login failed'); return; }
  log('creating test users…');
  for (const u of [['tester', 'Test Admin', 'ADMIN'], ['ceo', 'Test CEO', 'CEO'], ['coo', 'Test COO', 'COO'], ['cfo', 'Test CFO', 'CFO'],
    ['cm', 'Test Construction Mgr', 'CONSTRUCTION_MGR'], ['pmgr', 'Test Procurement Mgr', 'PROCUREMENT_MGR'], ['tpm', 'Test TPM Head', 'TPM_HEAD'],
    ['hse', 'Test HSE Mgr', 'HSE_MGR'], ['hr', 'Test HR Mgr', 'HR_MGR'], ['pts', 'Test PTS Head', 'PTS_HEAD'], ['pm', 'Test PM', 'PROJECT_MGR']]) await mkUser(...u);
  const TK = T('tester');
  log('users done. seeding masters…');

  // suppliers
  const sups = [];
  for (const s of [['El Sewedy Electric', 'cables'], ['ABB Egypt', 'electrical'], ['Schneider', 'switchgear'], ['Misr Steel', 'steel'], ['Sika Egypt', 'chemicals'], ['Hilti', 'tools']])
    sups.push(await mk(TK, 'masters.supplier.create', { name_en: s[0], name_ar: s[0], category: s[1] }));
  // clients (a couple test ones)
  const cl = await p({ action: 'list', token: TK, entity: 'clients' });
  const clientId = (cl.data && cl.data[0] && cl.data[0].id);
  // projects (provision Drive)
  log('creating projects (Drive provisioning)…');
  const projs = [];
  for (const pj of [['Ain Sokhna Tank Farm', 'PO-77012', 'chemicals'], ['Suez Steel Mill Upgrade', 'PO-4093', 'steel'], ['KNAUF Warehouse Fit-out', 'PO-301329', 'construction']]) {
    const pr = await mk(TK, 'masters.project.create', { name_en: pj[0], name_ar: pj[0], client_id: clientId, client_ref: pj[1], sector: pj[2], contract_value: 2500000 + n * 1000, currency: 'EGP', status: 'Active' });
    if (pr) projs.push(pr.id);
  }
  const P = (i) => pick(projs, i);
  const supId = (i) => sups[i % sups.length] && sups[i % sups.length].id;

  log('seeding procurement…');
  // MRs (one submitted+approved at 50k via CM+ProcMgr)
  for (let i = 0; i < 5; i++) {
    const mr = await mk(TK, 'procurement.mr.create', { project_id: P(i), priority: pick(['Normal', 'High', 'Urgent'], i), cost_code: 'CC-' + (100 + i),
      lines: [{ description: 'Cement OPC', unit: 'bag', qty: 100, est_unit_price: 200 }, { description: 'Rebar 16mm', unit: 'ton', qty: 1, est_unit_price: 30000 }] });
    if (i === 0 && mr) { const rq = await submit(TK, 'material_requisitions', mr.header.id, P(i)); if (rq) { await approve(T('cm'), rq); await approve(T('pmgr'), rq); } }
  }
  // POs
  for (let i = 0; i < 4; i++) await mk(TK, 'procurement.po.create', { project_id: P(i), supplier_id: supId(i), order_date: '2026-05-1' + i,
    lines: [{ description: 'Valves DN100', unit: 'pc', qty: 10, unit_price: 4500 }, { description: 'Gaskets', unit: 'set', qty: 20, unit_price: 300 }] });

  log('seeding warehouse…');
  for (let i = 0; i < 3; i++) await mk(TK, 'wh.grn.create', { project_id: P(i), supplier_id: supId(i), received_date: '2026-05-2' + i, condition: 'Good',
    lines: [{ item_code: 'CEM-001', description: 'Cement OPC', unit: 'bag', qty_ordered: 100, qty_received: 100, qty_accepted: 100 }, { item_code: 'VLV-100', description: 'Valve DN100', unit: 'pc', qty_ordered: 10, qty_received: 10, qty_accepted: 9 }] });
  for (let i = 0; i < 2; i++) await mk(TK, 'wh.miv.create', { project_id: P(i), issue_date: '2026-05-2' + i, issued_to: 'Site Team ' + i, purpose: 'Installation', lines: [{ item_code: 'CEM-001', description: 'Cement OPC', unit: 'bag', qty: 25 }] });
  for (const it of [['STL-016', 'Rebar 16mm', 'ton', 40, 10], ['PNT-001', 'Epoxy paint', 'L', 200, 50], ['PPE-001', 'Safety helmets', 'pc', 12, 30]])
    await mk(TK, 'wh.stock.upsert', { project_id: P(0), item_code: it[0], description: it[1], unit: it[2], qty_on_hand: it[3], min_level: it[4] });

  log('seeding finance…');
  // PV cheque 100k submitted+approved via CEO+CFO
  for (let i = 0; i < 4; i++) {
    const pv = await mk(TK, 'fin.pv.create', { project_id: P(i), supplier_id: supId(i), payee: 'Supplier ' + i, payment_method: pick(['Cheque', 'Bank Transfer', 'Cash'], i), amount: 50000 + i * 30000, invoice_ref: 'INV-' + i, description: 'Materials payment' });
    if (i === 0 && pv) { const rq = await submit(TK, 'payment_vouchers', pv.id, P(i)); if (rq) { await approve(T('ceo'), rq); await approve(T('cfo'), rq); } }
  }
  for (let i = 0; i < 3; i++) await mk(TK, 'fin.rv.create', { project_id: P(i), client_id: clientId, payer: 'Galaxy Chemicals', amount: 200000 + i * 50000, method: 'Bank Transfer', reference: 'RCPT-' + i, wht_amount: 2000, retention_amount: 10000 });
  for (let i = 0; i < 5; i++) {
    const ex = await mk(TK, 'fin.expense.create', { project_id: P(i), expense_date: '2026-05-0' + (i + 1), category: pick(['Materials', 'Transport', 'Labor', 'Permits', 'Misc'], i), amount: 1500 + i * 800, payment_method: 'Cash', vendor: 'Local vendor ' + i, description: 'Site expense' });
    if (i === 0 && ex) { const rq = await submit(TK, 'expenses', ex.id, P(i)); if (rq) { await approve(T('cm'), rq); await approve(T('pmgr'), rq); } }
  }

  log('seeding technical office…');
  for (let i = 0; i < 2; i++) {
    const ch = await mk(TK, 'tech.charter.create', { project_id: P(i), objectives: 'Deliver scope on time/budget', scope: 'Civil + MEP works', budget: 3000000, start_date: '2026-06-01', end_date: '2026-12-31' });
    if (i === 0 && ch) { const rq = await submit(TK, 'project_charters', ch.id, P(i)); if (rq) { await approve(T('tpm'), rq); await approve(T('coo'), rq); } }
  }
  for (let i = 0; i < 3; i++) {
    const vo = await mk(TK, 'tech.vor.create', { project_id: P(i), title: 'Added drainage works ' + i, type: 'Addition', amount: 120000 + i * 40000, time_impact_days: 5 + i, description: 'Client-requested scope addition' });
    if (i === 0 && vo) { const rq = await submit(TK, 'variation_orders', vo.id, P(i)); if (rq) await approve(T('pm'), rq); }
  }
  for (let i = 0; i < 2; i++) await mk(TK, 'tech.ipc.create', { project_id: P(i), client_id: clientId, period: 'May 2026', gross_amount: 800000 + i * 100000, advance_recovery: 80000, retention: 40000 });
  const ncrIds = [];
  for (let i = 0; i < 3; i++) { const nc = await mk(TK, 'tech.ncr.create', { project_id: P(i), category: pick(['Minor', 'Major', 'Critical'], i), description: 'Weld porosity at joint ' + i, location: 'Area ' + i }); if (nc) ncrIds.push(nc.id); }
  if (ncrIds[0]) await p({ action: 'tech.ncr.dispose', token: T('tpm'), id: ncrIds[0], disposition: 'Rework', root_cause: 'Procedure deviation' });

  log('seeding BD / tendering / construction / correspondence / prequal…');
  const opps = [];
  for (let i = 0; i < 5; i++) { const o = await mk(TK, 'bd.opp.create', { client_id: clientId, title: 'Opportunity ' + i + ' — plant maintenance', sector: 'chemicals', estimated_value: 1000000 + i * 500000, stage: pick(['Lead', 'Qualified', 'Proposal', 'Negotiation'], i), probability: 20 + i * 15, source: 'Referral' }); if (o) opps.push(o.id); }
  for (let i = 0; i < 4; i++) await mk(TK, 'bd.interaction.create', { opportunity_id: opps[i % opps.length], client_id: clientId, type: pick(['Call', 'Meeting', 'Site Visit', 'Email'], i), interaction_date: '2026-05-1' + i, contact_name: 'Eng. Contact ' + i, summary: 'Discussed scope and timeline', next_action: 'Send proposal' });
  for (let i = 0; i < 3; i++) {
    const td = await mk(TK, 'pts.tender.create', { client_id: clientId, title: 'Tender ' + i + ' — EPC works', scope: 'Supply & install', estimated_value: 800000 + i * 5000000, submission_deadline: '2026-06-2' + i, go_decision: 'Go', lines: [{ description: 'Civil', qty: 1, unit_cost: 500000 }, { description: 'MEP', qty: 1, unit_cost: 300000 }] });
    if (i === 0 && td) { const rq = await submit(TK, 'tenders', td.header.id); if (rq) await approve(T('pts'), rq); }
  }
  for (let i = 0; i < 4; i++) await mk(TK, 'con.dsr.create', { project_id: P(i), report_date: '2026-05-2' + i, weather: 'Clear', manpower_count: 20 + i * 5, equipment_count: 4 + i, progress_pct: 30 + i * 12, activities: 'Concrete pouring, steel erection', delays: i === 2 ? 'Material delivery delay' : '' });
  for (let i = 0; i < 2; i++) await mk(TK, 'con.si.create', { project_id: P(i), instruction_date: '2026-05-1' + i, issued_to: 'Subcontractor', subject: 'Rework cladding alignment', details: 'Align per drawing rev B' });
  for (let i = 0; i < 3; i++) await mk(TK, 'corr.create', { type: pick(['Delegation', 'PaymentDemand', 'General'], i), project_id: P(i), recipient: 'شركة جالاكسي', subject_ar: 'مطالبة بمستحقات', body_ar: 'نفيد سيادتكم بطلب صرف المستحقات المالية...', reference: 'REF-' + i, letter_date: '2026-05-1' + i });
  for (let i = 0; i < 3; i++) await mk(TK, 'prequal.create', { client_id: clientId, submitted_date: '2026-04-1' + i, portal: pick(['Etimad', 'GIZ e-Tender', 'SCZONE'], i), scope: 'Industrial contracting', status: pick(['Submitted', 'Approved', 'Draft'], i) });

  log('seeding HR / assets / HSE…');
  const emps = [];
  for (const e of [['Mohamed Adel', 'Site Engineer', 'Operations'], ['Sara Hassan', 'Accountant', 'Finance'], ['Khaled Omar', 'Foreman', 'Operations'], ['Nour Ali', 'QA/QC Engineer', 'Quality'], ['Tarek Said', 'Storekeeper', 'Warehouse'], ['Hana Yousef', 'HR Officer', 'HR']]) {
    const em = await mk(TK, 'hr.employee.create', { full_name_en: e[0], full_name_ar: e[0], title: e[1], department: e[2], contract_type: 'Permanent', basic_salary: 9000 + n * 100, hire_date: '2024-01-15' }); if (em) emps.push(em.id);
  }
  for (let i = 0; i < 3; i++) {
    const lv = await mk(TK, 'hr.leave.create', { employee_id: emps[i % emps.length], type: pick(['Annual', 'Sick', 'Casual'], i), from_date: '2026-06-0' + (i + 1), to_date: '2026-06-0' + (i + 4), reason: 'Personal' });
    if (i === 0 && lv) { const rq = await submit(TK, 'leave_requests', lv.id); if (rq) await approve(T('hr'), rq); }
  }
  for (let i = 0; i < 3; i++) await mk(TK, 'hr.timesheet.create', { employee_id: emps[i % emps.length], project_id: P(i), period: '2026-05', days_worked: 24, ot_hours: 6 + i });
  for (let i = 0; i < 2; i++) await mk(TK, 'hr.appraisal.create', { employee_id: emps[i], period: '2026-H1', rating: pick(['3', '4', '5'], i), strengths: 'Reliable, technically strong', improvements: 'Reporting cadence' });
  const assets = [];
  for (const a of [['Tower Crane TC-1', 'Heavy Equipment'], ['Toyota Hilux', 'Vehicle'], ['Welding Machine', 'Tools'], ['Total Station', 'Survey'], ['Generator 250kVA', 'Heavy Equipment']]) {
    const as = await mk(TK, 'asset.create', { name: a[0], category: a[1], serial_no: 'SN-' + n, acquisition_date: '2023-03-01', cost: 200000 + n * 5000, location: 'Sokhna Yard', project_id: P(0) }); if (as) assets.push(as.id);
  }
  for (let i = 0; i < 3; i++) await mk(TK, 'asset.maintenance.create', { asset_id: assets[i % assets.length], type: pick(['Preventive', 'Corrective', 'Inspection'], i), mnt_date: '2026-05-0' + (i + 1), description: 'Routine service', cost: 1500 + i * 500, next_due: '2026-08-01' });
  for (let i = 0; i < 2; i++) await mk(TK, 'asset.calibration.create', { asset_id: assets[3], cert_no: 'CAL-' + i, calibrated_date: '2026-01-10', due_date: '2027-01-10' });
  for (let i = 0; i < 3; i++) {
    const h = await mk(TK, 'hse.hira.create', { project_id: P(i), activity: pick(['Hot work', 'Working at height', 'Crane lift'], i), hazards: 'Fire / fall / dropped load', risk_score: 12 + i, controls: 'Permit, PPE, barriers', residual_score: pick([6, 9, 14], i) });
    if (i === 1 && h) { const rq = await submit(TK, 'hira', h.id, P(i)); if (rq) await approve(T('hse'), rq); }
  }
  for (let i = 0; i < 3; i++) { const pm = await mk(TK, 'hse.permit.create', { project_id: P(i), type: pick(['Hot Work', 'Confined Space', 'Excavation'], i), valid_from: '2026-05-2' + i, valid_to: '2026-05-2' + (i + 1), issued_to: 'Crew ' + i }); if (i === 0 && pm) { const rq = await submit(TK, 'permits', pm.id, P(i)); if (rq) await approve(T('hse'), rq); } }
  const incs = [];
  for (let i = 0; i < 3; i++) { const ic = await mk(TK, 'hse.incident.create', { project_id: P(i), incident_date: '2026-05-1' + i, type: pick(['Near Miss', 'First Aid', 'Environmental'], i), severity: pick(['Low', 'Medium', 'High'], i), description: 'Minor incident description' }); if (ic) incs.push(ic.id); }
  if (incs[0]) await p({ action: 'hse.incident.investigate', token: T('hse'), id: incs[0], root_cause: 'Housekeeping', corrective_action: 'Toolbox talk + barriers' });
  for (let i = 0; i < 2; i++) await mk(TK, 'hse.inspection.create', { project_id: P(i), inspection_date: '2026-05-1' + i, area: 'Fabrication yard', findings: 'Good housekeeping; 2 minor obs', score: 88 + i });

  log('\nDONE. ~' + n + ' records created across all modules (tagged @ubcsis.test).');
})();
