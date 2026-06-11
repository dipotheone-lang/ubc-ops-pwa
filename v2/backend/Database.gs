/**
 * Database.gs — v2 Sheets-as-ledger access layer.
 * Header-mapped CRUD, UUID PKs, LockService on writes, FK checks, audit stamps.
 */

function openBook_() {
  var id = prop('SPREADSHEET_ID', CONFIG.SPREADSHEET_ID);
  if (id) return SpreadsheetApp.openById(id);
  var a = SpreadsheetApp.getActiveSpreadsheet();
  if (!a) throw new AppError('NO_SPREADSHEET', 'No bound spreadsheet and SPREADSHEET_ID not set.', 500);
  return a;
}

function getSheet_(entity) {
  var s = getSchema(entity), book = openBook_(), sheet = book.getSheetByName(s.sheet);
  if (!sheet) {
    sheet = book.insertSheet(s.sheet);
    sheet.getRange(1, 1, 1, s.columns.length).setValues([s.columns]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, s.columns.length).setValues([s.columns]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function headers_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}
function rowToObj_(h, row) { var o = {}; for (var i = 0; i < h.length; i++) o[h[i]] = row[i]; return o; }
function objToRow_(h, obj) {
  var r = [];
  for (var i = 0; i < h.length; i++) { var v = obj[h[i]]; r.push(v === undefined || v === null ? '' : v); }
  return r;
}

var _lockHeld = false;  // re-entrancy guard: nested withLock_ reuse the outer lock
function withLock_(fn) {
  if (_lockHeld) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS))
    throw new AppError('LOCK_TIMEOUT', 'System busy; retry shortly.', 503);
  _lockHeld = true;
  try { return fn(); } finally { _lockHeld = false; lock.releaseLock(); }
}

/* ------------------------------- reads ---------------------------------- */
function dbList(entity, filter) {
  var sheet = getSheet_(entity), last = sheet.getLastRow();
  if (last < 2) return [];
  var h = headers_(sheet), vals = sheet.getRange(2, 1, last - 1, h.length).getValues(), out = [];
  for (var r = 0; r < vals.length; r++) {
    var o = rowToObj_(h, vals[r]);
    if (!o.id) continue;
    if (filter && !matchesFilter_(o, filter)) continue;
    out.push(o);
  }
  return out;
}
function matchesFilter_(o, f) {
  for (var k in f) { if (f.hasOwnProperty(k) && String(o[k]) !== String(f[k])) return false; }
  return true;
}
function dbFind_(entity, id) {
  var sheet = getSheet_(entity), last = sheet.getLastRow();
  if (last < 2) return null;
  var h = headers_(sheet), pkCol = h.indexOf(getSchema(entity).pk);
  var ids = sheet.getRange(2, pkCol + 1, last - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === String(id)) {
      var row = sheet.getRange(r + 2, 1, 1, h.length).getValues()[0];
      return { obj: rowToObj_(h, row), rowIndex: r + 2, headers: h, sheet: sheet };
    }
  }
  return null;
}
function dbGet(entity, id) { var f = dbFind_(entity, id); return f ? f.obj : null; }
/** First row matching a single column = value. */
function dbFindBy(entity, col, value) {
  var rows = dbList(entity);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][col]) === String(value)) return rows[i];
  return null;
}

/* ------------------------------- writes --------------------------------- */
function assertForeignKeys_(entity, rec) {
  var s = getSchema(entity);
  if (!s.fk) return;
  for (var col in s.fk) {
    if (!s.fk.hasOwnProperty(col)) continue;
    var v = rec[col];
    if (v === undefined || v === null || v === '') continue;
    if (!dbGet(s.fk[col], v)) throw new AppError('FK_VIOLATION', col + '="' + v + '" not found in ' + s.fk[col] + '.');
  }
}
function dbInsert(entity, record, actor) {
  return withLock_(function () {
    record = pickColumns(entity, record);
    validateEnums(entity, record);
    assertForeignKeys_(entity, record);
    var sheet = getSheet_(entity), h = headers_(sheet), pk = getSchema(entity).pk, ts = nowIso();
    if (!record[pk]) record[pk] = uuid();
    if (h.indexOf('created_at') !== -1) record.created_at = record.created_at || ts;
    if (h.indexOf('updated_at') !== -1) record.updated_at = ts;
    if (h.indexOf('created_by') !== -1) record.created_by = record.created_by || actor || 'system';
    if (h.indexOf('updated_by') !== -1) record.updated_by = actor || 'system';
    sheet.appendRow(objToRow_(h, record));
    return record;
  });
}
function dbUpdate(entity, id, patch, actor) {
  return withLock_(function () {
    var f = dbFind_(entity, id);
    if (!f) throw new AppError('NOT_FOUND', entity + ' id ' + id + ' not found.', 404);
    patch = pickColumns(entity, patch);
    delete patch[getSchema(entity).pk]; delete patch.created_at; delete patch.created_by;
    var merged = f.obj;
    for (var k in patch) if (patch.hasOwnProperty(k)) merged[k] = patch[k];
    validateEnums(entity, merged);
    assertForeignKeys_(entity, merged);
    if (f.headers.indexOf('updated_at') !== -1) merged.updated_at = nowIso();
    if (f.headers.indexOf('updated_by') !== -1) merged.updated_by = actor || 'system';
    f.sheet.getRange(f.rowIndex, 1, 1, f.headers.length).setValues([objToRow_(f.headers, merged)]);
    return merged;
  });
}
function dbDelete(entity, id) {
  return withLock_(function () {
    var f = dbFind_(entity, id);
    if (!f) throw new AppError('NOT_FOUND', entity + ' id ' + id + ' not found.', 404);
    f.sheet.deleteRow(f.rowIndex);
    return { deleted: true, id: id };
  });
}

/** Atomic gap-free document number, e.g. UBC-PRJ-2026-0007. */
function nextDocNumber(prefix) {
  return withLock_(function () {
    var year = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
    var key = 'SEQ_' + prefix + '_' + year;
    var props = PropertiesService.getScriptProperties();
    var n = parseInt(props.getProperty(key) || '0', 10) + 1;
    props.setProperty(key, String(n));
    return prefix + '-' + year + '-' + ('0000' + n).slice(-4);
  });
}
