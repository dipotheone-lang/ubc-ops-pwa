/**
 * api.js — session-based REST client for the v2 Apps Script Web App.
 * Posts JSON as text/plain (Apps Script CORS-friendly). Carries the session
 * token from localStorage on every call.
 */
(function () {
  'use strict';

  function base() {
    var b = localStorage.getItem('ubc_api_base') || '';
    if (!b) throw new Error('API URL not configured.');
    return b;
  }
  function token() { return localStorage.getItem('ubc_token') || ''; }
  function setToken(t) { if (t) localStorage.setItem('ubc_token', t); else localStorage.removeItem('ubc_token'); }

  function post(payload) {
    payload = payload || {};
    if (!payload.token && token()) payload.token = token();
    return fetch(base(), {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (txt) {
        var j; try { j = JSON.parse(txt); } catch (e) { throw new Error('Bad response: ' + txt.slice(0, 200)); }
        if (!j.ok) { var err = new Error((j.error && j.error.message) || 'Request failed'); err.code = j.error && j.error.code; throw err; }
        return j.data;
      });
    });
  }

  window.API = {
    setBase: function (b) { localStorage.setItem('ubc_api_base', b); },
    getBase: function () { return localStorage.getItem('ubc_api_base') || ''; },
    setToken: setToken, getToken: token,
    post: post,
    login: function (email, password) { return post({ action: 'auth.login', email: email, password: password }); },
    logout: function () { return post({ action: 'auth.logout' }).then(function (r) { setToken(''); return r; }); },
    bootstrap: function () { return post({ action: 'bootstrap' }); },
    list: function (entity, filter) { return post({ action: 'list', entity: entity, filter: filter || null }); },
    act: function (action, payload) { payload = payload || {}; payload.action = action; return post(payload); }
  };
})();
