/**
 * Database.gs
 * ---------------------------------------------------------------------------
 * Sheets-as-relational-ledger access layer.
 *
 * Responsibilities:
 *  - Open the workbook (bound or by ID).
 *  - Map header rows <-> JSON objects.
 *  - CRUD with UUID primary keys.
 *  - Concurrency safety via LockService (15s window) on every mutation.
 *  - Offline idempotency via client_uuid (a second sync of the same capture
 *    will not create a duplicate row).
 *  - Foreign-key existence checks.
 *  - Atomic, gap-free document numbering (MR-0001, PO-0001, ...).
 * ---------------------------------------------------------------------------
 */

/** Open the configured spreadsheet. */
function openBook_() {
  var id = prop('SPREADSHEET_ID', CONFIG.SPREADSHEET_ID);
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new AppError('NO_SPREADSHEET',
      'No bound spreadsheet and SPREADSHEET_ID not set.', 500);
  }
  return active;
}

/** Get (or create) a sheet for an entity and guarantee its header row. */
function getSheet_(entity) {
  var s = getSchema(entity);
  var book = openBook_();
  var sheet = book.getSheetByName(s.sheet);
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

/** Header array for a sheet (reads row 1 once). */
function headers_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h); });
}

/** Convert a sheet row array to an object using headers. */
function rowToObj_(headers, row) {
  var o = {};
  for (var i = 0; i < headers.length; i++) o[headers[i]] = row[i];
  return o;
}

/** Convert an object to a row array ordered by headers. */
function objToRow_(headers, obj) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var v = obj[headers[i]];
    row.push(v === undefined || v === null ? '' : v);
  }
  return row;
}

/** Run fn under an exclusive script lock; throws on contention timeout. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  var got = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
  if (!got) {
    throw new AppError('LOCK_TIMEOUT',
      'System busy (write lock not acquired within ' +
      (CONFIG.LOCK_TIMEOUT_MS / 1000) + 's). Retry shortly.', 503);
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ----------------------------- READS ------------------------------------ */

/** Return all rows of an entity as objects (header-mapped). */
function dbList(entity, filter) {
  var sheet = getSheet_(entity);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var hdr = headers_(sheet);
  var values = sheet.getRange(2, 1, last - 1, hdr.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var obj = rowToObj_(hdr, values[r]);
    if (!obj.id) continue; // skip blank rows
    if (filter && !matchesFilter_(obj, filter)) continue;
    out.push(obj);
  }
  return out;
}

/** Simple equality filter, e.g. { project_id: 'uuid', status: 'Active' }. */
function matchesFilter_(obj, filter) {
  for (var k in filter) {
    if (!filter.hasOwnProperty(k)) continue;
    if (String(obj[k]) !== String(filter[k])) return false;
  }
  return true;
}

/** Find one row by primary key. Returns {obj, rowIndex} or null. */
function dbFindByPk_(entity, id) {
  var sheet = getSheet_(entity);
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var hdr = headers_(sheet);
  var pkCol = hdr.indexOf(getSchema(entity).pk);
  if (pkCol === -1) throw new AppError('SCHEMA_DRIFT', 'PK column missing in ' + entity, 500);
  var ids = sheet.getRange(2, pkCol + 1, last - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === String(id)) {
      var row = sheet.getRange(r + 2, 1, 1, hdr.length).getValues()[0];
      return { obj: rowToObj_(hdr, row), rowIndex: r + 2, headers: hdr, sheet: sheet };
    }
  }
  return null;
}

function dbGet(entity, id) {
  var found = dbFindByPk_(entity, id);
  return found ? found.obj : null;
}

/** Find a row by client_uuid (offline idempotency key). */
function dbFindByClientUuid_(entity, clientUuid) {
  if (!clientUuid) return null;
  var sheet = getSheet_(entity);
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var hdr = headers_(sheet);
  var col = hdr.indexOf('client_uuid');
  if (col === -1) return null;
  var vals = sheet.getRange(2, col + 1, last - 1, 1).getValues();
  for (var r = 0; r < vals.length; r++) {
    if (vals[r][0] && String(vals[r][0]) === String(clientUuid)) {
      var row = sheet.getRange(r + 2, 1, 1, hdr.length).getValues()[0];
      return { obj: rowToObj_(hdr, row), rowIndex: r + 2, headers: hdr, sheet: sheet };
    }
  }
  return null;
}

/* ----------------------------- WRITES ----------------------------------- */

/** Validate every declared FK in a record actually points to an existing row. */
function assertForeignKeys_(entity, record) {
  var s = getSchema(entity);
  if (!s.fk) return;
  for (var col in s.fk) {
    if (!s.fk.hasOwnProperty(col)) continue;
    var val = record[col];
    if (val === undefined || val === null || val === '') continue; // optional FK
    var target = s.fk[col];
    if (!dbGet(target, val)) {
      throw new AppError('FK_VIOLATION',
        'Field ' + col + '="' + val + '" does not exist in ' + target + '.');
    }
  }
}

/**
 * Insert a new record. Returns the stored object.
 * - Generates id (UUID) if absent.
 * - Idempotent on client_uuid: returns the existing row instead of duplicating.
 * - Stamps audit columns.
 * Runs entirely inside the script lock.
 */
function dbInsert(entity, record, actor) {
  return withLock_(function () {
    record = pickColumns(entity, record);
    validateEnums(entity, record);

    // Idempotency: same offline capture re-synced -> return existing.
    if (record.client_uuid) {
      var dup = dbFindByClientUuid_(entity, record.client_uuid);
      if (dup) return dup.obj;
    }

    assertForeignKeys_(entity, record);

    var sheet = getSheet_(entity);
    var hdr = headers_(sheet);
    var pk = getSchema(entity).pk;

    if (!record[pk] || !isUuid(record[pk])) record[pk] = uuid();
    var ts = nowIso();
    record.created_at = record.created_at || ts;
    record.updated_at = ts;
    record.created_by = record.created_by || actor || 'system';
    record.sync_status = 'synced';
    if (!record.client_uuid) record.client_uuid = record[pk];

    sheet.appendRow(objToRow_(hdr, record));
    return record;
  });
}

/**
 * Update an existing record by PK. Returns the merged stored object.
 * Partial updates are allowed; only provided columns change.
 */
function dbUpdate(entity, id, patch, actor) {
  return withLock_(function () {
    var found = dbFindByPk_(entity, id);
    if (!found) throw new AppError('NOT_FOUND', entity + ' id ' + id + ' not found.', 404);

    patch = pickColumns(entity, patch);
    delete patch[getSchema(entity).pk]; // never rewrite the PK
    delete patch.created_at;
    delete patch.created_by;

    var merged = found.obj;
    for (var k in patch) {
      if (patch.hasOwnProperty(k)) merged[k] = patch[k];
    }
    validateEnums(entity, merged);
    assertForeignKeys_(entity, merged);

    merged.updated_at = nowIso();
    merged.sync_status = 'synced';

    found.sheet.getRange(found.rowIndex, 1, 1, found.headers.length)
      .setValues([objToRow_(found.headers, merged)]);
    return merged;
  });
}

/** Delete a record by PK. Returns {deleted:true}. Cascades are NOT automatic. */
function dbDelete(entity, id) {
  return withLock_(function () {
    var found = dbFindByPk_(entity, id);
    if (!found) throw new AppError('NOT_FOUND', entity + ' id ' + id + ' not found.', 404);
    found.sheet.deleteRow(found.rowIndex);
    return { deleted: true, id: id };
  });
}

/**
 * Atomic, gap-free counter for human-readable document numbers.
 * Stored in Script Properties; mutated under the same lock as inserts.
 * Returns e.g. "MR-2026-0007".
 */
function nextDocNumber_(prefix) {
  var year = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy');
  var key = 'SEQ_' + prefix + '_' + year;
  var props = PropertiesService.getScriptProperties();
  var current = parseInt(props.getProperty(key) || '0', 10) + 1;
  props.setProperty(key, String(current));
  return prefix + '-' + year + '-' + ('0000' + current).slice(-4);
}
