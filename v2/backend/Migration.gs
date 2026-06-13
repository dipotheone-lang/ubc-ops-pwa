/**
 * Migration.gs — admin-gated bulk import for migrating legacy data.
 * Idempotent: rows whose keyField value already exists are skipped, so the
 * same import can be re-run safely. Per-row errors are collected, never fatal.
 */
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
