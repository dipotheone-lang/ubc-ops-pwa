/**
 * Auth.gs — email + password authentication, sessions, lockout.
 *
 * Passwords: per-user random salt + server pepper, PBKDF2-style HMAC-SHA256
 * stretching (Utils.hashPassword). Sessions: random token, only its SHA-256 is
 * stored; validated on every request; 12h TTL; server-side revocation.
 */

/** Create or reset a user's password. Returns the user record (no secrets). */
function setUserPassword(userId, newPassword, opts) {
  checkPasswordPolicy(newPassword);
  var salt = randomSalt();
  var hash = hashPassword(newPassword, salt);
  var patch = { salt: salt, password_hash: hash, must_reset: (opts && opts.mustReset) ? 'TRUE' : 'FALSE',
    failed_attempts: 0, locked_until: '' };
  var u = dbUpdate('users', userId, patch, (opts && opts.actor) || 'system');
  return publicUser_(u);
}

/** Strip secrets before returning a user to clients. */
function publicUser_(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, full_name_en: u.full_name_en, full_name_ar: u.full_name_ar,
    phone: u.phone, title_en: u.title_en, title_ar: u.title_ar, grade: u.grade,
    must_reset: u.must_reset, active: u.active, default_lang: u.default_lang
  };
}

/**
 * Log in with email + password. On success returns { token, user, roles }.
 * Enforces lockout after CONFIG.MAX_FAILED_LOGINS.
 */
function login(email, password, ctx) {
  if (!isEmail(email)) throw new AppError('VALIDATION', 'Valid email required.');
  var u = dbFindBy('users', 'email', String(email).toLowerCase().trim());
  // Uniform error to avoid user enumeration.
  var bad = function () { throw new AppError('AUTH_FAILED', 'Invalid email or password.', 401); };
  if (!u) { hashPassword(password || '', 'dummy-salt'); bad(); } // timing equalize
  if (String(u.active) !== 'TRUE') throw new AppError('ACCOUNT_DISABLED', 'Account is disabled.', 403);

  if (u.locked_until && nowMs() < Number(u.locked_until)) {
    throw new AppError('LOCKED', 'Account locked. Try again later.', 423);
  }
  var computed = hashPassword(password || '', u.salt || 'x');
  if (!u.password_hash || !constantTimeEq(computed, u.password_hash)) {
    var attempts = Number(u.failed_attempts || 0) + 1;
    var patch = { failed_attempts: attempts };
    if (attempts >= CONFIG.MAX_FAILED_LOGINS) patch.locked_until = nowMs() + CONFIG.LOCKOUT_MS;
    dbUpdate('users', u.id, patch, 'system');
    audit({ user_id: u.id, user_email: u.email, action: 'login_failed', module: 'auth', entity: 'users', record_id: u.id, ip: ctx && ctx.ip });
    bad();
  }

  // success — reset counters, issue session
  dbUpdate('users', u.id, { failed_attempts: 0, locked_until: '' }, 'system');
  var token = randomToken();
  var session = {
    id: uuid(), token_hash: sha256Hex(token), user_id: u.id,
    created_at: nowIso(), expires_at: String(nowMs() + CONFIG.SESSION_TTL_MS),
    last_seen: nowIso(), revoked: 'FALSE', ip: (ctx && ctx.ip) || '', agent: (ctx && ctx.agent) || ''
  };
  getSheet_('sessions').appendRow(objToRow_(headers_(getSheet_('sessions')), session));
  audit({ user_id: u.id, user_email: u.email, action: 'login', module: 'auth', entity: 'users', record_id: u.id, ip: ctx && ctx.ip });

  return { token: token, user: publicUser_(u), roles: getUserRoles(u.id), must_reset: u.must_reset === 'TRUE' };
}

/** Validate a session token → returns { user, roles } or throws 401. */
function authenticate(token) {
  if (!token) throw new AppError('NO_SESSION', 'Authentication required.', 401);
  var th = sha256Hex(token);
  var s = dbFindBy('sessions', 'token_hash', th);
  if (!s || String(s.revoked) === 'TRUE') throw new AppError('NO_SESSION', 'Invalid session.', 401);
  if (nowMs() > Number(s.expires_at)) throw new AppError('SESSION_EXPIRED', 'Session expired. Please log in again.', 401);
  var u = dbGet('users', s.user_id);
  if (!u || String(u.active) !== 'TRUE') throw new AppError('NO_SESSION', 'Account unavailable.', 401);
  // touch last_seen (best-effort, not under lock)
  try { dbUpdate('sessions', s.id, { last_seen: nowIso() }, 'system'); } catch (e) {}
  return { session: s, user: u, roles: getUserRoles(u.id) };
}

/** Revoke the current session (logout). */
function logout(token) {
  if (!token) return { ok: true };
  var s = dbFindBy('sessions', 'token_hash', sha256Hex(token));
  if (s) { dbUpdate('sessions', s.id, { revoked: 'TRUE' }, 'system'); audit({ user_id: s.user_id, action: 'logout', module: 'auth' }); }
  return { ok: true };
}

/** Authenticated user changes their own password. */
function changePassword(authUser, oldPassword, newPassword) {
  var u = dbGet('users', authUser.id);
  if (!constantTimeEq(hashPassword(oldPassword || '', u.salt || 'x'), u.password_hash || ''))
    throw new AppError('AUTH_FAILED', 'Current password is incorrect.', 401);
  var res = setUserPassword(u.id, newPassword, { actor: u.email, mustReset: false });
  // revoke other sessions for safety
  revokeAllSessions_(u.id);
  audit({ user_id: u.id, user_email: u.email, action: 'password_changed', module: 'auth' });
  return res;
}

/** Admin resets a user's password to a generated temporary one (must_reset). */
function adminResetPassword(actorEmail, userId) {
  var temp = randomToken().slice(0, 10);
  setUserPassword(userId, temp + 'A1', { actor: actorEmail, mustReset: true });
  revokeAllSessions_(userId);
  return { temporary_password: temp + 'A1' };
}

function revokeAllSessions_(userId) {
  var rows = dbList('sessions', { user_id: userId });
  for (var i = 0; i < rows.length; i++) if (String(rows[i].revoked) !== 'TRUE') dbUpdate('sessions', rows[i].id, { revoked: 'TRUE' }, 'system');
}
