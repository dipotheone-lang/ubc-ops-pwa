/**
 * Utils.gs — v2 cross-cutting helpers: errors, JSON envelopes, time, IDs,
 * validation, and the crypto primitives for password hashing + sessions.
 */

function AppError(code, message, httpHint) {
  this.name = 'AppError';
  this.code = code || 'ERROR';
  this.message = message || 'Unexpected error';
  this.httpHint = httpHint || 400;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

function uuid() { return Utilities.getUuid(); }
function nowIso() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function nowMs() { return (new Date()).getTime(); }

function prop(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === undefined || v === '') ? fallback : v;
}
function setProp(key, val) { PropertiesService.getScriptProperties().setProperty(key, String(val)); }

/* ----------------------------- responses -------------------------------- */
function jsonOut(payload, ok) {
  var body = { ok: ok !== false, ts: nowIso() };
  if (ok === false) body.error = payload; else body.data = payload;
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function ok(data) { return jsonOut(data, true); }
function fail(err) {
  return jsonOut({ code: (err && err.code) || 'INTERNAL', message: (err && err.message) || String(err) }, false);
}
function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) throw new AppError('EMPTY_BODY', 'Request body is empty.');
  try { return JSON.parse(e.postData.contents); }
  catch (x) { throw new AppError('BAD_JSON', 'Request body is not valid JSON.'); }
}

/* ----------------------------- validation ------------------------------- */
function requireFields(obj, fields) {
  var missing = [];
  for (var i = 0; i < fields.length; i++) {
    var k = fields[i];
    if (obj[k] === undefined || obj[k] === null || obj[k] === '') missing.push(k);
  }
  if (missing.length) throw new AppError('VALIDATION', 'Missing required field(s): ' + missing.join(', '));
}
function validateEnums(entity, record) {
  var s = getSchema(entity);
  if (!s.enums) return;
  for (var f in s.enums) {
    if (!s.enums.hasOwnProperty(f)) continue;
    var v = record[f];
    if (v === undefined || v === null || v === '') continue;
    var allowed = s.enums[f];
    // Google Sheets coerces the strings "TRUE"/"FALSE" into real booleans, which
    // read back as lowercase. Normalize before checking so the enum still matches.
    var isBoolEnum = allowed.length === 2 && allowed.indexOf('TRUE') !== -1 && allowed.indexOf('FALSE') !== -1;
    var val;
    if (v === true) val = 'TRUE';
    else if (v === false) val = 'FALSE';
    else { val = String(v); if (isBoolEnum) val = val.toUpperCase(); }
    if (allowed.indexOf(val) === -1)
      throw new AppError('VALIDATION', 'Invalid ' + f + '="' + v + '". Allowed: ' + allowed.join(', '));
  }
}

/** Sheets-coercion-tolerant truthiness for TRUE/FALSE flag columns. */
function truthy(v) { return v === true || String(v).trim().toUpperCase() === 'TRUE'; }
function pickColumns(entity, record) {
  var cols = getSchema(entity).columns, out = {};
  for (var i = 0; i < cols.length; i++) if (record.hasOwnProperty(cols[i])) out[cols[i]] = record[cols[i]];
  return out;
}
function coerceNumber(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v); return isNaN(n) ? v : n;
}
function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-fA-F-]{36}$/.test(v);
}
function isEmail(v) { return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }

/* ------------------------------- crypto --------------------------------- */
/** Bytes → hex string. */
function bytesToHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}
/** SHA-256 hex of a string. */
function sha256Hex(str) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8));
}
/** HMAC-SHA256(message, key) → bytes. */
function hmac_(message, key) {
  return Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8);
}
/** Random URL-safe token (two UUIDs, dashes stripped). */
function randomToken() { return (uuid() + uuid()).replace(/-/g, ''); }
/** Random salt (hex). */
function randomSalt() { return sha256Hex(uuid() + uuid() + nowMs()); }

/** Server-side pepper from Script Properties (created on first setup). */
function pepper_() {
  var p = prop('PEPPER', '');
  if (!p) { p = randomToken(); setProp('PEPPER', p); }
  return p;
}

/**
 * PBKDF2-style stretch: iterate HMAC-SHA256 over (salt+pepper) keyed material.
 * Returns hex digest. Deterministic for the same (password, salt).
 */
function hashPassword(password, salt) {
  var key = salt + '|' + pepper_();
  var acc = password;
  var bytes = hmac_(acc, key);
  for (var i = 1; i < CONFIG.PBKDF2_ITERATIONS; i++) {
    bytes = hmac_(bytesToHex_(bytes), key);
  }
  return bytesToHex_(bytes);
}
/** Constant-time string comparison. */
function constantTimeEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}
/** Basic password policy check. */
function checkPasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new AppError('WEAK_PASSWORD', 'Password must be at least 8 characters.');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new AppError('WEAK_PASSWORD', 'Password must include letters and numbers.');
  return true;
}
