/**
 * Setup.gs
 * ---------------------------------------------------------------------------
 * One-time / idempotent provisioning, run manually from the Apps Script editor
 * or via clasp. Safe to re-run: it only adds what is missing.
 * ---------------------------------------------------------------------------
 */

/**
 * MAIN SETUP. Run this once after first deploy.
 *  - Creates every tab with its header row (or migrates missing headers).
 *  - Creates the global Drive root folder.
 *  - Generates an API token if none exists and logs it.
 */
function initializeWorkbook() {
  var report = { tabs: [], rootFolder: null, token: null };
  var book = openBook_();

  var names = listEntities();
  for (var i = 0; i < names.length; i++) {
    var s = SCHEMA[names[i]];
    var sheet = book.getSheetByName(s.sheet);
    if (!sheet) {
      sheet = book.insertSheet(s.sheet);
      sheet.getRange(1, 1, 1, s.columns.length).setValues([s.columns]);
      sheet.setFrozenRows(1);
      report.tabs.push({ sheet: s.sheet, action: 'created' });
    } else {
      migrateHeaders_(sheet, s.columns);
      report.tabs.push({ sheet: s.sheet, action: 'verified' });
    }
  }

  // Remove the default "Sheet1" if it is empty and not part of the schema.
  var leftover = book.getSheetByName('Sheet1');
  if (leftover && leftover.getLastRow() === 0 && book.getSheets().length > 1) {
    book.deleteSheet(leftover);
  }

  var root = getRootFolder_();
  report.rootFolder = { id: root.getId(), url: root.getUrl() };

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_TOKEN')) {
    var token = uuid().replace(/-/g, '') + uuid().replace(/-/g, '');
    props.setProperty('API_TOKEN', token);
    report.token = token;
  } else {
    report.token = '(already set — unchanged)';
  }
  if (!props.getProperty('SPREADSHEET_ID')) {
    props.setProperty('SPREADSHEET_ID', book.getId());
  }

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Ensure a sheet's header row contains every schema column, appending any
 * missing ones to the right without disturbing existing data.
 */
function migrateHeaders_(sheet, columns) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var current = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  var toAppend = [];
  for (var i = 0; i < columns.length; i++) {
    if (current.indexOf(columns[i]) === -1) toAppend.push(columns[i]);
  }
  if (toAppend.length) {
    sheet.getRange(1, current.length + 1, 1, toAppend.length).setValues([toAppend]);
  }
  if (sheet.getFrozenRows() === 0) sheet.setFrozenRows(1);
}

/** Seed a couple of users and a demo project (handy for first-run testing). */
function seedDemoData() {
  initializeWorkbook();
  dbInsert('users', {
    full_name: 'System Admin', email: 'admin@unitedbrothers.co',
    role: 'Admin', active: 'TRUE', client_uuid: 'seed-user-admin'
  }, 'setup');
  dbInsert('users', {
    full_name: 'Site Engineer', email: 'site@unitedbrothers.co',
    role: 'SiteEngineer', active: 'TRUE', client_uuid: 'seed-user-site'
  }, 'setup');

  var proj = createProjectWithDrive({
    project_name: 'Demo — Ain Sokhna Works',
    client_name: 'SGGE', location: 'Ain Sokhna',
    contract_value_egp: 8500000, status: 'Active',
    client_uuid: 'seed-project-demo'
  }, 'setup');

  Logger.log('Seeded demo project: ' + proj.id + '  -> ' + proj.drive_root_url);
  return proj;
}

/** Print the current API token (run from editor to retrieve it). */
function showApiToken() {
  var t = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  Logger.log('API_TOKEN = ' + (t || '(not set — run initializeWorkbook)'));
  return t;
}
