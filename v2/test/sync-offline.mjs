/**
 * sync-offline.mjs — unit test for the offline write queue (frontend/js/sync.js).
 * Loads sync.js into a mocked browser-ish VM context and exercises enqueue/drain
 * across offline → online transitions and server/network failure modes.
 *   node v2/test/sync-offline.mjs
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../frontend/js/sync.js', import.meta.url), 'utf8');

function makeEnv(apiPost, online = true) {
  const store = {};
  const win = {};
  const sandbox = {
    window: win,
    console,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    navigator: { onLine: online },
    API: { calls: [], post: apiPost }
  };
  win.addEventListener = (ev, fn) => { (win._h = win._h || {})[ev] = fn; };
  win.UI = { toast() {} };
  win.I18N = { t: (k) => k };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { SYNC: win.SYNC, env: sandbox, store, win };
}

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.log('FAIL ' + msg); } else console.log('PASS ' + msg); }

async function run() {
  // 1) Offline enqueue does not hit the network.
  {
    let posted = 0;
    const { SYNC, env } = makeEnv(() => { posted++; return Promise.resolve({ ok: true }); }, false);
    SYNC.enqueue('con.dsr.create', { record: { report_date: '2026-02-01' } });
    assert(SYNC.pending() === 1, 'offline enqueue stores the op');
    assert(posted === 0, 'offline enqueue does not call the API');
    const drained = await SYNC.drain();
    assert(drained === 0 && SYNC.pending() === 1, 'drain is a no-op while offline');
  }

  // 2) Coming online drains the queue in order.
  {
    const seen = [];
    const { SYNC, env } = makeEnv((body) => { seen.push(body.action); return Promise.resolve({ ok: true }); }, false);
    SYNC.enqueue('a.create', { n: 1 });
    SYNC.enqueue('b.create', { n: 2 });
    env.navigator.onLine = true;
    const n = await SYNC.drain();
    assert(n === 2 && SYNC.pending() === 0, 'online drain flushes all queued ops');
    assert(seen.join(',') === 'a.create,b.create', 'ops replay in FIFO order with action set');
  }

  // 3) Deterministic server rejection (string code) is dropped, not retried forever.
  {
    let calls = 0;
    const { SYNC } = makeEnv(() => { calls++; const e = new Error('bad'); e.code = 'VALIDATION'; return Promise.reject(e); }, true);
    SYNC.enqueue('x.create', {});
    const n = await SYNC.drain();
    assert(calls === 1 && SYNC.pending() === 0, 'server-rejected op is dropped after one attempt');
    assert(n === 0, 'drain reports zero successful replays');
  }

  // 4) Network failure (no code) keeps the op queued for a later retry.
  {
    let calls = 0;
    const { SYNC } = makeEnv(() => { calls++; return Promise.reject(new Error('network down')); }, true);
    SYNC.enqueue('y.create', {});
    await SYNC.drain();
    assert(SYNC.pending() === 1, 'network failure keeps the op queued');
    assert(calls === 1, 'network failure stops the drain (no tight-loop retry)');
  }

  // 5) Session expiry does NOT drop the op — it stays queued and replays after re-auth.
  {
    let attempt = 0;
    const { SYNC } = makeEnv(() => {
      attempt++;
      if (attempt === 1) { const e = new Error('expired'); e.code = 'SESSION_EXPIRED'; return Promise.reject(e); }
      return Promise.resolve({ ok: true }); // second drain, post re-login, succeeds
    }, true);
    SYNC.enqueue('z.create', { record: { x: 1 } });
    await SYNC.drain();
    assert(SYNC.pending() === 1, 'expired-session op is NOT dropped (kept for retry)');
    await SYNC.drain(); // simulate drain after re-login
    assert(SYNC.pending() === 0, 'op replays successfully after re-auth');
  }

  // 6) The stored op never carries a session token (re-attached fresh on replay).
  {
    let sentToken = 'unset';
    const { SYNC, store } = makeEnv((body) => { sentToken = body.token; return Promise.resolve({ ok: true }); }, false);
    SYNC.enqueue('t.create', { record: {}, token: 'stale-token-123' });
    assert(JSON.parse(store.ubc_outbox)[0].payload.token === undefined, 'queued op does not persist the session token');
  }

  console.log(failures ? ('\nFAILED (' + failures + ')') : '\nDONE — all offline-queue tests passed.');
  if (failures) process.exit(1);
}
run();
