/**
 * Utils.gs
 * ---------------------------------------------------------------------------
 * Cross-cutting helpers: typed errors, JSON responses, UUID/idempotency,
 * Script Property access, timestamps, and lightweight validation.
 * ---------------------------------------------------------------------------
 */

/** Domain error carrying a machine code + safe message. */
function AppError(code, message, httpHint) {
  this.name = 'AppError';
  this.code = code || 'ERROR';
  this.message = message || 'Unexpected error';
  this.httpHint = httpHint || 400;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

/** RFC4122-ish v4 UUID using Apps Script's crypto util. */
function uuid() {
  return Utilities.getUuid();
}

/** Current ISO timestamp in the configured timezone. */
function nowIso() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Read a Script Property with a fallback. */
function prop(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === undefined || v === '') ? fallback : v;
}

/** Build a standard JSON envelope. */
function jsonOut(payload, ok) {
  var body = { ok: ok !== false, ts: nowIso() };
  if (ok === false) {
    body.error = payload;
  } else {
    body.data = payload;
  }
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Success envelope. */
function ok(data) { return jsonOut(data, true); }

/** Error envelope from any thrown value. */
function fail(err) {
  var code = (err && err.code) || 'INTERNAL';
  var message = (err && err.message) || String(err);
  return jsonOut({ code: code, message: message }, false);
}

/** Parse a JSON POST body defensively. */
function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new AppError('EMPTY_BODY', 'Request body is empty.');
  }
  if (e.postData.contents.length > CONFIG.MAX_BASE64_CHARS) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'Request body exceeds size limit.', 413);
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (parseErr) {
    throw new AppError('BAD_JSON', 'Request body is not valid JSON.');
  }
}

/** Enforce the shared-secret token gate on write actions. */
function assertToken(body) {
  if (!CONFIG.REQUIRE_TOKEN) return;
  var expected = prop('API_TOKEN', '');
  if (!expected) {
    throw new AppError('SERVER_NOT_CONFIGURED',
      'API_TOKEN script property is not set. Run Setup or set it manually.', 500);
  }
  var got = (body && body.token) || '';
  if (got !== expected) {
    throw new AppError('UNAUTHORIZED', 'Invalid or missing API token.', 401);
  }
}

/** Require that `obj` has non-empty values for each key in `fields`. */
function requireFields(obj, fields) {
  var missing = [];
  for (var i = 0; i < fields.length; i++) {
    var k = fields[i];
    if (obj[k] === undefined || obj[k] === null || obj[k] === '') missing.push(k);
  }
  if (missing.length) {
    throw new AppError('VALIDATION', 'Missing required field(s): ' + missing.join(', '));
  }
}

/** Validate enum-constrained fields against SCHEMA.enums. */
function validateEnums(entity, record) {
  var s = getSchema(entity);
  if (!s.enums) return;
  for (var field in s.enums) {
    if (!s.enums.hasOwnProperty(field)) continue;
    var val = record[field];
    if (val === undefined || val === null || val === '') continue; // optional
    var allowed = s.enums[field];
    if (allowed.indexOf(String(val)) === -1) {
      throw new AppError('VALIDATION',
        'Invalid value "' + val + '" for ' + field + '. Allowed: ' + allowed.join(', '));
    }
  }
}

/** Coerce numeric-looking strings to numbers for known numeric columns. */
function coerceNumber(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return isNaN(n) ? v : n;
}

/** Shallow-pick only the schema columns from an arbitrary record. */
function pickColumns(entity, record) {
  var cols = getSchema(entity).columns;
  var out = {};
  for (var i = 0; i < cols.length; i++) {
    var c = cols[i];
    if (record.hasOwnProperty(c)) out[c] = record[c];
  }
  return out;
}

/** True if a string looks like a UUID we issued. */
function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
}
