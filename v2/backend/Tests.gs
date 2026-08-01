/**
 * Tests.gs — in-editor test suite for the v2 Foundation.
 * Run runAllTests() against a SCRATCH spreadsheet. Tests create + clean up
 * their own users/assignments/approvals.
 */
function runAllTests() {
  initializeWorkbook(); // idempotent
  var tests = [t_doaResolution, t_passwordHash, t_loginLockout, t_rbac, t_sanitizeCell, t_uploadRbac,
    t_ownScope, t_mivStockGuard, t_docNumberNoWrap,
    t_approvalChain, t_approvalSoD, t_phase2Procurement, t_phase2GrnStock,
    t_financePV, t_financeDocs, t_correspondence, t_bd, t_construction, t_hrLeave, t_assets,
    t_phase3Tender, t_phase4HseRisk];
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

function t_sanitizeCell() {
  assertEq_(sanitizeCell_('=1+1'), "'=1+1", 'formula = escaped');
  assertEq_(sanitizeCell_('@SUM(A1)'), "'@SUM(A1)", 'formula @ escaped');
  assertEq_(sanitizeCell_('+cmd|calc'), "'+cmd|calc", 'plus-text escaped');
  assertEq_(sanitizeCell_('-IMPORTXML("x","y")'), "'-IMPORTXML(\"x\",\"y\")", 'minus-formula escaped');
  assertEq_(sanitizeCell_('-12.5'), '-12.5', 'negative number kept');
  assertEq_(sanitizeCell_('+3%'), '+3%', 'positive percent kept');
  assertEq_(sanitizeCell_('hello world'), 'hello world', 'plain text kept');
  assertEq_(sanitizeCell_(42), 42, 'numeric value passthrough');
}

function t_uploadRbac() {
  var proj = dbInsert('projects', { code: 'UPLT', name_en: 'Upload Test Project', status: 'Active' }, 'test');
  var PID = proj.id;
  // STOREKEEPER holds warehouse writes only for its assigned project (PROJECT scope).
  var sk = dbInsert('users', { email: 'test_sk_' + Date.now() + '@t.co', full_name_en: 'SK',
    active: 'TRUE', default_lang: 'en', must_reset: 'FALSE' }, 'test');
  assignRole(sk.id, 'STOREKEEPER', 'PROJECT', PID, 'test');
  var skCtx = { user: { id: sk.id, email: sk.email }, roles: getUserRoles(sk.id) };
  assert_(canUploadTo(skCtx, 'warehouse', PID), 'storekeeper can upload to own project warehouse slot');
  assert_(!canUploadTo(skCtx, 'warehouse', 'other-project'), 'storekeeper blocked on a different project');
  assert_(!canUploadTo(skCtx, 'finance', PID), 'storekeeper has no finance write capability');
  // EMPLOYEE is view-only → cannot upload anywhere.
  var emp = mkUser_('EMPLOYEE');
  assert_(!canUploadTo(emp, 'construction', PID), 'view-only employee cannot upload');
  rmUser_(emp);
  dbList('role_assignments', { user_id: sk.id }).forEach(function (r) { dbDelete('role_assignments', r.id); });
  dbDelete('users', sk.id);
  dbDelete('projects', PID);
}

function t_ownScope() {
  // EMPLOYEE holds hr/leave_requests 'view' only at OWN scope.
  var emp = mkUser_('EMPLOYEE');
  var mineEmp = dbInsert('employees', { emp_code: 'E-OWN', full_name_en: 'Owner', user_id: emp.user.id, status: 'Active' }, 'test');
  var otherEmp = dbInsert('employees', { emp_code: 'E-OTH', full_name_en: 'Other', status: 'Active' }, 'test');
  var mine = dbInsert('leave_requests', { leave_number: 'LV-1', employee_id: mineEmp.id, type: 'Annual', from_date: '2026-01-01', to_date: '2026-01-02', days: 2, status: 'Draft' }, 'test');
  var theirs = dbInsert('leave_requests', { leave_number: 'LV-2', employee_id: otherEmp.id, type: 'Annual', from_date: '2026-01-01', to_date: '2026-01-02', days: 2, status: 'Draft' }, 'test');
  var f = ownViewFilter_(emp, 'leave_requests');
  assert_(f, 'employee gets an OWN-scope filter for leave_requests');
  assertEq_(f.ownerId, mineEmp.id, 'owner resolved to the linked employee id');
  var rows = dbList('leave_requests').filter(f.match);
  assert_(rows.some(function (r) { return r.id === mine.id; }), 'sees own leave request');
  assert_(!rows.some(function (r) { return r.id === theirs.id; }), 'does not see another employee\'s leave');
  dbDelete('leave_requests', mine.id); dbDelete('leave_requests', theirs.id);
  dbDelete('employees', mineEmp.id); dbDelete('employees', otherEmp.id); rmUser_(emp);
}

function t_mivStockGuard() {
  var client = dbInsert('clients', { client_code: 'MG', name_en: 'MG', status: 'Active' }, 'test');
  var proj = dbInsert('projects', { project_code: 'MG-P', client_id: client.id, name_en: 'MG P', status: 'Active' }, 'test');
  var sk = mkUser_('STOREKEEPER');
  Warehouse.createGRN({ project_id: proj.id, received_date: '2026-02-02', lines: [
    { item_code: 'X1', description: 'X', unit: 'ea', qty_ordered: 10, qty_received: 10, qty_accepted: 10 }] }, sk);
  assertThrows_(function () { Warehouse.createMIV({ project_id: proj.id, issue_date: '2026-02-03', issued_to: 'A',
    lines: [{ item_code: 'X1', description: 'X', qty: 20 }] }, sk); }, 'INSUFFICIENT_STOCK');
  assertThrows_(function () { Warehouse.createMIV({ project_id: proj.id, issue_date: '2026-02-03', issued_to: 'A',
    lines: [{ item_code: 'NOPE', description: '?', qty: 1 }] }, sk); }, 'NO_STOCK');
  assertEq_(dbList('stock_items', { project_id: proj.id, item_code: 'X1' })[0].qty_on_hand, 10, 'stock intact after rejected issues');
  assertEq_(dbList('material_issues', { project_id: proj.id }).length, 0, 'no MIV persisted on failure');
  dbList('stock_items', { project_id: proj.id }).forEach(function (s) { dbDelete('stock_items', s.id); });
  dbList('goods_received_notes', { project_id: proj.id }).forEach(function (g) {
    dbList('grn_lines', { grn_id: g.id }).forEach(function (l) { dbDelete('grn_lines', l.id); });
    dbDelete('goods_received_notes', g.id);
  });
  rmUser_(sk); dbDelete('projects', proj.id); dbDelete('clients', client.id);
}

function t_docNumberNoWrap() {
  var year = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SEQ_ZZ_' + year, '9999');
  assertEq_(nextDocNumber('ZZ'), 'ZZ-' + year + '-10000', 'doc number grows past 9999 without truncation');
  props.setProperty('SEQ_ZZ_' + year, '0'); // reset scratch counter
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
  // cleanup — headers carry project_id; lines are reached via their parent id.
  dbList('stock_items', { project_id: proj.id }).forEach(function (s) { dbDelete('stock_items', s.id); });
  dbList('goods_received_notes', { project_id: proj.id }).forEach(function (g) {
    dbList('grn_lines', { grn_id: g.id }).forEach(function (l) { dbDelete('grn_lines', l.id); });
    dbDelete('goods_received_notes', g.id);
  });
  dbList('material_issues', { project_id: proj.id }).forEach(function (m) {
    dbList('miv_lines', { miv_id: m.id }).forEach(function (l) { dbDelete('miv_lines', l.id); });
    dbDelete('material_issues', m.id);
  });
  rmUser_(sk); dbDelete('projects', proj.id); dbDelete('clients', client.id);
}

function t_financePV() {
  var client = dbInsert('clients', { client_code: 'FPV', name_en: 'FPV Client', status: 'Active' }, 'test');
  var proj = dbInsert('projects', { project_code: 'FPV-PRJ', client_id: client.id, name_en: 'FPV Proj', status: 'Active', currency: 'EGP' }, 'test');
  var maker = mkUser_('EMPLOYEE'); // neutral initiator (SoD: can't be a signer)
  // Bank Transfer ≤250K routes to payment_transfer band {all: FINANCE_CONTROLLER + CFO}.
  var pv = Finance.createPV({ project_id: proj.id, amount: '100000', payment_method: 'Bank Transfer', payee: 'ACME' }, maker);
  assertEq_(pv.status, 'Draft', 'PV created as Draft');
  assertEq_(pv.amount, 100000, 'PV amount coerced to number');
  assertEq_(pv.currency, 'EGP', 'PV currency defaults to EGP');
  assert_(/^PV-/.test(pv.pv_number), 'PV has a PV- document number');
  var sub = submitDocument('payment_vouchers', pv.id, maker);
  assertEq_(dbGet('payment_vouchers', pv.id).status, 'Submitted', 'PV submitted');
  assertEq_(sub.request.domain, 'payment_transfer', 'transfer routing (not cheque)');
  assertEq_(sub.steps.length, 1, 'transfer ≤250K is a single all-mode step');
  var fc = mkUser_('FINANCE_CONTROLLER'), cfo = mkUser_('CFO');
  decideApproval(sub.request.id, fc, 'approve', 'maker ok');
  assertEq_(dbGet('payment_vouchers', pv.id).status, 'Submitted', 'still submitted after 1 of 2 signers');
  var done = decideApproval(sub.request.id, cfo, 'approve', 'cfo ok');
  assertEq_(done.request.status, 'Approved', 'approval completes with both signers');
  assertEq_(dbGet('payment_vouchers', pv.id).status, 'Approved', 'PV status flipped via approval outcome');
  dbList('approval_steps', { request_id: sub.request.id }).forEach(function (s) { dbDelete('approval_steps', s.id); });
  dbDelete('approval_requests', sub.request.id); dbDelete('payment_vouchers', pv.id);
  rmUser_(maker); rmUser_(fc); rmUser_(cfo); dbDelete('projects', proj.id); dbDelete('clients', client.id);
}

function t_financeDocs() {
  var client = dbInsert('clients', { client_code: 'FDX', name_en: 'FDX Client', status: 'Active' }, 'test');
  var proj = dbInsert('projects', { project_code: 'FDX-PRJ', client_id: client.id, name_en: 'FDX Proj', status: 'Active' }, 'test');
  var acc = mkUser_('EMPLOYEE');
  // Receipt voucher: terminal 'Recorded', numeric coercion, default method.
  var rv = Finance.createRV({ project_id: proj.id, client_id: client.id, payer: 'Client', amount: '50000', wht_amount: '2500', retention_amount: '5000' }, acc);
  assertEq_(rv.status, 'Recorded', 'RV recorded on create');
  assertEq_(rv.amount, 50000, 'RV amount numeric');
  assertEq_(rv.wht_amount, 2500, 'RV WHT numeric');
  assertEq_(rv.method, 'Bank Transfer', 'RV method defaults to Bank Transfer');
  assert_(/^RV-/.test(rv.rv_number), 'RV has an RV- number');
  // Expense: Draft, numeric amount.
  var ex = Finance.createExpense({ project_id: proj.id, expense_date: '2026-03-01', amount: '1200.50', category: 'Materials', vendor: 'Depot' }, acc);
  assertEq_(ex.status, 'Draft', 'expense created as Draft');
  assertEq_(ex.amount, 1200.5, 'expense amount numeric');
  assert_(/^EXP-/.test(ex.exp_number), 'expense has an EXP- number');
  dbDelete('receipt_vouchers', rv.id); dbDelete('expenses', ex.id);
  rmUser_(acc); dbDelete('projects', proj.id); dbDelete('clients', client.id);
}

function t_correspondence() {
  var author = mkUser_('EMPLOYEE');
  var letter = Correspondence.create({ type: 'General', recipient: 'Consultant',
    subject_ar: 'إشعار', body_ar: '=HYPERLINK("http://evil","x")' }, author);
  assertEq_(letter.status, 'Draft', 'letter created as Draft');
  assertEq_(letter.type, 'General', 'letter type preserved');
  assert_(/^COR-/.test(letter.letter_number), 'letter has a COR- number');
  // Free-text letter body must be neutralized against formula injection on write.
  assertEq_(String(dbGet('correspondence', letter.id).body_ar).charAt(0), "'", 'letter body formula is escaped');
  var issued = Correspondence.issue(letter.id, author);
  assertEq_(issued.status, 'Issued', 'letter issued');
  assertEq_(String(issued.signed_by), String(author.user.id), 'issuer recorded as signer');
  dbDelete('correspondence', letter.id); rmUser_(author);
}

function t_bd() {
  var client = dbInsert('clients', { client_code: 'BD', name_en: 'BD Client', status: 'Active' }, 'test');
  var bd = mkUser_('EMPLOYEE');
  var opp = BD.createOpportunity({ client_id: client.id, title: 'Metro Tender', estimated_value: '5000000', probability: '40' }, bd);
  assertEq_(opp.status, 'Open', 'opportunity opens as Open');
  assertEq_(opp.stage, 'Lead', 'opportunity default stage Lead');
  assertEq_(opp.estimated_value, 5000000, 'opportunity value coerced numeric');
  assertEq_(String(opp.owner_user), String(bd.user.id), 'owner defaults to creator');
  assert_(/^OPP-/.test(opp.opp_number), 'opportunity has OPP- number');
  assertEq_(BD.advanceOpportunity(opp.id, 'Qualified', bd).status, 'Open', 'non-terminal stage keeps status Open');
  assertEq_(BD.advanceOpportunity(opp.id, 'Won', bd).status, 'Won', 'stage Won sets status Won');
  var it = BD.logInteraction({ opportunity_id: opp.id, client_id: client.id, type: 'Meeting', interaction_date: '2026-03-02', summary: 'kickoff' }, bd);
  assert_(it.id, 'interaction logged');
  dbDelete('interactions', it.id); dbDelete('opportunities', opp.id); rmUser_(bd); dbDelete('clients', client.id);
}

function t_construction() {
  var client = dbInsert('clients', { client_code: 'CON', name_en: 'CON Client', status: 'Active' }, 'test');
  var proj = dbInsert('projects', { project_code: 'CON-PRJ', client_id: client.id, name_en: 'CON Proj', status: 'Active' }, 'test');
  var se = mkUser_('EMPLOYEE');
  var dsr = Construction.createDailyReport({ project_id: proj.id, report_date: '2026-03-01', weather: 'Clear',
    manpower_count: '12', equipment_count: '3', progress_pct: '30', activities: 'Excavation' }, se);
  assertEq_(dsr.manpower_count, 12, 'DSR manpower coerced numeric');
  assertEq_(dsr.progress_pct, 30, 'DSR progress coerced numeric');
  assert_(/^DSR-/.test(dsr.dsr_number), 'DSR has DSR- number');
  var si = Construction.createSiteInstruction({ project_id: proj.id, subject: 'Rework wall', issued_to: 'Foreman' }, se);
  assertEq_(si.status, 'Open', 'site instruction opens as Open');
  assert_(/^SI-/.test(si.si_number), 'SI has SI- number');
  dbDelete('daily_site_reports', dsr.id); dbDelete('site_instructions', si.id);
  rmUser_(se); dbDelete('projects', proj.id); dbDelete('clients', client.id);
}

function t_hrLeave() {
  var maker = mkUser_('EMPLOYEE');
  var emp = HR.createEmployee({ full_name_en: 'Worker' }, maker);
  assertEq_(emp.contract_type, 'Permanent', 'employee default contract Permanent');
  assertEq_(emp.status, 'Active', 'employee defaults to Active');
  assert_(/^EMP-/.test(emp.emp_code), 'employee auto emp_code');
  // Inclusive day count when days omitted: 01→05 March = 5 days.
  var lv = HR.createLeave({ employee_id: emp.id, type: 'Annual', from_date: '2026-03-01', to_date: '2026-03-05' }, maker);
  assertEq_(lv.days, 5, 'leave days computed inclusive');
  assertEq_(lv.status, 'Draft', 'leave created as Draft');
  var sub = submitDocument('leave_requests', lv.id, maker);
  assertEq_(dbGet('leave_requests', lv.id).status, 'Submitted', 'leave submitted');
  var hr = mkUser_('HR_MGR');
  var done = decideApproval(sub.request.id, hr, 'approve', 'ok');
  assertEq_(done.request.status, 'Approved', 'leave approved by HR manager');
  assertEq_(dbGet('leave_requests', lv.id).status, 'Approved', 'leave status flipped via outcome');
  var ts = HR.createTimesheet({ employee_id: emp.id, period: '2026-03', days_worked: '22', ot_hours: '5' }, maker);
  assertEq_(ts.days_worked, 22, 'timesheet days coerced numeric');
  assertEq_(ts.status, 'Draft', 'timesheet created as Draft');
  dbList('approval_steps', { request_id: sub.request.id }).forEach(function (s) { dbDelete('approval_steps', s.id); });
  dbDelete('approval_requests', sub.request.id);
  dbDelete('timesheets', ts.id); dbDelete('leave_requests', lv.id); dbDelete('employees', emp.id);
  rmUser_(maker); rmUser_(hr);
}

function t_assets() {
  var maker = mkUser_('EMPLOYEE');
  var asset = Assets.createAsset({ name: 'Excavator', category: 'Heavy Equipment', cost: '2500000', status: 'Under Maintenance' }, maker);
  assertEq_(asset.status, 'Under Maintenance', 'asset status preserved on create');
  assertEq_(asset.cost, 2500000, 'asset cost coerced numeric');
  assert_(/^AST-/.test(asset.asset_code), 'asset auto asset_code');
  // Corrective maintenance returns the asset to service (side-effect).
  var mnt = Assets.logMaintenance({ asset_id: asset.id, type: 'Corrective', mnt_date: '2026-03-03', cost: '12000' }, maker);
  assert_(/^MNT-/.test(mnt.mnt_number), 'maintenance MNT- number');
  assertEq_(dbGet('assets', asset.id).status, 'In Service', 'corrective maintenance returns asset to service');
  var cal = Assets.logCalibration({ asset_id: asset.id, calibrated_date: '2026-03-03', due_date: '2027-03-03', cert_no: 'C-1' }, maker);
  assertEq_(cal.status, 'Valid', 'calibration record marked Valid');
  assert_(/^CAL-/.test(cal.cal_number), 'calibration CAL- number');
  dbDelete('calibration_records', cal.id); dbDelete('maintenance_records', mnt.id); dbDelete('assets', asset.id); rmUser_(maker);
}

function t_phase3Tender() {
  var client = dbInsert('clients', { client_code: 'P3', name_en: 'P3 Client', status: 'Active' }, 'test');
  var initiator = mkUser_('BD_MGR');
  var res = Tendering.createTender({ client_id: client.id, title: 'Big Tender', estimated_value: 5000000, currency: 'EGP',
    lines: [{ description: 'Civil', qty: 1, unit_cost: 3000000 }, { description: 'MEP', qty: 1, unit_cost: 2000000 }] }, initiator);
  assertEq_(res.header.estimated_value, 5000000, 'tender value');
  assertEq_(res.lines.length, 2, 'cost lines');
  var sub = submitDocument('tenders', res.header.id, initiator);
  var roles = JSON.parse(sub.steps[0].roles_json);
  assert_(roles.indexOf('PTS_HEAD') !== -1 && roles.indexOf('CFO') !== -1, 'band = PTS_HEAD + CFO for 5M');
  var pts = mkUser_('PTS_HEAD'), cfo = mkUser_('CFO');
  decideApproval(sub.request.id, pts, 'approve', 'ok');
  var r2 = decideApproval(sub.request.id, cfo, 'approve', 'ok');
  assertEq_(r2.request.status, 'Approved', 'tender approval complete');
  assertEq_(dbGet('tenders', res.header.id).status, 'Approved', 'tender status flipped');
  dbList('tender_costlines', { tender_id: res.header.id }).forEach(function (l) { dbDelete('tender_costlines', l.id); });
  dbList('approval_steps', { request_id: sub.request.id }).forEach(function (s) { dbDelete('approval_steps', s.id); });
  dbDelete('approval_requests', sub.request.id); dbDelete('tenders', res.header.id);
  rmUser_(initiator); rmUser_(pts); rmUser_(cfo); dbDelete('clients', client.id);
}

function t_phase4HseRisk() {
  // band resolution by residual risk score
  assertEq_(JSON.parse(resolveBand('hse_risk', 'approve', 5).signer_chain_json)[0].roles[0], 'PROJECT_MGR', 'risk 5 → PM');
  assertEq_(JSON.parse(resolveBand('hse_risk', 'approve', 9).signer_chain_json)[0].roles[0], 'HSE_MGR', 'risk 9 → HSE_MGR');
  assertEq_(JSON.parse(resolveBand('hse_risk', 'approve', 14).signer_chain_json)[0].roles[0], 'COO', 'risk 14 → COO');
  assertEq_(JSON.parse(resolveBand('hse_risk', 'approve', 20).signer_chain_json)[0].roles[0], 'CEO', 'risk 20 → CEO');
  // HIRA at residual 9 → submit → HSE_MGR approves → Approved
  var client = dbInsert('clients', { client_code: 'P4', name_en: 'P4', status: 'Active' }, 'test');
  var proj = dbInsert('projects', { project_code: 'P4-PRJ', client_id: client.id, name_en: 'P4 Proj', status: 'Active' }, 'test');
  var eng = mkUser_('SITE_ENGINEER'), hseMgr = mkUser_('HSE_MGR');
  var h = HSE.createHIRA({ project_id: proj.id, activity: 'Hot work near tank', hazards: 'Fire', residual_score: 9, controls: 'Permit + watch' }, eng);
  var sub = submitDocument('hira', h.id, eng);
  assertEq_(JSON.parse(sub.steps[0].roles_json)[0], 'HSE_MGR', 'HIRA score 9 routes to HSE_MGR');
  var r = decideApproval(sub.request.id, hseMgr, 'approve', 'controls adequate');
  assertEq_(r.request.status, 'Approved', 'HIRA approved by HSE_MGR');
  assertEq_(dbGet('hira', h.id).status, 'Approved', 'HIRA status flipped');
  dbList('approval_steps', { request_id: sub.request.id }).forEach(function (s) { dbDelete('approval_steps', s.id); });
  dbDelete('approval_requests', sub.request.id); dbDelete('hira', h.id);
  rmUser_(eng); rmUser_(hseMgr); dbDelete('projects', proj.id); dbDelete('clients', client.id);
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
