/**
 * api.js — thin REST client for the Apps Script Web App.
 *
 * Apps Script Web Apps do not return CORS preflight-friendly headers for
 * custom content types, so we POST as text/plain (a "simple request") with a
 * JSON string body. This is the canonical pattern for fetch() -> Apps Script.
 */
(function () {
  'use strict';

  function base() {
    var b = window.getApiBase();
    if (!b) throw new Error('API base URL is not configured. Open Settings.');
    return b;
  }

  /** Low-level POST. Returns the parsed envelope's .data, or throws on error. */
  function post(payload) {
    payload = payload || {};
    if (!payload.token) payload.token = window.getApiToken();
    if (!payload.actor) payload.actor = window.getActor();
    return fetch(base(), {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(parseEnvelope);
  }

  /** GET for simple reads. params is an object. */
  function get(params) {
    var qs = Object.keys(params || {}).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(
        typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]);
    }).join('&');
    return fetch(base() + (qs ? '?' + qs : ''), { method: 'GET', redirect: 'follow' })
      .then(parseEnvelope);
  }

  function parseEnvelope(res) {
    return res.text().then(function (text) {
      var json;
      try { json = JSON.parse(text); }
      catch (e) { throw new Error('Bad server response (' + res.status + '): ' + text.slice(0, 200)); }
      if (!json.ok) {
        var err = new Error((json.error && json.error.message) || 'Request failed');
        err.code = json.error && json.error.code;
        throw err;
      }
      return json.data;
    });
  }

  /* ----------------------------- helpers ------------------------------- */

  window.UBC_API = {
    post: post,
    get: get,

    ping: function () { return get({ action: 'ping' }); },
    schema: function () { return get({ action: 'schema' }); },
    list: function (entity, filter) {
      var p = { action: 'list', entity: entity };
      if (filter) p.filter = filter;
      return get(p);
    },
    getOne: function (entity, id) { return get({ action: 'get', entity: entity, id: id }); },

    // Writes go through post() so they carry the token.
    action: function (action, payload) {
      payload = payload || {};
      payload.action = action;
      return post(payload);
    },

    // Batch sync of offline queue ops.
    syncPush: function (ops) {
      return post({ action: 'sync.push', ops: ops });
    },

    // Chunked upload protocol.
    uploadBegin: function (meta) { return post({ action: 'upload.begin', meta: meta }); },
    uploadChunk: function (uploadId, index, chunk) {
      return post({ action: 'upload.chunk', uploadId: uploadId, index: index, chunk: chunk });
    },
    uploadFinish: function (uploadId) { return post({ action: 'upload.finish', uploadId: uploadId }); },

    uploadSmall: function (folderId, fileName, mimeType, base64) {
      return post({ action: 'file.upload', folderId: folderId, fileName: fileName, mimeType: mimeType, base64: base64 });
    }
  };
})();
