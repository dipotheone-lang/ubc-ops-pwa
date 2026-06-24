/**
 * set-all-passwords.mjs — set every user's password to a fixed value using only
 * already-deployed endpoints: admin.user.resetPassword (temp) -> auth.login (temp)
 * -> auth.changePassword (target, clears must_reset). Idempotent / re-runnable.
 *
 *   node v2/test/set-all-passwords.mjs [execUrl] [adminEmail] [adminPassword] [newPassword]
 */
const EXEC = process.argv[2] || 'https://script.google.com/macros/s/AKfycbwGnEeLqPeSXx4KX4MSYPwF_ZmDXEYZdOjzr5jEuLlCopl3Aw7yfoy7q8h3qlBYqhbE/exec';
const ADMIN_EMAIL = (process.argv[3] || 'admin@ubcsis.com').toLowerCase();
const ADMIN_PW = process.argv[4] || 'UbcAdmin#2026';
const NEW_PW = process.argv[5] || 'UbcAdmin#2026';

async function post(payload, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(EXEC, {
        method: 'POST', redirect: 'follow', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const txt = await res.text();
      clearTimeout(timer);
      let j; try { j = JSON.parse(txt); } catch { throw new Error('Bad response: ' + txt.slice(0, 160)); }
      if (!j.ok) { const e = new Error((j.error && j.error.message) || 'Request failed'); e.code = j.error && j.error.code; throw e; }
      return j.data;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      // App errors carry a STRING code (NO_SESSION, VALIDATION, …) — don't retry those.
      // Transport flakiness (AbortError code=20, fetch failures) has no string code — retry.
      if (typeof e.code === 'string') throw e;
      await new Promise(r => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw lastErr;
}

// The admin's own changePassword revokes all of its sessions, so we (a) never
// run the reset/change flow on the admin account inside the loop, and (b)
// transparently re-login admin if its token is ever invalidated.
let adminToken = '';
async function adminLogin() {
  const r = await post({ action: 'auth.login', email: ADMIN_EMAIL, password: ADMIN_PW });
  adminToken = r.token;
  return adminToken;
}
async function adminCall(payload) {
  try {
    return await post({ ...payload, token: adminToken });
  } catch (e) {
    if (e.code === 'NO_SESSION' || e.code === 'SESSION_EXPIRED') { await adminLogin(); return post({ ...payload, token: adminToken }); }
    throw e;
  }
}

// One full reset→login→change pass. changePassword is NOT retried (non-idempotent:
// a lost response on a succeeded change would otherwise re-run against a revoked
// session). Verification (login with the target password) is the source of truth.
async function setOne(userId, email) {
  const r = await adminCall({ action: 'admin.user.resetPassword', id: userId });
  const temp = r.temporary_password;
  const ul = await post({ action: 'auth.login', email, password: temp });
  await post({ action: 'auth.changePassword', token: ul.token, oldPassword: temp, newPassword: NEW_PW }, 1);
}

// True iff the account can log in with the target password right now.
async function verify(email) {
  try { await post({ action: 'auth.login', email, password: NEW_PW }); return true; }
  catch (e) { if (typeof e.code === 'string') return false; throw e; }
}

async function main() {
  console.log('Logging in as admin…');
  await adminLogin();
  console.log('  ok — admin session acquired.');

  const users = await adminCall({ action: 'admin.users' });
  const list = Array.isArray(users) ? users : (users.users || users.rows || []);
  console.log(`Found ${list.length} users.\n`);

  let done = 0, skipped = 0, failed = 0;
  for (const u of list) {
    const email = (u.email || '').toLowerCase();
    if (!email) { skipped++; continue; }
    if (email === ADMIN_EMAIL) {
      // already the target password (we just authenticated with it); changing it
      // here would revoke the admin session mid-run.
      skipped++; console.log(`  ↷ ${email} (admin — already "${NEW_PW}", skipped)`);
      continue;
    }
    let ok = await verify(email);            // maybe a prior run already set it
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      await setOne(u.id, email).catch(() => {});  // changePassword is non-idempotent;
      ok = await verify(email);                    // confirm by logging in with NEW_PW
    }
    if (ok) { done++; console.log(`  ✓ ${email}`); }
    else { failed++; console.log(`  ✗ ${email} — could not confirm login with target password`); }
  }
  console.log(`\nDone. set=${done} skipped=${skipped} failed=${failed}. All set to "${NEW_PW}".`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
