/**
 * harness.mjs — run the v2 Apps Script backend locally by mocking the Google
 * services it depends on (SpreadsheetApp, Utilities, LockService,
 * PropertiesService, DriveApp, Logger). Loads every .gs into one VM context and
 * executes runAllTests(). NOT pushed by clasp (lives outside backend/).
 *
 *   node v2/test/harness.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const backend = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend');

/* ----------------------------- mock Sheets ------------------------------ */
// Mirror Google Sheets coercion: the strings "TRUE"/"FALSE" become real booleans.
function coerceCell(v) { if (v === 'TRUE') return true; if (v === 'FALSE') return false; return v; }
class MockRange {
  constructor(sheet, r, c, nr, nc) { this.s = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.s.rows[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
      out.push(o);
    }
    return out;
  }
  setValues(vals) {
    for (let i = 0; i < vals.length; i++) {
      const ri = this.r - 1 + i;
      while (this.s.rows.length <= ri) this.s.rows.push([]);
      const row = this.s.rows[ri];
      for (let j = 0; j < vals[i].length; j++) row[this.c - 1 + j] = coerceCell(vals[i][j]);
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
}
class MockSheet {
  constructor(name) { this.name = name; this.rows = []; this.frozen = 0; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(r, c, nr, nc) { return new MockRange(this, r, c, nr || 1, nc || 1); }
  appendRow(arr) { this.rows.push(arr.map(coerceCell)); return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  getFrozenRows() { return this.frozen; }
  deleteRow(idx) { this.rows.splice(idx - 1, 1); return this; }
}
class MockBook {
  constructor() { this.sheets = []; this.id = 'mock-book'; }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}
const BOOK = new MockBook();

/* --------------------------- mock Utilities ----------------------------- */
function toByteArray(buf) { const a = []; for (const b of buf) a.push(b > 127 ? b - 256 : b); return a; } // GAS signed bytes
const Utilities = {
  getUuid: () => randomUUID(),
  formatDate: (d, tz, fmt) => {
    if (fmt === 'yyyy') return String(d.getFullYear());
    return d.toISOString();
  },
  computeDigest: (_alg, value) => toByteArray(createHash('sha256').update(String(value), 'utf8').digest()),
  computeHmacSha256Signature: (msg, key) => toByteArray(createHmac('sha256', String(key)).update(String(msg), 'utf8').digest()),
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  newBlob: () => ({})
};

/* ------------------------ other mocked services ------------------------- */
const _props = new Map();
const PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (_props.has(k) ? _props.get(k) : null),
  setProperty: (k, v) => { _props.set(k, String(v)); }
}) };
const LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
const SpreadsheetApp = { openById: () => BOOK, getActiveSpreadsheet: () => BOOK };
const DriveApp = {
  Access: { DOMAIN_WITH_LINK: 1, ANYONE_WITH_LINK: 2 }, Permission: { VIEW: 1 },
  getFoldersByName: () => ({ hasNext: () => false, next: () => null }),
  createFolder: (n) => ({ getId: () => 'f-' + n, getUrl: () => 'https://drive/' + n,
    getFoldersByName: () => ({ hasNext: () => false, next: () => null }),
    createFolder: (m) => ({ getId: () => 'f-' + m, getUrl: () => 'https://drive/folders/' + m }),
    setSharing: () => {} }),
  getFolderById: () => { throw new Error('no folder'); }
};
const ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'JSON' } };
const Logger = { log: (m) => { /* captured via runAllTests return */ } };

/* ----------------------------- load + run ------------------------------- */
const files = readdirSync(backend).filter(f => f.endsWith('.gs')).sort();
let src = '';
for (const f of files) src += '\n//=== ' + f + ' ===\n' + readFileSync(join(backend, f), 'utf8');

const sandbox = { Utilities, PropertiesService, LockService, SpreadsheetApp, DriveApp, ContentService, Logger, console, JSON, Math, Date, Object, Array, String, Number, isNaN, parseInt, Infinity };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'ubc-v2-backend.gs' });

console.log('Loaded ' + files.length + ' .gs files into mock GAS context.\n');
const result = vm.runInContext('runAllTests()', sandbox);
console.log(result);

// Extra end-to-end: full login → bootstrap → approval via the doPost router.
console.log('\n--- E2E via doPost router ---');
function post(body) {
  const out = vm.runInContext('doPost(' + JSON.stringify({ postData: { contents: JSON.stringify(body) } }) + ')', sandbox);
  return JSON.parse(out);
}
// set a known password for the seeded CFO, then exercise the API surface
vm.runInContext(`
  (function(){
    var cfo = dbFindBy('users','email','cfo@ubcsis.com');
    setUserPassword(cfo.id, 'Cfo12345', { actor:'harness' });
    var ceo = dbFindBy('users','email','ceo@ubcsis.com');
    setUserPassword(ceo.id, 'Ceo12345', { actor:'harness' });
  })();
`, sandbox);
const loginRes = post({ action: 'auth.login', email: 'cfo@ubcsis.com', password: 'Cfo12345' });
console.log('login ok=' + loginRes.ok + ' role=' + (loginRes.data && loginRes.data.roles[0].role_code));
const token = loginRes.data.token;
const boot = post({ action: 'bootstrap', token });
console.log('bootstrap ok=' + boot.ok + ' perms=' + boot.data.permissions.length + ' lookups=' + boot.data.lookups.length);
const badCreate = post({ action: 'admin.user.create', token, record: { email: 'x@y.co', full_name_en: 'X' } });
console.log('CFO create user (should be forbidden): ok=' + badCreate.ok + ' code=' + (badCreate.error && badCreate.error.code));
const listClients = post({ action: 'list', token, entity: 'clients' });
console.log('CFO list clients ok=' + listClients.ok + ' count=' + (listClients.data && listClients.data.length));
console.log('\nDONE.');
