/**
 * notifications.js — self-wiring in-app notification center.
 *
 * Injects a bell + unread badge into the top bar, polls the backend, and renders
 * a dropdown feed with mark-read / mark-all-read. Deliberately self-contained:
 * it hooks the DOM directly (no app.js changes required) and navigates via the
 * optional window.APP.go bridge when a notification carries a view link.
 */
(function () {
  'use strict';
  var el = UI.el, t = I18N.t;
  var POLL_MS = 45000;
  var lastCount = -1, panel = null, timer = null;

  function loggedIn() {
    var bar = document.getElementById('appbar');
    return API.getToken() && bar && bar.style.display !== 'none';
  }

  function ensureBell() {
    if (document.getElementById('notif-bell')) return true;
    var host = document.querySelector('#appbar .topbar-right');
    if (!host) return false;
    var wrap = el('div', { id: 'notif-bell', class: 'notif-wrap' }, [
      el('button', { class: 'icon-btn notif-btn', title: t('notifications'), 'aria-label': t('notifications'),
        onclick: togglePanel }, ['🔔']),
      el('span', { id: 'notif-badge', class: 'notif-badge', style: 'display:none' })
    ]);
    host.insertBefore(wrap, host.firstChild);
    return true;
  }

  function setBadge(n) {
    var b = document.getElementById('notif-badge'); if (!b) return;
    if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.style.display = ''; }
    else b.style.display = 'none';
  }

  function poll() {
    if (!loggedIn()) return;
    if (!ensureBell()) return;
    API.act('notifications.unread').then(function (r) {
      var n = (r && r.count) || 0;
      setBadge(n);
      if (panel && n !== lastCount) renderList();
      lastCount = n;
    }).catch(function () {});
  }

  function togglePanel() {
    if (panel) { closePanel(); return; }
    panel = el('div', { class: 'notif-panel', id: 'notif-panel' }, [
      el('div', { class: 'notif-head' }, [
        el('strong', { text: t('notifications') }),
        el('button', { class: 'link-btn', text: t('mark_all_read'), onclick: markAll })
      ]),
      el('div', { class: 'notif-list', id: 'notif-list' }, [el('div', { class: 'muted', text: t('loading') })])
    ]);
    var wrap = document.getElementById('notif-bell'); wrap.appendChild(panel);
    setTimeout(function () { document.addEventListener('click', outside, true); }, 0);
    renderList();
  }
  function closePanel() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null; document.removeEventListener('click', outside, true);
  }
  function outside(e) {
    var wrap = document.getElementById('notif-bell');
    if (wrap && !wrap.contains(e.target)) closePanel();
  }

  function timeAgo(iso) {
    if (!iso) return '';
    var then = Date.parse(String(iso).replace(/([+-]\d\d):?(\d\d)$/, '$1:$2'));
    if (isNaN(then)) return String(iso).slice(0, 16).replace('T', ' ');
    var s = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (s < 60) return t('just_now');
    if (s < 3600) return Math.floor(s / 60) + t('m_ago');
    if (s < 86400) return Math.floor(s / 3600) + t('h_ago');
    return Math.floor(s / 86400) + t('d_ago');
  }

  var ICON = { approval: '📝', approved: '✅', rejected: '⛔', info: 'ℹ️', user: '👤' };

  function renderList() {
    var holder = document.getElementById('notif-list'); if (!holder) return;
    API.act('notifications.list', { limit: 30 }).then(function (rows) {
      UI.clear(holder);
      if (!rows || !rows.length) { holder.appendChild(el('div', { class: 'muted notif-empty', text: t('no_notifications') })); return; }
      rows.forEach(function (n) {
        var unread = String(n.read).toUpperCase() !== 'TRUE';
        var item = el('div', { class: 'notif-item' + (unread ? ' unread' : ''), onclick: function () { open(n); } }, [
          el('span', { class: 'notif-icon', text: ICON[n.type] || '•' }),
          el('div', { class: 'notif-body' }, [
            el('div', { class: 'notif-title', text: n.title || '' }),
            n.body ? el('div', { class: 'notif-sub', text: n.body }) : null,
            el('div', { class: 'notif-time', text: timeAgo(n.created_at) })
          ])
        ]);
        holder.appendChild(item);
      });
    }).catch(function (e) { UI.clear(holder); holder.appendChild(el('div', { class: 'error-box', text: e.message })); });
  }

  function open(n) {
    var done = function () {
      lastCount = -1; poll();
      if (n.link && window.APP && typeof window.APP.go === 'function') { closePanel(); window.APP.go(n.link); }
      else renderList();
    };
    if (String(n.read).toUpperCase() !== 'TRUE') API.act('notifications.markRead', { id: n.id }).then(done).catch(done);
    else done();
  }
  function markAll() {
    API.act('notifications.markAllRead').then(function () { lastCount = -1; poll(); renderList(); }).catch(function () {});
  }

  function start() {
    if (timer) return;
    timer = setInterval(poll, POLL_MS);
    poll();
  }
  // Kick off once the shell is ready; poll() no-ops until the user is logged in.
  document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1500); });
  window.NOTIFY = { refresh: function () { lastCount = -1; poll(); }, start: start };
})();
