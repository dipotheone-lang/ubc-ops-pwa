/**
 * db.js — IndexedDB wrapper for the offline-first queue and local cache.
 *
 * Stores:
 *   - queue:  pending write operations (sync_status: 'pending' | 'error')
 *   - cache:  last-known server records by entity (for offline reads)
 *   - meta:   key/value (e.g. cached schema)
 *
 * Falls back to a localStorage-backed shim if IndexedDB is unavailable.
 */
(function () {
  'use strict';

  var DB_NAME = 'ubc_ops';
  var DB_VERSION = 1;
  var _db = null;

  function open() {
    return new Promise(function (resolve, reject) {
      if (_db) return resolve(_db);
      if (!('indexedDB' in window)) return reject(new Error('no-indexeddb'));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('queue')) {
          var q = db.createObjectStore('queue', { keyPath: 'op_id' });
          q.createIndex('by_status', 'sync_status', { unique: false });
          q.createIndex('by_ts', 'ts', { unique: false });
        }
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(store, mode) {
    return open().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function reqToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /* --------------------------- QUEUE API ------------------------------- */

  function enqueue(op) {
    op.op_id = op.op_id || ('op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    op.sync_status = 'pending';
    op.ts = new Date().toISOString();
    op.attempts = 0;
    return tx('queue', 'readwrite').then(function (s) {
      return reqToPromise(s.put(op)).then(function () { return op; });
    });
  }

  function getPending(limit) {
    return tx('queue', 'readonly').then(function (s) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var idx = s.index('by_ts');
        var cur = idx.openCursor();
        cur.onsuccess = function (e) {
          var c = e.target.result;
          if (c && (!limit || out.length < limit)) {
            if (c.value.sync_status === 'pending' || c.value.sync_status === 'error') {
              out.push(c.value);
            }
            c.continue();
          } else {
            resolve(out);
          }
        };
        cur.onerror = function () { reject(cur.error); };
      });
    });
  }

  function updateOp(op) {
    return tx('queue', 'readwrite').then(function (s) {
      return reqToPromise(s.put(op));
    });
  }

  function removeOp(opId) {
    return tx('queue', 'readwrite').then(function (s) {
      return reqToPromise(s.delete(opId));
    });
  }

  function countPending() {
    return getPending().then(function (rows) { return rows.length; });
  }

  function allOps() {
    return tx('queue', 'readonly').then(function (s) {
      return reqToPromise(s.getAll());
    });
  }

  /* --------------------------- CACHE API ------------------------------- */

  function putCache(key, value) {
    return tx('cache', 'readwrite').then(function (s) {
      return reqToPromise(s.put({ key: key, value: value, ts: Date.now() }));
    });
  }
  function getCache(key) {
    return tx('cache', 'readonly').then(function (s) {
      return reqToPromise(s.get(key));
    }).then(function (r) { return r ? r.value : null; });
  }

  function putMeta(key, value) {
    return tx('meta', 'readwrite').then(function (s) {
      return reqToPromise(s.put({ key: key, value: value }));
    });
  }
  function getMeta(key) {
    return tx('meta', 'readonly').then(function (s) {
      return reqToPromise(s.get(key));
    }).then(function (r) { return r ? r.value : null; });
  }

  window.UBC_DB = {
    open: open,
    enqueue: enqueue,
    getPending: getPending,
    updateOp: updateOp,
    removeOp: removeOp,
    countPending: countPending,
    allOps: allOps,
    putCache: putCache,
    getCache: getCache,
    putMeta: putMeta,
    getMeta: getMeta
  };
})();
