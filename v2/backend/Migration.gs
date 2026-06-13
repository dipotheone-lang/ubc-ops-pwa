/**
 * Migration.gs — admin-gated bulk import for migrating legacy data.
 * Idempotent: rows whose keyField value already exists are skipped, so the
 * same import can be re-run safely. Per-row errors are collected, never fatal.
 */
/**
 * Delete all test data — every row whose created_by ends with `marker`
 * (default '@ubcsis.test'), plus the test users themselves and their
 * assignments/sessions. Audit log is preserved. One-click cleanup.
 */
function purgeTestData(marker) {
  marker = String(marker || '@ubcsis.test').toLowerCase();
  var ends = function (v) { return v != null && String(v).toLowerCase().slice(-marker.length) === marker; };
  var report = {};
  listEntities().forEach(function (e) {
    if (['users', 'audit_log', 'sessions', 'role_assignments', 'notifications'].indexOf(e) !== -1) return;
    var rows = dbList(e).filter(function (r) { return ends(r.created_by); });
    rows.forEach(function (r) { try { dbDelete(e, r.id); } catch (x) {} });
    if (rows.length) report[e] = rows.length;
  });
  // notifications + approvals tied to test users / left dangling
  var testUsers = dbList('users').filter(function (u) { return ends(u.email); });
  var ids = {}; testUsers.forEach(function (u) { ids[u.id] = 1; });
  dbList('notifications').forEach(function (n) { if (ids[n.user_id]) { try { dbDelete('notifications', n.id); } catch (x) {} } });
  testUsers.forEach(function (u) {
    dbList('role_assignments', { user_id: u.id }).forEach(function (ra) { try { dbDelete('role_assignments', ra.id); } catch (x) {} });
    dbList('sessions', { user_id: u.id }).forEach(function (s) { try { dbDelete('sessions', s.id); } catch (x) {} });
    try { dbDelete('users', u.id); } catch (x) {}
  });
  report.users = testUsers.length;
  return report;
}

function bulkImport(entity, rows, keyField, actor) {
  getSchema(entity); // validate entity
  var existing = {};
  if (keyField) dbList(entity).forEach(function (r) { if (r[keyField] !== '' && r[keyField] != null) existing[String(r[keyField]).toLowerCase().trim()] = 1; });
  var inserted = 0, skipped = 0, errors = [];
  (rows || []).forEach(function (row, i) {
    try {
      if (keyField && row[keyField] != null && existing[String(row[keyField]).toLowerCase().trim()]) { skipped++; return; }
      dbInsert(entity, row, actor);
      inserted++;
      if (keyField && row[keyField] != null) existing[String(row[keyField]).toLowerCase().trim()] = 1;
    } catch (e) { errors.push({ row: i, message: (e && e.message) || String(e) }); }
  });
  return { entity: entity, inserted: inserted, skipped: skipped, error_count: errors.length, errors: errors.slice(0, 25) };
}
