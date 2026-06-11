/**
 * Tests.gs — in-editor test suite for the v2 Foundation.
 * Run runAllTests() against a SCRATCH spreadsheet. Tests create + clean up
 * their own users/assignments/approvals.
 */
function runAllTests() {
  initializeWorkbook(); // idempotent
  var tests = [t_doaResolution, t_passwordHash, t_loginLockout, t_rbac, t_approvalChain, t_approvalSoD,
    t_phase2Procurement, t_phase2GrnStock];
  var out = [];
  for (var i = 0; i < tests.length; i++) {
    try { tests[i](); out.push('PASS  ' + tests[i].name); }
    catch (e) { out.push('FAIL  ' + tests[i].name + '  -> ' + (e.message || e)); }
  }
  var s = out.join('\n'); Logger.log(s); return s;
}
function assert_(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertEq_(a, b, m) { if (String(a) !== String(b)) throw new Error((m || 'neq') + ' (' + a + '!=' + b + ')'); }
function assertThrows_(fn, code) { try { fn(); } catch (e) { if (code && e.code !== code) throw new Error('want ' + code + ' got ' + e.code); return; } throw new Error('expected throw'); }

function mkUser_(role) {
  var u = dbInsert('users', { email: 'test_' + role + '_' + Date.now() + Math.floor(Math.random() * 999) + '@t.co',
    full_name_en: 'T ' + role, active: 'TRUE', default_lang: 'en', must_reset: 'FALSE' }, 'test');
  assignRole(u.id, role, 'GLOBAL', '', 'test');
  return { user: { id: u.id, email: u.email }, roles: getUserRoles(u.id), _id: u.id };
}
function rmUser_(ctx) {
  dbList('role_assignments', { user_id: ctx._id }).forEach(function (r) { dbDelete('role_assignments', r.id); });
  dbDelete('users', ctx._id);
}

function t_doaResolution() {
  var b1 = resolveBand('procurement', 'commit', 10000); assert_(b1 && Number(b1.min_amount) === 0, 'band ≤25k');
  var b2 = resolveBand('procurement', 'commit', 50000); assert_(b2 && Number(b2.min_amount) === 25001, 'band 25-100k');
  var b3 = resolveBand('procurement', 'commit', 9999999); assert_(b3 && Number(b3.min_amount) === 2000001, 'band >2M');
  var v = resolveBand('vor', 'approve', 3000000); assert_(JSON.parse(v.signer_chain_json)[0].roles[0] === 'COO', 'VOR 1-5M COO');
}

function t_passwordHash() {
  var salt = randomSalt();
  var h1 = hashPassword('Secret123', salt), h2 = hashPassword('Secret123', salt);
  assertEq_(h1, h2, 'deterministic');
  assert_(h1 !== hashPassword('Secret124', salt), 'sensitive');
  assert_(constantTimeEq(h1, h2) && !constantTimeEq(h1, 'x'), 'ct compare');
}

function t_loginLockout() {
  var u = dbInsert('users', { email: 'lock_' + Date.now() + '@t.co', full_name_en: 'Lock', active: 'TRUE', default_lang: 'en' }, 'test');
  setUserPassword(u.id, 'GoodPass1', { actor: 'test' });
  var res = login(u.email, 'GoodPass1', {}); assert_(res.token, 'login token');
  var who = authenticate(res.token); assertEq_(who.user.id, u.id, 'session resolves');
  logout(res.token);
  assertThrows_(function () { authenticate(res.token); }, 'NO_SESSION');
  for (var i = 0; i < CONFIG.MAX_FAILED_LOGINS; i++) { try { login(u.email, 'wrong', {}); } catch (e) {} }
  assertThrows_(function () { login(u.email, 'GoodPass1', {}); }, 'LOCKED');
  // cleanup
  dbList('sessions', { user_id: u.id }).forEach(function (s) { dbDelete('sessions', s.id); });
  dbDelete('users', u.id);
}

function t_rbac() {
  var admin = mkUser_('ADMIN'), emp = mkUser_('EMPLOYEE');
  assert_(can(admin, { module: 'admin', entity: 'users', action: 'create' }), 'admin can create users');
  assert_(can(emp, { module: 'masters', entity: 'projects', action: 'view' }), 'employee can view projects');
  assert_(!can(emp, { module: 'admin', entity: 'users', action: 'create' }), 'employee cannot create users');
  assert_(!can(emp, { module: 'masters', entity: 'clients', action: 'create' }), 'employee cannot create clients');
  rmUser_(admin); rmUser_(emp);
}

function t_approvalChain() {
  var client = dbInsert('clients', { client_code: 'TST', name_en: 'Test Client', status: 'Active' }, 'test');
  var initiator = mkUser_('SITE_ENGINEER'), cm = mkUser_('CONSTRUCTION_MGR'), pm = mkUser_('PROCUREMENT_MGR');
  var created = createApprovalRequest({ domain: 'procurement', action: 'commit', entity: 'test_po',
    record_id: 'rec1', amount: 50000, currency: 'EGP', initiator_user: initiator.user.id }, 'test');
  assertEq_(created.request.total_steps, 1, 'one step');
  assertEq_(created.steps[0].mode, 'all', 'mode all');
  // CM approves (partial — needs both CM and ProcMgr)
  var r1 = decideApproval(created.request.id, cm, 'approve', 'ok');
  assertEq_(r1.request.status, 'Pending', 'still pending after 1 of 2');
  // ProcMgr approves → complete
  var r2 = decideApproval(created.request.id, pm, 'approve', 'ok');
  assertEq_(r2.request.status, 'Approved', 'approved after both');
  // cleanup
  dbList('approval_steps', { request_id: created.request.id }).forEach(function (s) { dbDelete('approval_steps', s.id); });
  dbDelete('approval_requests', created.request.id);
  rmUser_(initiator); rmUser_(cm); rmUser_(pm); dbDelete('clients', client.id);
}

function t_phase2Procurement() {
  var client = dbInsert('clients', { client_code: 'P2', name_en: 'P2 Client', status: 'Active' }, 'test');
  var proj = dbInsert('projects', { project_code: 'P2-PRJ', client_id: client.id, name_en: 'P2 Proj', status: 'Active', currency: 'EGP' }, 'test');
  var pm = mkUser_('SITE_ENGINEER');
  var res = Procurement.createMR({ project_id: proj.id, required_date: '2026-02-01', lines: [
    { description: 'Cement', unit: 'bag', qty: 100, est_unit_price: 300 },
    { description: 'Steel', unit: 'ton', qty: 1, est_unit_price: 20000 }] }, pm);
  assertEq_(res.header.est_total, 50000, 'MR est_total');
  assertEq_(res.lines.length, 2, 'MR lines stored');
  var sub = submitDocument('material_requisitions', res.header.id, pm);
  assertEq_(dbGet('material_requisitions', res.header.id).status, 'Submitted', 'MR submitted');
  // 50k → band needs CONSTRUCTION_MGR + PROCUREMENT_MGR (all)
  var cm = mkUser_('CONSTRUCTION_MGR'), pmgr = mkUser_('PROCUREMENT_MGR');
  decideApproval(sub.request.id, cm, 'approve', 'ok');
  assertEq_(dbGet('material_requisitions', res.header.id).status, 'Submitted', 'still submitted after 1 of 2');
  var r2 = decideApproval(sub.request.id, pmgr, 'approve', 'ok');
  assertEq_(r2.request.status, 'Approved', 'approval complete');
  assertEq_(dbGet('material_requisitions', res.header.id).status, 'Approved', 'MR status flipped via outcome hook');
  dbList('mr_lines', { mr_id: res.header.id }).forEach(function (l) { dbDelete('mr_lines', l.id); });
  dbList('approval_steps', { request_id: sub.request.id }).forEach(function (s) { dbDelete('approval_steps', s.id); });
  dbDelete('approval_requests', sub.request.id); dbDelete('material_requisitions', res.header.id);
  rmUser_(pm); rmUser_(cm); rmUser_(pmgr); dbDelete('projects', proj.id); dbDelete('clients', client.id);
}

function t_phase2GrnStock() {
  var client = dbInsert('clients', { client_code: 'P2B', name_en: 'P2B', status: 'Active' }, 'test');
  var proj = dbInsert('projects', { project_code: 'P2B-PRJ', client_id: client.id, name_en: 'P2B Proj', status: 'Active' }, 'test');
  var sk = mkUser_('STOREKEEPER');
  Warehouse.createGRN({ project_id: proj.id, received_date: '2026-02-02', condition: 'Good', lines: [
    { item_code: 'CEM-001', description: 'Cement', unit: 'bag', qty_ordered: 100, qty_received: 100, qty_accepted: 100 }] }, sk);
  var stock = dbList('stock_items', { project_id: proj.id, item_code: 'CEM-001' });
  assertEq_(stock.length, 1, 'stock item created from GRN');
  assertEq_(stock[0].qty_on_hand, 100, 'stock on hand from accepted qty');
  // issue 30 → on hand 70
  Warehouse.createMIV({ project_id: proj.id, issue_date: '2026-02-03', issued_to: 'Site A', lines: [
    { item_code: 'CEM-001', description: 'Cement', unit: 'bag', qty: 30 }] }, sk);
  assertEq_(dbList('stock_items', { project_id: proj.id, item_code: 'CEM-001' })[0].qty_on_hand, 70, 'stock decremented by MIV');
  // cleanup
  dbList('stock_items', { project_id: proj.id }).forEach(function (s) { dbDelete('stock_items', s.id); });
  ['goods_received_notes', 'grn_lines', 'material_issues', 'miv_lines'].forEach(function (e) {
    dbList(e).forEach(function (r) { if (String(r.project_id) === String(proj.id) || true) { /* lines lack project_id */ } });
  });
  rmUser_(sk); dbDelete('projects', proj.id); dbDelete('clients', client.id);
}

function t_approvalSoD() {
  var initiator = mkUser_('CONSTRUCTION_MGR'); // initiator also holds an approver role
  var created = createApprovalRequest({ domain: 'procurement', action: 'commit', entity: 'test_po',
    record_id: 'rec2', amount: 10000, currency: 'EGP', initiator_user: initiator.user.id }, 'test');
  // band ≤25k needs SITE_ENGINEER + CONSTRUCTION_MGR; initiator is CM but is the initiator → SoD blocks
  assertThrows_(function () { decideApproval(created.request.id, initiator, 'approve', 'x'); }, 'SOD_VIOLATION');
  dbList('approval_steps', { request_id: created.request.id }).forEach(function (s) { dbDelete('approval_steps', s.id); });
  dbDelete('approval_requests', created.request.id);
  rmUser_(initiator);
}
