/**
 * Tests.gs
 * ---------------------------------------------------------------------------
 * In-editor test suite. Open the Apps Script editor, select runAllTests, Run.
 * Uses the bound/linked spreadsheet — run against a SCRATCH copy, not prod.
 * Each test cleans up the rows it creates.
 * ---------------------------------------------------------------------------
 */

function runAllTests() {
  var results = [];
  var tests = [
    t_schemaIntegrity,
    t_insertAndGet,
    t_idempotentClientUuid,
    t_enumValidation,
    t_foreignKeyViolation,
    t_docNumberSequence,
    t_procurementRequisitionWithLines,
    t_accountingNetCalc,
    t_syncBatchPartialFailure
  ];
  for (var i = 0; i < tests.length; i++) {
    var name = tests[i].name;
    try {
      tests[i]();
      results.push('PASS  ' + name);
    } catch (e) {
      results.push('FAIL  ' + name + '  -> ' + (e.message || e));
    }
  }
  var summary = results.join('\n');
  Logger.log(summary);
  return summary;
}

/* --------------------------- assertions -------------------------------- */
function assert_(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq_(a, b, msg) {
  if (String(a) !== String(b)) throw new Error((msg || 'not equal') + ' (' + a + ' !== ' + b + ')');
}
function assertThrows_(fn, codeWanted) {
  try { fn(); } catch (e) {
    if (codeWanted && e.code !== codeWanted) {
      throw new Error('expected code ' + codeWanted + ' got ' + e.code);
    }
    return;
  }
  throw new Error('expected throw');
}

/* ----------------------------- tests ----------------------------------- */

function t_schemaIntegrity() {
  var names = listEntities();
  assert_(names.length > 0, 'schema empty');
  for (var i = 0; i < names.length; i++) {
    var s = SCHEMA[names[i]];
    assert_(s.columns[0] === s.pk, names[i] + ' first column must be pk');
    assert_(s.columns.indexOf('client_uuid') !== -1, names[i] + ' missing client_uuid');
    assert_(s.columns.indexOf('created_at') !== -1, names[i] + ' missing created_at');
  }
}

function t_insertAndGet() {
  var rec = dbInsert('users', {
    full_name: 'Test User', email: 't' + Date.now() + '@x.co',
    role: 'Accounting', active: 'TRUE'
  }, 'test');
  assert_(isUuid(rec.id), 'id not uuid');
  var got = dbGet('users', rec.id);
  assertEq_(got.full_name, 'Test User');
  dbDelete('users', rec.id);
  assert_(dbGet('users', rec.id) === null, 'delete failed');
}

function t_idempotentClientUuid() {
  var cu = 'test-idem-' + Date.now();
  var a = dbInsert('users', { full_name: 'Idem', email: 'i@x.co', role: 'Admin', client_uuid: cu }, 'test');
  var b = dbInsert('users', { full_name: 'Idem2', email: 'i2@x.co', role: 'Admin', client_uuid: cu }, 'test');
  assertEq_(a.id, b.id, 'idempotency broken — duplicate created');
  dbDelete('users', a.id);
}

function t_enumValidation() {
  assertThrows_(function () {
    dbInsert('users', { full_name: 'Bad', email: 'b@x.co', role: 'NotARole' }, 'test');
  }, 'VALIDATION');
}

function t_foreignKeyViolation() {
  assertThrows_(function () {
    dbInsert('expense_logs', {
      project_id: 'does-not-exist', expense_date: '2026-01-01', amount_egp: 100
    }, 'test');
  }, 'FK_VIOLATION');
}

function t_docNumberSequence() {
  var a = nextDocNumber_('TST');
  var b = nextDocNumber_('TST');
  assert_(a !== b, 'doc numbers not unique');
  var na = parseInt(a.split('-').pop(), 10);
  var nb = parseInt(b.split('-').pop(), 10);
  assertEq_(nb, na + 1, 'sequence not incrementing');
}

function t_procurementRequisitionWithLines() {
  var proj = createProjectWithDrive({
    project_name: 'TEST PRJ ' + Date.now(), client_uuid: 'test-prj-' + Date.now()
  }, 'test');
  var res = Procurement.createRequisition({
    project_id: proj.id,
    required_date: '2026-02-01',
    lines: [
      { description: 'Cement', unit: 'bag', qty: 100, est_unit_price_egp: 120 },
      { description: 'Steel', unit: 'ton', qty: 5, est_unit_price_egp: 38000 }
    ]
  }, 'test');
  assert_(/^MR-/.test(res.header.mr_number), 'MR number not assigned');
  assertEq_(res.lines.length, 2, 'lines not stored');
  assertEq_(res.lines[0].est_total_egp, 12000, 'line total miscalculated');
  // cleanup
  dbDelete('material_requisition_lines', res.lines[0].id);
  dbDelete('material_requisition_lines', res.lines[1].id);
  dbDelete('material_requisitions', res.header.id);
  dbDelete('projects', proj.id);
}

function t_accountingNetCalc() {
  var proj = createProjectWithDrive({
    project_name: 'TEST ACC ' + Date.now(), client_uuid: 'test-acc-' + Date.now()
  }, 'test');
  var pay = Accounting.recordSubcontractorPayment({
    project_id: proj.id, subcontractor_name: 'Sub A',
    gross_amount_egp: 100000, retention_pct: 10, deductions_egp: 5000
  }, 'test');
  assertEq_(pay.retention_egp, 10000, 'retention calc');
  assertEq_(pay.net_payable_egp, 85000, 'net calc');
  dbDelete('subcontractor_payments', pay.id);
  dbDelete('projects', proj.id);
}

function t_syncBatchPartialFailure() {
  var out = syncPush_({
    ops: [
      { op_id: 'ok1', action: 'create', payload: { entity: 'users',
        record: { full_name: 'BatchOK', email: 'bo@x.co', role: 'HSE', client_uuid: 'batch-ok-' + Date.now() } } },
      { op_id: 'bad1', action: 'acc.expense', payload: { project_id: 'missing', amount_egp: 1, expense_date: '2026-01-01' } }
    ]
  }, 'test');
  assertEq_(out.results.length, 2);
  assert_(out.results[0].ok === true, 'first op should succeed');
  assert_(out.results[1].ok === false, 'second op should fail (FK)');
  // cleanup the created user
  if (out.results[0].data && out.results[0].data.id) dbDelete('users', out.results[0].data.id);
}
