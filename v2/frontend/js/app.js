/**
 * app.js — v2 PWA shell: login, bootstrap, role-aware nav + views.
 */
(function () {
  'use strict';
  var el = UI.el, t = I18N.t, toast = UI.toast;
  var STATE = { user: null, roles: [], perms: [], lookups: [], company: null, pending: 0 };
  // Bridge for the self-contained feature modules (dashboard.js / admin.js / notifications.js).
  window.APP = { state: STATE, can: can, go: function (v) { return go(v); }, reload: afterLogin };

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
    document.querySelector('.layout').style.display = 'none';
    root.style.display = 'block';
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
    // leaving the login screen: clear the overlay and restore the app chrome
    var root = document.getElementById('root'); UI.clear(root); root.style.display = 'none';
    document.querySelector('.layout').style.display = 'flex';
    document.getElementById('appbar').style.display = 'flex';
    document.getElementById('app-title').textContent = t('app');
    var who = document.getElementById('whoami');
    who.textContent = (I18N.current() === 'ar' ? STATE.user.full_name_ar : STATE.user.full_name_en) || STATE.user.email;
    document.getElementById('lang-btn').textContent = I18N.t('lang_toggle');

    // nav — grouped into ERP module sections
    var nav = document.getElementById('nav'); UI.clear(nav);
    function navVisible(r) {
      switch (r) {
        case 'dashboard': case 'approvals': case 'settings': return true;
        case 'clients': return can('masters', 'clients', 'view');
        case 'suppliers': return can('masters', 'suppliers', 'view');
        case 'projects': return can('masters', 'projects', 'view');
        case 'users': return can('admin', 'users', 'view') || can('admin', 'users', 'admin');
        default: return canModule(r);
      }
    }
    var navLabels = { users: t('admin'), assets: t('assets_m') };
    function navLabel(r) { return navLabels[r] || t(r); }
    var GROUPS = [
      { title: '', items: ['dashboard', 'approvals'] },
      { title: t('grp_commercial'), items: ['bd', 'tendering', 'clients', 'prequal'] },
      { title: t('grp_projects'), items: ['projects', 'techoffice', 'construction'] },
      { title: t('grp_supply'), items: ['procurement', 'warehouse', 'suppliers', 'assets'] },
      { title: t('grp_finance'), items: ['finance'] },
      { title: t('grp_people'), items: ['hr', 'hse'] },
      { title: t('grp_office'), items: ['correspondence'] },
      { title: t('grp_admin'), items: ['users', 'settings'] }
    ];
    GROUPS.forEach(function (g) {
      var vis = g.items.filter(navVisible);
      if (!vis.length) return;
      if (g.title) nav.appendChild(el('div', { class: 'nav-group-title', text: g.title }));
      vis.forEach(function (r) {
        nav.appendChild(el('a', { class: 'nav-item' + (STATE.view === r ? ' active' : ''), href: 'javascript:void 0',
          onclick: function () { go(r); } }, [navLabel(r) + (r === 'approvals' && STATE.pending ? ' (' + STATE.pending + ')' : '')]));
      });
    });

    go(STATE.view || 'dashboard');
  }

  function go(view) {
    STATE.view = view;
    document.querySelectorAll('.nav-item').forEach(function (a) { a.classList.remove('active'); });
    var main = document.getElementById('view'); UI.clear(main);
    main.appendChild(el('div', { class: 'loading', text: t('loading') }));
    var fn = ({ dashboard: function () { return window.DASHBOARD ? DASHBOARD.view() : vDashboard(); },
      approvals: vApprovals, clients: vClients, suppliers: vSuppliers,
      projects: vProjects, users: function () { return window.ADMIN ? ADMIN.view() : vUsers(); }, settings: vSettings,
      procurement: function () { return renderModule('procurement'); },
      warehouse: function () { return renderModule('warehouse'); },
      finance: function () { return renderModule('finance'); },
      techoffice: function () { return renderModule('techoffice'); },
      bd: function () { return renderModule('bd'); },
      tendering: function () { return renderModule('tendering'); },
      construction: function () { return renderModule('construction'); },
      correspondence: function () { return renderModule('correspondence'); },
      prequal: function () { return renderModule('prequal'); },
      hr: function () { return renderModule('hr'); },
      assets: function () { return renderModule('assets'); },
      hse: function () { return renderModule('hse'); } })[view] || vDashboard;
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

  /* ===================== PHASE 2: document modules ====================== */
  function canModule(m) { return STATE.perms.some(function (p) { return (p.module === m || p.module === '*') && (p.action === 'view' || p.action === 'admin'); }); }
  function canAct(m, e, a) { return STATE.perms.some(function (p) { return (p.module === m || p.module === '*') && (p.entity === e || p.entity === '*') && (p.action === a || p.action === 'admin'); }); }

  var DOC_MODULES = {
    procurement: { docs: [
      { key: 'mr', entity: 'material_requisitions', action: 'procurement.mr.create', submittable: true,
        fields: [['project_id', 'project', true], ['required_date', 'date'], ['priority', 'select', false, ['Low', 'Normal', 'High', 'Urgent']], ['cost_code', 'text'], ['justification', 'textarea']],
        lines: ['description', 'unit', 'qty', 'est_unit_price'], cols: [['mr_number', '#'], ['status', 'status'], ['est_total', 'total']] },
      { key: 'po', entity: 'purchase_orders', action: 'procurement.po.create', submittable: true,
        fields: [['project_id', 'project', true], ['supplier_id', 'supplier', true], ['order_date', 'date'], ['delivery_date', 'date'], ['notes', 'textarea']],
        lines: ['description', 'unit', 'qty', 'unit_price'], cols: [['po_number', '#'], ['status', 'status'], ['total', 'total']] }
    ] },
    warehouse: { docs: [
      { key: 'grn', entity: 'goods_received_notes', action: 'wh.grn.create',
        fields: [['project_id', 'project', true], ['supplier_id', 'supplier'], ['received_date', 'date', true], ['condition', 'select', false, ['Good', 'Damaged', 'Partial', 'Rejected']], ['notes', 'textarea']],
        lines: ['item_code', 'description', 'unit', 'qty_ordered', 'qty_received', 'qty_accepted'], cols: [['grn_number', '#'], ['status', 'status'], ['condition', '']] },
      { key: 'miv', entity: 'material_issues', action: 'wh.miv.create',
        fields: [['project_id', 'project', true], ['issue_date', 'date', true], ['issued_to', 'text', true], ['purpose', 'text']],
        lines: ['item_code', 'description', 'unit', 'qty'], cols: [['miv_number', '#'], ['status', 'status'], ['issued_to', '']] },
      { key: 'stock', entity: 'stock_items', action: 'wh.stock.upsert',
        fields: [['project_id', 'project', true], ['item_code', 'text', true], ['description', 'text', true], ['unit', 'text'], ['qty_on_hand', 'number'], ['min_level', 'number'], ['location', 'text']],
        cols: [['item_code', '#'], ['description', ''], ['qty_on_hand', ''], ['min_level', '']] }
    ] },
    finance: { docs: [
      { key: 'pv', entity: 'payment_vouchers', action: 'fin.pv.create', submittable: true,
        fields: [['project_id', 'project', true], ['supplier_id', 'supplier'], ['payee', 'text'], ['payment_method', 'select', true, ['Cash', 'Bank Transfer', 'Cheque', 'Credit']], ['amount', 'number', true], ['invoice_ref', 'text'], ['description', 'textarea']],
        cols: [['pv_number', '#'], ['status', 'status'], ['amount', 'total']] },
      { key: 'rv', entity: 'receipt_vouchers', action: 'fin.rv.create',
        fields: [['project_id', 'project', true], ['client_id', 'client'], ['payer', 'text'], ['amount', 'number', true], ['method', 'select', false, ['Cash', 'Bank Transfer', 'Cheque']], ['reference', 'text'], ['wht_amount', 'number'], ['retention_amount', 'number']],
        cols: [['rv_number', '#'], ['status', 'status'], ['amount', 'total']] },
      { key: 'expense', entity: 'expenses', action: 'fin.expense.create', submittable: true,
        fields: [['project_id', 'project', true], ['expense_date', 'date', true], ['category', 'select', true, ['Materials', 'Labor', 'Equipment', 'Transport', 'Permits', 'Utilities', 'Subcontractor', 'Misc']], ['amount', 'number', true], ['payment_method', 'select', false, ['Cash', 'Bank Transfer', 'Cheque', 'Credit']], ['vendor', 'text'], ['description', 'textarea']],
        cols: [['exp_number', '#'], ['status', 'status'], ['amount', 'total']] }
    ] },
    techoffice: { docs: [
      { key: 'charter', entity: 'project_charters', action: 'tech.charter.create', submittable: true,
        fields: [['project_id', 'project', true], ['objectives', 'textarea'], ['scope', 'textarea'], ['start_date', 'date'], ['end_date', 'date'], ['budget', 'number']],
        cols: [['charter_number', '#'], ['status', 'status'], ['budget', 'total']] },
      { key: 'vor', entity: 'variation_orders', action: 'tech.vor.create', submittable: true,
        fields: [['project_id', 'project', true], ['title', 'text', true], ['type', 'select', false, ['Addition', 'Omission', 'Substitution']], ['amount', 'number', true], ['time_impact_days', 'number'], ['description', 'textarea']],
        cols: [['vor_number', '#'], ['status', 'status'], ['amount', 'total']] },
      { key: 'ipc', entity: 'interim_payment_certs', action: 'tech.ipc.create', submittable: true,
        fields: [['project_id', 'project', true], ['client_id', 'client'], ['period', 'text'], ['gross_amount', 'number', true], ['advance_recovery', 'number'], ['retention', 'number']],
        cols: [['ipc_number', '#'], ['status', 'status'], ['net_amount', 'total']] },
      { key: 'ncr', entity: 'ncrs', action: 'tech.ncr.create',
        fields: [['project_id', 'project', true], ['category', 'select', true, ['Minor', 'Major', 'Critical']], ['description', 'textarea', true], ['location', 'text']],
        cols: [['ncr_number', '#'], ['status', 'status'], ['category', '']] }
    ] },
    bd: { docs: [
      { key: 'opp', entity: 'opportunities', action: 'bd.opp.create',
        fields: [['client_id', 'client', true], ['title', 'text', true], ['sector', 'text'], ['estimated_value', 'number'], ['stage', 'select', false, ['Lead', 'Qualified', 'Proposal', 'Negotiation']], ['probability', 'number'], ['source', 'text'], ['notes', 'textarea']],
        cols: [['opp_number', '#'], ['title', ''], ['stage', ''], ['estimated_value', 'total'], ['status', 'status']],
        rowButtons: [
          { label: 'won', action: 'bd.opp.advance', cls: 'primary', when: function (r) { return r.status === 'Open'; }, body: function (r) { return { id: r.id, stage: 'Won' }; } },
          { label: 'mark_lost', action: 'bd.opp.advance', cls: 'danger', when: function (r) { return r.status === 'Open'; }, body: function (r) { return { id: r.id, stage: 'Lost' }; } }
        ] },
      { key: 'interaction', entity: 'interactions', action: 'bd.interaction.create',
        fields: [['client_id', 'client'], ['type', 'select', true, ['Call', 'Meeting', 'Email', 'Site Visit', 'Other']], ['interaction_date', 'date', true], ['contact_name', 'text'], ['summary', 'textarea'], ['next_action', 'text']],
        cols: [['interaction_date', 'date'], ['type', ''], ['contact_name', ''], ['summary', '']] }
    ] },
    tendering: { docs: [
      { key: 'tender', entity: 'tenders', action: 'pts.tender.create', submittable: true,
        fields: [['client_id', 'client', true], ['title', 'text', true], ['scope', 'textarea'], ['estimated_value', 'number'], ['submission_deadline', 'date'], ['go_decision', 'select', false, ['Go', 'No-Go']]],
        lines: ['description', 'qty', 'unit_cost'], cols: [['tender_number', '#'], ['title', ''], ['estimated_value', 'total'], ['status', 'status']],
        rowButtons: [
          { label: 'award', action: 'pts.tender.award', cls: 'primary', when: function (r) { return ['Approved', 'Submitted', 'Registered'].indexOf(r.status) !== -1; }, body: function (r) { return { id: r.id, outcome: 'Awarded' }; } },
          { label: 'mark_lost', action: 'pts.tender.award', cls: 'danger', when: function (r) { return ['Approved', 'Submitted', 'Registered'].indexOf(r.status) !== -1; }, body: function (r) { return { id: r.id, outcome: 'Lost' }; } }
        ] }
    ] },
    construction: { docs: [
      { key: 'dsr', entity: 'daily_site_reports', action: 'con.dsr.create',
        fields: [['project_id', 'project', true], ['report_date', 'date', true], ['weather', 'text'], ['manpower_count', 'number'], ['equipment_count', 'number'], ['progress_pct', 'number'], ['activities', 'textarea'], ['delays', 'textarea']],
        cols: [['dsr_number', '#'], ['report_date', 'date'], ['progress_pct', ''], ['manpower_count', '']] },
      { key: 'si', entity: 'site_instructions', action: 'con.si.create',
        fields: [['project_id', 'project', true], ['instruction_date', 'date'], ['issued_to', 'text'], ['subject', 'text', true], ['details', 'textarea']],
        cols: [['si_number', '#'], ['subject', ''], ['status', 'status']] }
    ] },
    correspondence: { docs: [
      { key: 'letter', entity: 'correspondence', action: 'corr.create',
        fields: [['type', 'select', true, ['Delegation', 'PaymentDemand', 'ReceiptAck', 'SampleSubmission', 'General']], ['recipient', 'text', true], ['subject_ar', 'text'], ['body_ar', 'textarea'], ['reference', 'text'], ['letter_date', 'date'], ['project_id', 'project']],
        cols: [['letter_number', '#'], ['type', ''], ['recipient', ''], ['status', 'status']],
        rowButtons: [{ label: 'issue', action: 'corr.issue', cls: 'primary', when: function (r) { return r.status === 'Draft'; }, body: function (r) { return { id: r.id }; } }] }
    ] },
    prequal: { docs: [
      { key: 'prq', entity: 'prequalifications', action: 'prequal.create',
        fields: [['client_id', 'client', true], ['submitted_date', 'date'], ['portal', 'text'], ['scope', 'textarea'], ['status', 'select', false, ['Draft', 'Submitted', 'Approved', 'Rejected', 'Expired']]],
        cols: [['prq_number', '#'], ['portal', ''], ['status', 'status']] }
    ] },
    hr: { docs: [
      { key: 'employee', entity: 'employees', action: 'hr.employee.create',
        fields: [['full_name_en', 'text', true], ['full_name_ar', 'text'], ['national_id', 'text'], ['title', 'text'], ['department', 'text'], ['hire_date', 'date'], ['contract_type', 'select', false, ['Permanent', 'Fixed-Term', 'Daily', 'Consultant']], ['basic_salary', 'number'], ['phone', 'text']],
        cols: [['emp_code', '#'], ['full_name_en', ''], ['title', ''], ['status', 'status']] },
      { key: 'leave', entity: 'leave_requests', action: 'hr.leave.create', submittable: true,
        fields: [['employee_id', 'employee', true], ['type', 'select', true, ['Annual', 'Sick', 'Unpaid', 'Casual', 'Other']], ['from_date', 'date', true], ['to_date', 'date', true], ['reason', 'textarea']],
        cols: [['leave_number', '#'], ['type', ''], ['days', ''], ['status', 'status']] },
      { key: 'timesheet', entity: 'timesheets', action: 'hr.timesheet.create',
        fields: [['employee_id', 'employee', true], ['project_id', 'project'], ['period', 'text', true], ['days_worked', 'number'], ['ot_hours', 'number']],
        cols: [['ts_number', '#'], ['period', ''], ['days_worked', ''], ['status', 'status']] },
      { key: 'appraisal', entity: 'appraisals', action: 'hr.appraisal.create',
        fields: [['employee_id', 'employee', true], ['period', 'text', true], ['rating', 'select', false, ['1', '2', '3', '4', '5']], ['strengths', 'textarea'], ['improvements', 'textarea']],
        cols: [['appr_number', '#'], ['period', ''], ['rating', ''], ['status', 'status']] }
    ] },
    assets: { docs: [
      { key: 'asset', entity: 'assets', action: 'asset.create',
        fields: [['name', 'text', true], ['category', 'select', true, ['Heavy Equipment', 'Vehicle', 'Tools', 'IT', 'Survey', 'Other']], ['serial_no', 'text'], ['acquisition_date', 'date'], ['cost', 'number'], ['location', 'text'], ['project_id', 'project']],
        cols: [['asset_code', '#'], ['name', ''], ['category', ''], ['status', 'status']] },
      { key: 'maintenance', entity: 'maintenance_records', action: 'asset.maintenance.create',
        fields: [['asset_id', 'asset', true], ['type', 'select', true, ['Preventive', 'Corrective', 'Inspection']], ['mnt_date', 'date', true], ['description', 'textarea'], ['cost', 'number'], ['next_due', 'date']],
        cols: [['mnt_number', '#'], ['type', ''], ['mnt_date', 'date']] },
      { key: 'calibration', entity: 'calibration_records', action: 'asset.calibration.create',
        fields: [['asset_id', 'asset', true], ['cert_no', 'text'], ['calibrated_date', 'date', true], ['due_date', 'date', true]],
        cols: [['cal_number', '#'], ['cert_no', ''], ['due_date', ''], ['status', 'status']] }
    ] },
    hse: { docs: [
      { key: 'hira', entity: 'hira', action: 'hse.hira.create', submittable: true,
        fields: [['project_id', 'project', true], ['activity', 'text', true], ['hazards', 'textarea'], ['risk_score', 'number'], ['controls', 'textarea'], ['residual_score', 'number']],
        cols: [['hira_number', '#'], ['activity', ''], ['residual_score', ''], ['status', 'status']] },
      { key: 'permit', entity: 'permits', action: 'hse.permit.create', submittable: true,
        fields: [['project_id', 'project', true], ['type', 'select', true, ['Hot Work', 'Confined Space', 'Working at Height', 'Excavation', 'Electrical', 'Lifting', 'Energization', 'General']], ['valid_from', 'date'], ['valid_to', 'date'], ['issued_to', 'text']],
        cols: [['permit_number', '#'], ['type', ''], ['status', 'status']] },
      { key: 'incident', entity: 'incidents', action: 'hse.incident.create',
        fields: [['project_id', 'project', true], ['incident_date', 'date', true], ['type', 'select', true, ['Near Miss', 'First Aid', 'Medical Treatment', 'Lost Time', 'Fatality', 'Environmental']], ['severity', 'select', false, ['Low', 'Medium', 'High', 'Critical']], ['description', 'textarea']],
        cols: [['incident_number', '#'], ['type', ''], ['severity', ''], ['status', 'status']] },
      { key: 'inspection', entity: 'hse_inspections', action: 'hse.inspection.create',
        fields: [['project_id', 'project', true], ['inspection_date', 'date', true], ['area', 'text'], ['findings', 'textarea'], ['score', 'number']],
        cols: [['insp_number', '#'], ['area', ''], ['score', ''], ['status', 'status']] }
    ] }
  };

  function refOpts(entity) {
    return (STATE[entity] || []).map(function (r) {
      var code = r.project_code || r.client_code || r.supplier_code || r.emp_code || r.asset_code || '';
      var nm = I18N.pick(r, 'name') || I18N.pick(r, 'full_name') || r.name || r.description || r.id;
      return { value: r.id, label: (code ? code + ' — ' : '') + nm };
    });
  }
  function loadRefs() {
    return Promise.all([
      API.list('projects').catch(function () { return []; }),
      API.list('clients').catch(function () { return []; }),
      API.list('suppliers').catch(function () { return []; }),
      API.list('employees').catch(function () { return []; }),
      API.list('assets').catch(function () { return []; })
    ]).then(function (r) { STATE.projects = r[0] || []; STATE.clients = r[1] || []; STATE.suppliers = r[2] || []; STATE.employees = r[3] || []; STATE.assets = r[4] || []; });
  }
  function prettyLabel(n) { var k = t(n); if (k && k !== n) return k; return n.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function fieldSpec(f) {
    var name = f[0], type = f[1], spec = { name: name, label: prettyLabel(name), required: !!f[2] };
    if (type === 'project') { spec.type = 'select'; spec.options = refOpts('projects'); }
    else if (type === 'supplier') { spec.type = 'select'; spec.options = refOpts('suppliers'); }
    else if (type === 'client') { spec.type = 'select'; spec.options = refOpts('clients'); }
    else if (type === 'employee') { spec.type = 'select'; spec.options = refOpts('employees'); }
    else if (type === 'asset') { spec.type = 'select'; spec.options = refOpts('assets'); }
    else if (type === 'select') { spec.type = 'select'; spec.options = f[3] || []; }
    else spec.type = type;
    return spec;
  }

  function tabsBar(items) {
    var wrap = el('div', {}), bar = el('div', { class: 'tabbar' }), body = el('div', {});
    items.forEach(function (it, i) {
      var b = el('button', { class: 'tab' + (i === 0 ? ' active' : ''), text: it.label, onclick: function () {
        bar.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); }); b.classList.add('active');
        UI.clear(body); body.appendChild(it.render());
      } });
      bar.appendChild(b);
    });
    wrap.appendChild(bar); wrap.appendChild(body);
    body.appendChild(items[0].render());
    return wrap;
  }

  function lineEditor(fields) {
    var rows = el('div', {});
    function addRow() {
      var row = el('div', { class: 'line-row' }), inputs = {};
      fields.forEach(function (fn) {
        var num = /qty|price|level|amount/.test(fn);
        var inp = el('input', { type: num ? 'number' : 'text', placeholder: prettyLabel(fn), step: num ? 'any' : null });
        inputs[fn] = inp; row.appendChild(inp);
      });
      row.appendChild(el('button', { type: 'button', class: 'btn small danger', text: '×', onclick: function () { rows.removeChild(row); } }));
      row._inputs = inputs; rows.appendChild(row);
    }
    addRow();
    var node = el('div', {}, [rows, el('button', { type: 'button', class: 'btn small', text: t('add_line'), onclick: addRow })]);
    return { node: node, getRows: function () {
      var out = [];
      rows.querySelectorAll('.line-row').forEach(function (row) {
        var o = {}, any = false; fields.forEach(function (fn) { var v = row._inputs[fn].value; if (v !== '') any = true; o[fn] = v; });
        if (any) out.push(o);
      });
      return out;
    } };
  }

  function renderModule(moduleKey) {
    var def = DOC_MODULES[moduleKey];
    return loadRefs().then(function () {
      var wrap = el('div', {}); wrap.appendChild(section(t(moduleKey)));
      wrap.appendChild(tabsBar(def.docs.map(function (doc) { return { label: t(doc.key), render: function () { return docTab(moduleKey, doc); } }; })));
      return wrap;
    });
  }

  function docTab(moduleKey, doc) {
    var wrap = el('div', {});
    if (canAct(moduleKey, doc.entity, 'create')) {
      var le = doc.lines ? lineEditor(doc.lines) : null;
      var f = UI.form(doc.fields.map(fieldSpec), t('new_doc'), function (v) {
        var rec = {}; Object.keys(v).forEach(function (k) { if (v[k] !== '') rec[k] = v[k]; });
        if (le) rec.lines = le.getRows();
        return API.act(doc.action, { record: rec }).then(function () { toast(t('new_doc') + ' ✓', 'success'); go(moduleKey); });
      });
      wrap.appendChild(card(t('new_doc') + ' — ' + t(doc.key), el('div', {}, [f.form, le ? el('h4', { text: t('line_items') }) : null, le ? le.node : null])));
    }
    var listHolder = el('div', {}, [el('div', { class: 'loading', text: t('loading') })]);
    wrap.appendChild(listHolder);
    API.list(doc.entity).then(function (rows) {
      var cols = doc.cols.map(function (c) { return { key: c[0], label: c[1] ? t(c[1]) : prettyLabel(c[0]) }; });
      cols.push({ label: t('actions'), render: function (r) {
        var box = el('div', { class: 'row-actions', onclick: function (e) { e.stopPropagation(); } });
        if (doc.submittable && String(r.status) === 'Draft' && canAct(moduleKey, doc.entity, 'submit'))
          box.appendChild(el('button', { class: 'btn small primary', text: t('submit'), onclick: function () { submitDoc(doc.entity, r.id, moduleKey); } }));
        else if (r.approval_id || String(r.status) === 'Submitted') box.appendChild(el('span', { class: 'badge ok', text: r.status }));
        (doc.rowButtons || []).forEach(function (rb) {
          if (rb.when && !rb.when(r)) return;
          box.appendChild(el('button', { class: 'btn small ' + (rb.cls || ''), text: t(rb.label), onclick: function () {
            API.act(rb.action, rb.body(r)).then(function () { toast('✓', 'success'); go(moduleKey); }).catch(function (e) { toast(e.message, 'error'); });
          } }));
        });
        box.appendChild(el('button', { class: 'btn small', text: t('open') || 'Open', onclick: function () { openDetail(moduleKey, doc, r.id); } }));
        return box;
      } });
      UI.clear(listHolder);
      listHolder.appendChild(card(t('records'), UI.dataTable(rows, cols, {
        onRow: function (r) { openDetail(moduleKey, doc, r.id); },
        searchKeys: doc.cols.map(function (c) { return c[0]; })
      })));
    }).catch(function (e) { UI.clear(listHolder); listHolder.appendChild(el('div', { class: 'error-box', text: e.message })); });
    return wrap;
  }

  var AUDIT_KEYS = { id: 1, created_at: 1, updated_at: 1, created_by: 1, updated_by: 1, approval_id: 1 };
  function openDetail(moduleKey, doc, id) {
    var m = UI.modal(t(doc.key), el('div', { class: 'loading', text: t('loading') }), { wide: true });
    API.act('doc.detail', { entity: doc.entity, id: id }).then(function (d) {
      var rec = d.record || {}; UI.clear(m.body);
      m.body.appendChild(el('h3', { text: (rec[doc.cols[0][0]] || t(doc.key)) + (rec.status ? '  ·  ' + rec.status : '') }));

      // summary grid
      var grid = el('div', { class: 'detail-grid' });
      Object.keys(rec).forEach(function (k) {
        if (AUDIT_KEYS[k] || rec[k] === '' || rec[k] == null) return;
        grid.appendChild(el('div', { class: 'detail-kv' }, [
          el('div', { class: 'dk', text: prettyLabel(k) }), el('div', { class: 'dv', text: String(rec[k]) })]));
      });
      m.body.appendChild(grid);

      // line items
      if (d.lines && d.lines.length) {
        var keys = Object.keys(d.lines[0]).filter(function (k) { return !AUDIT_KEYS[k] && !/_id$/.test(k); });
        m.body.appendChild(el('h4', { text: t('line_items') }));
        m.body.appendChild(UI.table(d.lines, keys.map(function (k) { return { key: k, label: prettyLabel(k) }; })));
      }

      // approval timeline
      if (d.approval && d.approval.request) {
        m.body.appendChild(el('h4', { text: t('view_approval') }));
        var steps = (d.approval.steps || []).slice().sort(function (a, b) { return Number(a.step_no) - Number(b.step_no); });
        var tl = el('div', { class: 'timeline' });
        steps.forEach(function (s) {
          var roles = JSON.parse(s.roles_json || '[]'); var apps = JSON.parse(s.approvals_json || '[]');
          tl.appendChild(el('div', { class: 'tl-step ' + String(s.status).toLowerCase() }, [
            el('span', { class: 'tl-dot' }),
            el('div', {}, [
              el('div', { text: t('step') + ' ' + s.step_no + ': ' + roles.join(' / ') + '  — ' + s.status }),
              apps.length ? el('div', { class: 'muted', text: apps.map(function (a) { return a.role + ' ' + a.decision; }).join(', ') }) : null
            ])
          ]));
        });
        m.body.appendChild(tl);
      }

      // contextual actions
      var actions = el('div', { class: 'row-actions detail-actions' });
      if (doc.submittable && String(rec.status) === 'Draft' && canAct(moduleKey, doc.entity, 'submit'))
        actions.appendChild(el('button', { class: 'btn primary', text: t('submit'), onclick: function () { m.close(); submitDoc(doc.entity, id, moduleKey); } }));
      // can the current user act on the active approval step?
      if (d.approval && d.approval.request && d.approval.request.status === 'Pending') {
        var active = (d.approval.steps || []).filter(function (s) { return s.status === 'Active'; })[0];
        var myCodes = (STATE.roles || []).map(function (r) { return r.role_code; });
        var isInitiator = String(d.approval.request.initiator_user) === String(STATE.user.id);
        if (active && !isInitiator && JSON.parse(active.roles_json || '[]').some(function (rc) { return myCodes.indexOf(rc) !== -1; })) {
          var cmt = el('input', { class: 'cmt', placeholder: t('comment') });
          actions.appendChild(cmt);
          actions.appendChild(el('button', { class: 'btn primary', text: t('approve'), onclick: function () { decideFromDetail(d.approval.request.id, 'approve', cmt.value, m, moduleKey); } }));
          actions.appendChild(el('button', { class: 'btn danger', text: t('reject'), onclick: function () { decideFromDetail(d.approval.request.id, 'reject', cmt.value, m, moduleKey); } }));
        }
      }
      if (actions.children.length) m.body.appendChild(actions);
    }).catch(function (e) { UI.clear(m.body); m.body.appendChild(el('div', { class: 'error-box', text: e.message })); });
  }

  function decideFromDetail(reqId, decision, comment, m, moduleKey) {
    API.act('approvals.decide', { request_id: reqId, decision: decision, comment: comment })
      .then(function (res) { toast(res.request.status, 'success'); m.close(); return API.bootstrap(); })
      .then(function (b) { STATE.pending = b.pending_approvals || 0; render(); go(moduleKey); })
      .catch(function (e) { toast(e.message, 'error'); });
  }

  function submitDoc(entity, id, moduleKey) {
    API.act('doc.submit', { entity: entity, id: id }).then(function () {
      toast(t('submitted'), 'success');
      return API.bootstrap();
    }).then(function (b) { STATE.pending = b.pending_approvals || 0; render(); go(moduleKey); })
      .catch(function (e) { toast(e.message, 'error'); });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
