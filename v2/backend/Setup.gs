/**
 * Setup.gs — one-time, idempotent provisioning for v2 Foundation.
 * Run initializeWorkbook() once from the Apps Script editor after `clasp push`.
 */

function initializeWorkbook() {
  var report = { tabs: [], seeded: {}, temp_passwords: [] };
  var book = openBook_();
  if (!prop('SPREADSHEET_ID', '')) setProp('SPREADSHEET_ID', book.getId());
  pepper_(); // ensure server pepper exists

  // 1) tabs + headers
  listEntities().forEach(function (name) {
    var s = SCHEMA[name], sheet = book.getSheetByName(s.sheet);
    if (!sheet) {
      sheet = book.insertSheet(s.sheet);
      sheet.getRange(1, 1, 1, s.columns.length).setValues([s.columns]);
      sheet.setFrozenRows(1);
      report.tabs.push(s.sheet + ' (created)');
    } else { migrateHeaders_(sheet, s.columns); report.tabs.push(s.sheet + ' (verified)'); }
  });
  var leftover = book.getSheetByName('Sheet1');
  if (leftover && leftover.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(leftover);

  // 2) roles
  if (dbList('roles').length === 0) {
    SEED_ROLES.forEach(function (r) { dbInsert('roles', { code: r[0], name_en: r[1], name_ar: r[2], active: 'TRUE' }, 'setup'); });
    report.seeded.roles = SEED_ROLES.length;
  }

  // 3) permissions
  if (dbList('permissions').length === 0) {
    SEED_PERMISSIONS.forEach(function (p) {
      dbInsert('permissions', { role_code: p[0], module: p[1], entity: p[2], action: p[3], scope: p[4] }, 'setup');
    });
    report.seeded.permissions = SEED_PERMISSIONS.length;
  }

  // 4) DoA bands
  if (dbList('doa_bands').length === 0) {
    SEED_DOA.forEach(function (d) {
      dbInsert('doa_bands', {
        domain: d[0], action: d[1], min_amount: d[2],
        max_amount: (d[3] === null ? '' : d[3]), currency: CONFIG.BASE_CURRENCY,
        signer_chain_json: JSON.stringify(d[4]), description_en: d[5], active: 'TRUE'
      }, 'setup');
    });
    report.seeded.doa_bands = SEED_DOA.length;
  }

  // 5) lookups
  if (dbList('lookups').length === 0) {
    SEED_LOOKUPS.forEach(function (l, i) {
      dbInsert('lookups', { category: l[0], code: l[1], label_en: l[2], label_ar: l[3], sort: i, active: 'TRUE' }, 'setup');
    });
    report.seeded.lookups = SEED_LOOKUPS.length;
  }

  // 6) clients (anchors)
  if (dbList('clients').length === 0) {
    SEED_CLIENTS.forEach(function (c) {
      dbInsert('clients', { client_code: c[0], name_en: c[1], name_ar: c[2], sector: c[3], status: 'Active' }, 'setup');
    });
    report.seeded.clients = SEED_CLIENTS.length;
  }

  // 7) users + role assignments (only if none yet)
  if (dbList('users').length === 0) {
    SEED_USERS.forEach(function (su) {
      var u = dbInsert('users', {
        email: su[0], full_name_en: su[1], full_name_ar: su[2], title_en: su[3],
        active: 'TRUE', default_lang: 'ar', must_reset: 'TRUE'
      }, 'setup');
      var temp = randomToken().slice(0, 8) + 'A1';
      setUserPassword(u.id, temp, { actor: 'setup', mustReset: true });
      assignRole(u.id, su[4], 'GLOBAL', '', 'setup');
      report.temp_passwords.push(su[0] + ' = ' + temp);
    });
    report.seeded.users = SEED_USERS.length;
  }

  Logger.log(JSON.stringify(report, null, 2));
  Logger.log('\n=== TEMPORARY PASSWORDS (change on first login) ===\n' + report.temp_passwords.join('\n'));
  return report;
}

function migrateHeaders_(sheet, columns) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var current = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  var add = [];
  for (var i = 0; i < columns.length; i++) if (current.indexOf(columns[i]) === -1) add.push(columns[i]);
  if (add.length) sheet.getRange(1, current.length + 1, 1, add.length).setValues([add]);
  if (sheet.getFrozenRows() === 0) sheet.setFrozenRows(1);
}

/** Re-print the seed temp passwords are NOT recoverable; use admin reset instead. */
function showSeedUsers() {
  Logger.log(dbList('users').map(function (u) { return u.email + '  must_reset=' + u.must_reset; }).join('\n'));
}
