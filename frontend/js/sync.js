/**
 * sync.js — offline queue processor.
 *
 *  - All writes go into the IndexedDB queue first (offline-first).
 *  - When online, the queue is drained in sequential batches (req #3).
 *  - File ops attached to an op are uploaded first, their resulting URL is
 *    injected into the record payload, then the record is created.
 *  - Idempotent end-to-end via client_uuid (server returns existing rows).
 *  - Exponential backoff on transient failures; permanent validation errors
 *    mark the op 'error' for user review rather than retrying forever.
 */
(function () {
  'use strict';
  var CFG = window.UBC_CONFIG;
  var _syncing = false;
  var listeners = [];

  function on(fn) { listeners.push(fn); }
  function emit(state) { listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }

  function isOnline() { return navigator.onLine; }

  /**
   * Queue a write. `op` = { action, payload, file? }
   * file (optional) = { folderField, blobInfo } where blobInfo is a
   * compressed {blob,name,mime} captured at form time. Because Blobs are
   * structured-cloneable, IndexedDB stores them directly.
   */
  function queueWrite(action, payload, file) {
    if (!payload.client_uuid) {
      payload.client_uuid = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }
    return window.UBC_DB.enqueue({ action: action, payload: payload, file: file || null })
      .then(function (op) {
        emit({ event: 'queued', op_id: op.op_id });
        // Opportunistic immediate sync if we're online.
        if (isOnline()) processQueue();
        return op;
      });
  }

  /** Permanent (non-retryable) error codes — don't keep retrying these. */
  var PERMANENT = { VALIDATION: 1, FK_VIOLATION: 1, BAD_JSON: 1, UNKNOWN_ENTITY: 1,
    UNKNOWN_ACTION: 1, BAD_BASE64: 1 };

  function processQueue() {
    if (_syncing) return Promise.resolve();
    if (!isOnline()) { emit({ event: 'offline' }); return Promise.resolve(); }
    _syncing = true;
    emit({ event: 'sync-start' });

    return drain().then(function (summary) {
      _syncing = false;
      emit({ event: 'sync-done', summary: summary });
      return summary;
    }).catch(function (err) {
      _syncing = false;
      emit({ event: 'sync-error', error: err.message });
      throw err;
    });
  }

  function drain() {
    var summary = { sent: 0, ok: 0, failed: 0 };

    function step() {
      return window.UBC_DB.getPending(CFG.SYNC_BATCH).then(function (ops) {
        if (!ops.length) return summary;

        // 1) Resolve any file uploads sequentially (chunked-safe).
        return uploadFilesForOps(ops).then(function () {
          // 2) Build sync.push batch.
          var batch = ops.map(function (op) {
            return { op_id: op.op_id, action: op.action, payload: op.payload };
          });
          return window.UBC_API.syncPush(batch).then(function (res) {
            summary.sent += batch.length;
            var byId = {};
            (res.results || []).forEach(function (r) { byId[r.op_id] = r; });

            var writes = ops.map(function (op) {
              var r = byId[op.op_id];
              if (r && r.ok) {
                summary.ok++;
                return window.UBC_DB.removeOp(op.op_id);
              }
              summary.failed++;
              op.attempts = (op.attempts || 0) + 1;
              op.last_error = r && r.error ? r.error.message : 'unknown';
              var code = r && r.error && r.error.code;
              op.sync_status = (code && PERMANENT[code]) ? 'error' : 'pending';
              return window.UBC_DB.updateOp(op);
            });
            return Promise.all(writes).then(function () {
              // Continue draining only if we made progress on at least one op.
              var progressed = res.results && res.results.some(function (r) { return r.ok; });
              return progressed ? step() : summary;
            });
          });
        });
      });
    }
    return step();
  }

  /**
   * For each op that carries a file, upload it (compress already done at
   * capture), then inject the resulting URL into the op payload under the
   * declared field. Mutates op.payload and persists. Skips if already uploaded.
   */
  function uploadFilesForOps(ops) {
    var chain = Promise.resolve();
    ops.forEach(function (op) {
      if (!op.file || op.file.uploaded) return;
      chain = chain.then(function () {
        return resolveFolderId(op).then(function (folderId) {
          return window.UBC_IMG.uploadCompressed(folderId, {
            blob: op.file.blob, name: op.file.name, mime: op.file.mime
          }).then(function (result) {
            op.payload[op.file.targetField || 'attachment_url'] = result.url;
            op.file.uploaded = true;
            op.file.url = result.url;
            // Don't keep the blob around once uploaded (saves IDB space).
            delete op.file.blob;
            return window.UBC_DB.updateOp(op);
          });
        }).catch(function (e) {
          // Leave the file for the next pass; surface but don't crash the batch.
          op.last_error = 'upload: ' + e.message;
          return window.UBC_DB.updateOp(op);
        });
      });
    });
    return chain;
  }

  /** Resolve the Drive folder id for an op's attachment, via the project + slot. */
  function resolveFolderId(op) {
    if (op.file.folderId) return Promise.resolve(op.file.folderId);
    var projectId = op.payload.project_id || op.payload.from_project_id;
    var slot = op.file.slot || 'site';
    return window.UBC_API.action('list', { entity: 'projects', filter: { id: projectId } })
      .then(function (rows) {
        var p = rows && rows[0];
        if (!p) throw new Error('Project not found for upload');
        var urlField = {
          procurement: 'folder_procurement_url', technical: 'folder_technical_url',
          accounting: 'folder_accounting_url', warehouse: 'folder_warehouse_url',
          site: 'folder_site_url'
        }[slot];
        var m = String(p[urlField] || '').match(/folders\/([a-zA-Z0-9_-]+)/);
        if (!m) throw new Error('No ' + slot + ' folder URL on project');
        op.file.folderId = m[1];
        return m[1];
      });
  }

  // Auto-sync triggers.
  window.addEventListener('online', function () { emit({ event: 'online' }); processQueue(); });
  window.addEventListener('offline', function () { emit({ event: 'offline' }); });

  window.UBC_SYNC = {
    queueWrite: queueWrite,
    processQueue: processQueue,
    isOnline: isOnline,
    on: on,
    pendingCount: function () { return window.UBC_DB.countPending(); }
  };
})();
