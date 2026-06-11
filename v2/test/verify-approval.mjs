/** verify-approval.mjs — live end-to-end DoA approval on the deployed app.
 *   node v2/test/verify-approval.mjs <execUrl>
 * Uses a Submitted MR (50,000 EGP → needs CONSTRUCTION_MGR + PROCUREMENT_MGR).
 */
const exec = process.argv[2];
async function p(o) {
  const r = await fetch(exec, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(o) });
  try { return JSON.parse(await r.text()); } catch (e) { return { ok: false }; }
}
const tok = async (e, pw) => { const l = await p({ action: 'auth.login', email: e, password: pw }); return l.data && l.data.token; };
const line = (n, o) => console.log(n.padEnd(30), JSON.stringify(o));
(async () => {
  const admin = await tok('admin@ubcsis.com', 'UbcAdmin#2026');
  let mrs = await p({ action: 'list', token: admin, entity: 'material_requisitions' });
  const mr = (mrs.data || []).find(m => m.approval_id);
  if (!mr) { console.log('No submitted MR found.'); return; }
  line('MR', { num: mr.mr_number, status: mr.status });
  const reqId = mr.approval_id;
  let ap = await p({ action: 'approvals.get', token: admin, request_id: reqId });
  line('band step-1 signers', JSON.parse(ap.data.steps[0].roles_json));
  // Segregation of duties: initiator (admin) must be blocked
  let sod = await p({ action: 'approvals.decide', token: admin, request_id: reqId, decision: 'approve' });
  line('admin self-approve (SoD)', { ok: sod.ok, code: sod.error && sod.error.code });
  // First signer: Construction Manager
  const cm = await tok('construction@ubcsis.com', '767ad2ffA1');
  let d1 = await p({ action: 'approvals.decide', token: cm, request_id: reqId, decision: 'approve', comment: 'CM approves' });
  line('CM approve (1 of 2)', { ok: d1.ok, request_status: d1.data && d1.data.request.status });
  // Second signer: Procurement Manager
  const pm = await tok('procurement@ubcsis.com', 'e7a3d380A1');
  let d2 = await p({ action: 'approvals.decide', token: pm, request_id: reqId, decision: 'approve', comment: 'Proc approves' });
  line('ProcMgr approve (2 of 2)', { ok: d2.ok, request_status: d2.data && d2.data.request.status });
  // Outcome hook should have flipped the MR status
  let got = await p({ action: 'get', token: admin, entity: 'material_requisitions', id: mr.id });
  line('MR final status', { status: got.data && got.data.status });
})();
