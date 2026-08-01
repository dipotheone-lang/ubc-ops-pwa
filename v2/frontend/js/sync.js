/**
 * sync.js — offline write queue for field-ops mutations.
 *
 * When a queueable mutation is attempted while the device is offline, it is
 * persisted to localStorage and replayed, in order, once connectivity returns.
 *
 * We ONLY queue when navigator.onLine is false — i.e. the request provably never
 * left the device — so a replay can never duplicate a write the server already
 * applied. The v2 backend has no idempotency keys, so this conservative rule is
 * deliberate: an ambiguous mid-flight failure while online is surfaced as an
 * error rather than silently retried.
 */
(function () {
  'use strict';
  var KEY = 'ubc_outbox';
  var listeners = [];

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function save(q) { localStorage.setItem(KEY, JSON.stringify(q)); }
  function pending() { return load().length; }
  function onChange(fn) { listeners.push(fn); }
  function notify() { var n = pending(); listeners.forEach(function (fn) { try { fn(n); } catch (e) {} }); }

  // Only self-contained document/master creates are safe to capture offline.
  function isQueueable(action) { return /\.create$/.test(String(action || '')); }

  // Auth failures are transient for a queued op (the session captured at capture
  // time may have expired) — keep it queued so it replays after re-login rather
  // than being dropped, which would silently lose an offline-captured record.
  var AUTH_CODES = { NO_SESSION: 1, SESSION_EXPIRED: 1, AUTH_FAILED: 1, LOCKED: 1, ACCOUNT_DISABLED: 1 };

  function enqueue(action, payload) {
    // Never persist the session token: it may be stale by replay time, and
    // API.post attaches the current token on send. Strip it from the stored op.
    var clean = {}; payload = payload || {};
    for (var k in payload) if (payload.hasOwnProperty(k) && k !== 'token') clean[k] = payload[k];
    var q = load();
    q.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), action: action, payload: clean, at: new Date().toISOString() });
    save(q); notify();
    return { queued: true, offline: true };
  }

  var draining = false;
  function drain() {
    if (draining || !navigator.onLine) return Promise.resolve(0);
    draining = true;
    var q = load(), done = 0;
    function step() {
      if (!q.length || !navigator.onLine) return;
      var op = q[0], body = { action: op.action };
      for (var k in op.payload) if (op.payload.hasOwnProperty(k) && k !== 'token') body[k] = op.payload[k];
      return API.post(body).then(function () {
        q.shift(); save(q); done++; notify(); return step();
      }, function (err) {
        var code = err && err.code;
        // Deterministic non-auth rejection (e.g. VALIDATION) → drop it; retrying
        // won't help. Auth failure or network error → stop, keep it queued.
        if (typeof code === 'string' && !AUTH_CODES[code]) { q.shift(); save(q); notify(); return step(); }
        throw err;
      });
    }
    return Promise.resolve().then(step).then(
      function () { draining = false; return done; },
      function () { draining = false; return done; }
    );
  }

  function init(onChangeFn) {
    if (onChangeFn) onChange(onChangeFn);
    window.addEventListener('online', function () {
      drain().then(function (n) { if (n && window.UI) UI.toast((window.I18N && I18N.t('sync_done')) || 'Synced', 'success'); });
    });
    window.addEventListener('offline', notify);
    if (navigator.onLine) drain();
    notify();
  }

  window.SYNC = { enqueue: enqueue, drain: drain, pending: pending, onChange: onChange, isQueueable: isQueueable, init: init };
})();
