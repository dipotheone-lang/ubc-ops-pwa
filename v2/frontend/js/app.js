/**
 * app.js — v2 PWA shell: login, bootstrap, role-aware nav + views.
 */
(function () {
  'use strict';
  var el = UI.el, t = I18N.t, toast = UI.toast;
  var STATE = { user: null, roles: [], perms: [], lookups: [], company: null, pending: 0 };

  /* ----------------------------- boot ---------------------------------- */
  function boot() {
    I18N.applyDir();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(function () {});
    document.getElementById('lang-btn').addEventListener('click', function () { I18N.toggle(); render(); });
    if (API.getToken() && API.getBase()) { afterLogin().catch(showLogin); }
    else showLogin();
  }

  /* ------------------------- permission helper ------------------------- */
  function can(module, entity, action) {
    return STATE.perms.some(function (p) {
      var m = (p.module === '*' || p.module === module);
      var e = (p.entity === '*' || p.entity === entity);
      var a = (p.action === action || p.action === 'admin');
      return m && e && a;
    });
  }

  /* ----------------------------- login --------------------------------- */
  function showLogin() {
    var root = document.getElementById('root'); UI.clear(root);
    document.getElementById('appbar').style.display = 'none';
    var card = el('div', { class: 'login-card' });
    card.appendChild(el('h1', { text: t('app') }));
    card.appendChild(el('p', { class: 'muted', text: STATE.company ? '' : 'UBcsis — CR 66236' }));

    var urlField = API.getBase() ? null : el('div', { class: 'field' }, [
      el('label', { text: t('server_url') }),
      el('input', { id: 'login_url', type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec' })
    ]);
    if (urlField) card.appendChild(urlField);

    var f = UI.form([
      { name: 'email', label: t('email'), type: 'email', required: true },
      { name: 'password', label: t('password'), type: 'password', required: true }
    ], t('login'), function (v) {
      if (urlField) { var u = document.getElementById('login_url').value.trim(); if (u) API.setBase(u); }
      if (!API.getBase()) { toast(t('server_url'), 'error'); return; }
      return API.login(v.email.toLowerCase().trim(), v.password).then(function (res) {
        API.setToken(res.token);
        if (res.must_reset) return forceReset();
        return afterLogin();
      });
    });
    card.appendChild(f.form);
    card.appendChild(el('button', { class: 'link-btn', text: I18N.t('lang_toggle'), onclick: function () { I18N.toggle(); showLogin(); } }));
    root.appendChild(card);
  }

  function forceReset() {
    var root = document.getElementById('root'); UI.clear(root);
    root.appendChild(el('div', { class: 'login-card' }, [
      el('h2', { text: t('change_password') }),
      el('p', { class: 'muted', text: t('must_reset') }),
      UI.form([{ name: 'newp', label: t('new_password'), type: 'password', required: true }], t('save'), function (v) {
        return API.act('auth.changePassword', { oldPassword: '__current__', newPassword: v.newp })
          .then(function () { return afterLogin(); })
          .catch(function () {
            // first-login: temp pw unknown to user flow; ask them to use the temp as current
            toast('Enter current (temporary) password too', 'info');
            return resetWithOld();
          });
      }).form
    ]));
  }
  function resetWithOld() {
    var root = document.getElementById('root'); UI.clear(root);
    root.appendChild(el('div', { class: 'login-card' }, [
      el('h2', { text: t('change_password') }),
      UI.form([
        { name: 'oldp', label: t('old_password'), type: 'password', required: true },
        { name: 'newp', label: t('new_password'), type: 'password', required: true }
      ], t('save'), function (v) {
        return API.act('auth.changePassword', { oldPassword: v.oldp, newPassword: v.newp })
          .then(function () { toast(t('save'), 'success'); return afterLogin(); });
      }).form
    ]));
  }

  /* --------------------------- after login ----------------------------- */
  function afterLogin() {
    return API.bootstrap().then(function (b) {
      STATE.user = b.user; STATE.roles = b.roles; STATE.perms = b.permissions || [];
      STATE.lookups = b.lookups || []; STATE.company = b.company; STATE.pending = b.pending_approvals || 0;
      document.getElementById('appbar').style.display = 'flex';
      render();
    });
  }

  /* ----------------------------- render -------------------------------- */
  function render() {
    I18N.applyDir();
    if (!STATE.user) { showLogin(); return; }
    document.getElementById('app-title').textContent = t('app');
    var who = document.getElementById('whoami');
    who.textContent = (I18N.current() === 'ar' ? STATE.user.full_name_ar : STATE.user.full_name_en) || STATE.user.email;
    document.getElementById('lang-btn').textContent = I18N.t('lang_toggle');

    // nav
    var nav = document.getElementById('nav'); UI.clear(nav);
    var items = [['dashboard', t('dashboard'), true]];
    items.push(['approvals', t('approvals'), true]);
    if (can('masters', 'clients', 'view')) items.push(['clients', t('clients'), true]);
    if (can('masters', 'suppliers', 'view')) items.push(['suppliers', t('suppliers'), true]);
    if (can('masters', 'projects', 'view')) items.push(['projects', t('projects'), true]);
    if (can('admin', 'users', 'view') || can('admin', 'users', 'admin')) items.push(['users', t('users'), true]);
    items.push(['settings', t('settings'), true]);
    items.forEach(function (it) {
      nav.appendChild(el('a', { class: 'nav-item' + (STATE.view === it[0] ? ' active' : ''), href: 'javascript:void 0',
        onclick: function () { go(it[0]); } }, [it[1] + (it[0] === 'approvals' && STATE.pending ? ' (' + STATE.pending + ')' : '')]));
    });

    go(STATE.view || 'dashboard');
  }

  function go(view) {
    STATE.view = view;
    document.querySelectorAll('.nav-item').forEach(function (a) { a.classList.remove('active'); });
    var main = document.getElementById('view'); UI.clear(main);
    main.appendChild(el('div', { class: 'loading', text: t('loading') }));
    var fn = ({ dashboard: vDashboard, approvals: vApprovals, clients: vClients, suppliers: vSuppliers,
      projects: vProjects, users: vUsers, settings: vSettings })[view] || vDashboard;
    Promise.resolve(fn()).then(function (node) { UI.clear(main); main.appendChild(node); })
      .catch(function (e) { UI.clear(main); main.appendChild(el('div', { class: 'error-box', text: e.message })); });
    // refresh nav active state
    var nav = document.getElementById('nav');
    Array.prototype.forEach.call(nav.children, function (a) { if (a.textContent.indexOf(t(view)) === 0) a.classList.add('active'); });
  }

  function section(title) { return el('div', { class: 'section-head' }, [el('h2', { text: title })]); }
  function card(title, body) { return el('div', { class: 'card' }, [title ? el('h3', { text: title }) : null, body]); }
  function sectorOptions() {
    return STATE.lookups.filter(function (l) { return l.category === 'sector'; })
      .map(function (l) { return { value: l.code, label: I18N.current() === 'ar' ? l.label_ar : l.label_en }; });
  }

  /* ----------------------------- views --------------------------------- */
  function vDashboard() {
    var wrap = el('div', {});
    wrap.appendChild(section(t('welcome') + ' ' + (I18N.pick(STATE.user, 'full_name') || STATE.user.email)));
    wrap.appendChild(el('div', { class: 'stats' }, [
      stat(t('pending_approvals'), STATE.pending),
      stat(t('role_label'), (STATE.roles[0] && STATE.roles[0].role_code) || '—'),
      stat(t('app'), STATE.company ? STATE.company.commercial_register : 'UBcsis')
    ]));
    return Promise.resolve(wrap);
  }
  function stat(label, val) { return el('div', { class: 'stat' }, [el('div', { class: 'stat-value', text: String(val) }), el('div', { class: 'stat-label', text: label })]); }

  function vApprovals() {
    return API.act('approvals.pending').then(function (rows) {
      var wrap = el('div', {}); wrap.appendChild(section(t('approvals')));
      if (!rows.length) { wrap.appendChild(el('p', { class: 'muted', text: t('no_records') })); return wrap; }
      rows.forEach(function (it) {
        var r = it.request, s = it.step, roles = JSON.parse(s.roles_json || '[]');
        var box = el('div', { class: 'card' }, [
          el('div', { class: 'kv' }, [
            el('span', { text: t('domain') + ': ' + r.domain }),
            el('span', { text: t('amount') + ': ' + (r.amount || 0) + ' ' + (r.currency || '') }),
            el('span', { text: t('step') + ' ' + s.step_no + ' / ' + r.total_steps }),
            el('span', { text: t('role') + ': ' + roles.join(', ') })
          ]),
          el('div', { class: 'row-actions' }, [
            el('input', { id: 'cmt_' + r.id, placeholder: t('comment'), class: 'cmt' }),
            el('button', { class: 'btn primary small', text: t('approve'), onclick: function () { decide(r.id, 'approve'); } }),
            el('button', { class: 'btn danger small', text: t('reject'), onclick: function () { decide(r.id, 'reject'); } })
          ])
        ]);
        wrap.appendChild(box);
      });
      return wrap;
    });
  }
  function decide(reqId, decision) {
    var c = document.getElementById('cmt_' + reqId);
    API.act('approvals.decide', { request_id: reqId, decision: decision, comment: c ? c.value : '' })
      .then(function (res) {
        toast(res.request.status, 'success');
        return API.bootstrap();
      }).then(function (b) { STATE.pending = b.pending_approvals || 0; render(); go('approvals'); })
      .catch(function (e) { toast(e.message, 'error'); });
  }

  function masterList(entity, cols, canCreate, createFields, createAction) {
    return API.list(entity).then(function (rows) {
      var wrap = el('div', {}); wrap.appendChild(section(t(entity)));
      if (canCreate) {
        var f = UI.form(createFields(), t('create'), function (v) {
          return API.act(createAction, { record: v }).then(function (res) {
            toast(t('create') + ' ✓' + (res.temporary_password ? (' — ' + t('temp_password') + ': ' + res.temporary_password) : ''), 'success');
            go(entity);
          });
        });
        wrap.appendChild(card(t('add'), f.form));
      }
      wrap.appendChild(card(null, UI.table(rows, cols)));
      return wrap;
    });
  }

  function vClients() {
    return masterList('clients',
      [{ key: 'client_code', label: t('code') }, { label: t('name_en'), render: function (r) { return I18N.pick(r, 'name'); } },
       { key: 'sector', label: t('sector') }, { key: 'status', label: t('status') }],
      can('masters', 'clients', 'create'),
      function () { return [
        { name: 'name_en', label: t('name_en'), required: true }, { name: 'name_ar', label: t('name_ar') },
        { name: 'sector', label: t('sector'), type: 'select', options: sectorOptions() },
        { name: 'tax_id', label: 'Tax ID' }, { name: 'contact_phone', label: 'Phone' }
      ]; }, 'masters.client.create');
  }
  function vSuppliers() {
    return masterList('suppliers',
      [{ key: 'supplier_code', label: t('code') }, { label: t('name_en'), render: function (r) { return I18N.pick(r, 'name'); } },
       { key: 'category', label: t('sector') }, { key: 'avl_status', label: t('status') }],
      can('masters', 'suppliers', 'create'),
      function () { return [
        { name: 'name_en', label: t('name_en'), required: true }, { name: 'name_ar', label: t('name_ar') },
        { name: 'category', label: t('sector') }, { name: 'tax_id', label: 'Tax ID' }
      ]; }, 'masters.supplier.create');
  }
  function vProjects() {
    return API.list('clients').then(function (clients) {
      var clientOpts = clients.map(function (c) { return { value: c.id, label: I18N.pick(c, 'name') }; });
      return masterList('projects',
        [{ key: 'project_code', label: t('code') }, { label: t('name_en'), render: function (r) { return I18N.pick(r, 'name'); } },
         { key: 'client_ref', label: t('client') }, { key: 'status', label: t('status') },
         { label: 'Drive', render: function (r) { return r.drive_root_url ? el('a', { href: r.drive_root_url, target: '_blank', text: 'Open' }) : ''; } }],
        can('masters', 'projects', 'create'),
        function () { return [
          { name: 'name_en', label: t('name_en'), required: true }, { name: 'name_ar', label: t('name_ar') },
          { name: 'client_id', label: t('client'), type: 'select', required: true, options: clientOpts },
          { name: 'client_ref', label: 'Client Ref / PO' },
          { name: 'sector', label: t('sector'), type: 'select', options: sectorOptions() },
          { name: 'contract_value', label: t('value'), type: 'number' },
          { name: 'currency', label: t('currency'), type: 'select', options: ['EGP', 'USD', 'EUR', 'GBP'] }
        ]; }, 'masters.project.create');
    });
  }

  function vUsers() {
    return API.list('users').then(function (rows) {
      var wrap = el('div', {}); wrap.appendChild(section(t('users')));
      if (can('admin', 'users', 'create')) {
        return API.list('roles').then(function (roles) {
          var roleOpts = roles.map(function (r) { return { value: r.code, label: r.code + ' — ' + (I18N.current() === 'ar' ? r.name_ar : r.name_en) }; });
          var f = UI.form([
            { name: 'email', label: t('email'), type: 'email', required: true },
            { name: 'full_name_en', label: t('full_name') + ' (EN)', required: true },
            { name: 'full_name_ar', label: t('full_name') + ' (AR)' },
            { name: 'role_code', label: t('role_label'), type: 'select', required: true, options: roleOpts }
          ], t('create_user'), function (v) {
            return API.act('admin.user.create', { record: v }).then(function (res) {
              toast(t('temp_password') + ': ' + res.temporary_password, 'success'); go('users');
            });
          });
          wrap.appendChild(card(t('create_user'), f.form));
          wrap.appendChild(card(null, UI.table(rows, userCols())));
          return wrap;
        });
      }
      wrap.appendChild(card(null, UI.table(rows, userCols())));
      return wrap;
    });
  }
  function userCols() {
    return [{ key: 'email', label: t('email') }, { label: t('full_name'), render: function (r) { return I18N.pick(r, 'full_name'); } },
      { key: 'active', label: t('status') }];
  }

  function vSettings() {
    var wrap = el('div', {}); wrap.appendChild(section(t('settings')));
    wrap.appendChild(card(t('server_url'), UI.form(
      [{ name: 'url', label: t('server_url'), value: API.getBase() }], t('save'),
      function (v) { API.setBase(v.url.trim()); toast(t('save'), 'success'); }).form));
    wrap.appendChild(card(t('change_password'), UI.form(
      [{ name: 'oldp', label: t('old_password'), type: 'password', required: true },
       { name: 'newp', label: t('new_password'), type: 'password', required: true }], t('save'),
      function (v) { return API.act('auth.changePassword', { oldPassword: v.oldp, newPassword: v.newp }).then(function () { toast(t('save'), 'success'); }); }).form));
    wrap.appendChild(el('button', { class: 'btn danger', text: t('logout'), onclick: function () {
      API.logout().then(function () { STATE.user = null; showLogin(); }); } }));
    return Promise.resolve(wrap);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
