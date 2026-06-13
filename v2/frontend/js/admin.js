/**
 * admin.js — administration console.
 *
 * Surfaces the admin capabilities the original UI never exposed: user lifecycle
 * (create / edit / activate / reset password), role assignment + revocation, the
 * permission matrix, Delegation-of-Authority bands, lookup catalogs, and an audit
 * browser. Exposes window.ADMIN.view(); app.js routes the "users" view here.
 * Every mutation is also enforced by RBAC on the backend — UI gating is courtesy.
 */
(function () {
  'use strict';
  var el = UI.el, t = I18N.t, toast = UI.toast;
  function can(m, e, a) { return !window.APP || !window.APP.can || window.APP.can(m, e, a); }
  function roleName(r) { return I18N.current() === 'ar' ? (r.name_ar || r.name_en) : (r.name_en || r.name_ar); }

  /* ------------------------------- modal -------------------------------- */
  function modal(title, body) {
    var box = el('div', { class: 'modal-box' }, [
      el('div', { class: 'modal-head' }, [el('h3', { text: title }),
        el('button', { class: 'icon-btn', text: '✕', onclick: close })]),
      el('div', { class: 'modal-body' }, [body])
    ]);
    var overlay = el('div', { class: 'modal-overlay', onclick: function (e) { if (e.target === overlay) close(); } }, [box]);
    document.body.appendChild(overlay);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    return { close: close };
  }

  /* ------------------------------- tabs --------------------------------- */
  function tabs(defs) {
    var bar = el('div', { class: 'tabbar' }), body = el('div', { class: 'tab-body' });
    var active = defs[0];
    function load(d) {
      active = d;
      bar.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x._key === d.key); });
      UI.clear(body); body.appendChild(el('div', { class: 'loading', text: t('loading') }));
      Promise.resolve(d.render(reload)).then(function (node) { UI.clear(body); body.appendChild(node); })
        .catch(function (e) { UI.clear(body); body.appendChild(el('div', { class: 'error-box', text: e.message })); });
    }
    function reload() { load(active); }
    defs.forEach(function (d) {
      var b = el('button', { class: 'tab', text: d.label, onclick: function () { load(d); } }); b._key = d.key;
      bar.appendChild(b);
    });
    var wrap = el('div', {}, [bar, body]); load(active);
    return wrap;
  }

  /* ============================== USERS ================================= */
  function usersTab(reload) {
    return Promise.all([API.act('admin.users'), API.list('roles')]).then(function (res) {
      var users = res[0] || [], roles = res[1] || [];
      var roleOpts = roles.map(function (r) { return { value: r.code, label: r.code + ' — ' + roleName(r) }; });
      var roleLabel = {}; roles.forEach(function (r) { roleLabel[r.code] = roleName(r); });
      var wrap = el('div', {});

      if (can('admin', 'users', 'create')) {
        var f = UI.form([
          { name: 'email', label: t('email'), type: 'email', required: true },
          { name: 'full_name_en', label: t('full_name') + ' (EN)', required: true },
          { name: 'full_name_ar', label: t('full_name') + ' (AR)' },
          { name: 'role_code', label: t('role_label'), type: 'select', required: true, options: roleOpts }
        ], t('create_user'), function (v) {
          return API.act('admin.user.create', { record: v }).then(function (r) {
            showTemp(t('create_user') + ' ✓', r.temporary_password); reload();
          });
        });
        wrap.appendChild(el('details', { class: 'card collapsible' }, [
          el('summary', { text: '＋ ' + t('create_user') }), f.form
        ]));
      }

      var cols = [
        { key: 'email', label: t('email') },
        { label: t('full_name'), render: function (u) { return I18N.pick(u, 'full_name'); } },
        { label: t('roles'), render: function (u) {
          var box = el('div', { class: 'chips' });
          (u.roles || []).forEach(function (ra) { box.appendChild(el('span', { class: 'chip', text: ra.role_code + (ra.scope_type === 'PROJECT' ? ' ⚲' : '') })); });
          if (!(u.roles || []).length) box.appendChild(el('span', { class: 'muted', text: '—' }));
          return box;
        } },
        { label: t('status'), render: function (u) {
          var on = String(u.active).toUpperCase() === 'TRUE';
          return el('span', { class: 'badge ' + (on ? 'ok' : 'off'), text: on ? t('active_y') : t('inactive_y') });
        } },
        { label: t('actions'), render: function (u) {
          var box = el('div', { class: 'row-actions' });
          if (can('admin', 'users', 'edit'))
            box.appendChild(el('button', { class: 'btn small', text: t('edit'), onclick: function () { editUser(u, reload); } }));
          if (can('admin', 'role_assignments', 'admin'))
            box.appendChild(el('button', { class: 'btn small', text: t('manage_roles'), onclick: function () { manageRoles(u, roles, reload); } }));
          if (can('admin', 'users', 'admin'))
            box.appendChild(el('button', { class: 'btn small warn', text: t('reset_password'), onclick: function () { resetPw(u, reload); } }));
          if (can('admin', 'users', 'edit')) {
            var on = String(u.active).toUpperCase() === 'TRUE';
            box.appendChild(el('button', { class: 'btn small ' + (on ? 'danger' : 'primary'), text: on ? t('deactivate') : t('activate'),
              onclick: function () { setActive(u, !on, reload); } }));
          }
          return box;
        } }
      ];
      wrap.appendChild(el('div', { class: 'card' }, [UI.table(users, cols)]));
      return wrap;
    });
  }

  function showTemp(title, pw) {
    modal(title, el('div', {}, [
      el('p', { text: t('temp_password') + ':' }),
      el('div', { class: 'temp-pw' }, [el('code', { text: pw })]),
      el('p', { class: 'muted', text: t('temp_pw_hint') })
    ]));
  }

  function editUser(u, reload) {
    var m = modal(t('edit') + ' — ' + u.email, UI.form([
      { name: 'full_name_en', label: t('full_name') + ' (EN)', value: u.full_name_en },
      { name: 'full_name_ar', label: t('full_name') + ' (AR)', value: u.full_name_ar },
      { name: 'phone', label: t('phone'), value: u.phone },
      { name: 'title_en', label: t('title'), value: u.title_en },
      { name: 'default_lang', label: t('language'), type: 'select', value: u.default_lang, options: [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }] }
    ], t('save'), function (v) {
      return API.act('admin.user.update', { id: u.id, patch: v }).then(function () { toast(t('save') + ' ✓', 'success'); m.close(); reload(); });
    }).form);
  }

  function setActive(u, on, reload) {
    API.act('admin.user.update', { id: u.id, patch: { active: on ? 'TRUE' : 'FALSE' } })
      .then(function () { toast(on ? t('activate') : t('deactivate'), 'success'); reload(); })
      .catch(function (e) { toast(e.message, 'error'); });
  }

  function resetPw(u, reload) {
    if (!window.confirm(t('reset_password') + ' — ' + u.email + '?')) return;
    API.act('admin.user.resetPassword', { id: u.id }).then(function (r) {
      showTemp(t('reset_password') + ' ✓', r.temporary_password); reload();
    }).catch(function (e) { toast(e.message, 'error'); });
  }

  function manageRoles(u, roles, reload) {
    var holder = el('div', {}, [el('div', { class: 'loading', text: t('loading') })]);
    var m = modal(t('manage_roles') + ' — ' + u.email, holder);
    function refresh() {
      API.act('admin.user.detail', { id: u.id }).then(function (d) {
        UI.clear(holder);
        var list = el('div', { class: 'role-list' });
        (d.roles || []).forEach(function (r) {
          list.appendChild(el('div', { class: 'role-row' }, [
            el('span', { text: r.role_code + ' · ' + roleName(r) + (r.scope_type === 'PROJECT' ? (' (' + t('project') + ')') : '') }),
            el('button', { class: 'btn small danger', text: t('revoke'), onclick: function () {
              API.act('admin.role.revoke', { assignment_id: r.id }).then(function () { toast(t('revoke') + ' ✓', 'success'); refresh(); reload(); }).catch(function (e) { toast(e.message, 'error'); });
            } })
          ]));
        });
        if (!(d.roles || []).length) list.appendChild(el('p', { class: 'muted', text: t('no_records') }));
        UI.clear(holder); holder.appendChild(el('h4', { text: t('roles') })); holder.appendChild(list);

        var scope = el('select', {}, []); ['GLOBAL', 'PROJECT'].forEach(function (s) { scope.appendChild(el('option', { value: s, text: s })); });
        var roleSel = el('select', {}); roles.forEach(function (r) { roleSel.appendChild(el('option', { value: r.code, text: r.code + ' — ' + roleName(r) })); });
        var projWrap = el('div', { class: 'field', style: 'display:none' });
        var projSel = el('select', {}); projWrap.appendChild(el('label', { text: t('project') })); projWrap.appendChild(projSel);
        scope.addEventListener('change', function () {
          if (scope.value === 'PROJECT') {
            projWrap.style.display = '';
            if (!projSel._loaded) { projSel._loaded = true; API.list('projects').then(function (ps) { ps.forEach(function (p) { projSel.appendChild(el('option', { value: p.id, text: (p.project_code || '') + ' ' + I18N.pick(p, 'name') })); }); }); }
          } else projWrap.style.display = 'none';
        });
        holder.appendChild(el('h4', { text: t('assign_role') }));
        holder.appendChild(el('div', { class: 'assign-row' }, [
          el('div', { class: 'field' }, [el('label', { text: t('role_label') }), roleSel]),
          el('div', { class: 'field' }, [el('label', { text: t('scope') }), scope]),
          projWrap,
          el('button', { class: 'btn primary', text: t('assign_role'), onclick: function () {
            var payload = { user_id: u.id, role_code: roleSel.value, scope_type: scope.value, project_id: scope.value === 'PROJECT' ? projSel.value : '' };
            API.act('admin.assignRole', payload).then(function () { toast(t('assign_role') + ' ✓', 'success'); refresh(); reload(); }).catch(function (e) { toast(e.message, 'error'); });
          } })
        ]));
      }).catch(function (e) { UI.clear(holder); holder.appendChild(el('div', { class: 'error-box', text: e.message })); });
    }
    refresh();
  }

  /* ====================== ROLES & PERMISSIONS ========================== */
  function permsTab(reload) {
    return Promise.all([API.list('roles'), API.list('permissions')]).then(function (res) {
      var roles = res[0] || [], perms = res[1] || [];
      var wrap = el('div', {});
      if (can('admin', 'permissions', 'admin')) {
        var actionEnum = ['view', 'create', 'edit', 'submit', 'approve', 'reject', 'sign', 'close', 'void', 'export', 'admin'];
        var f = UI.form([
          { name: 'role_code', label: t('role_label'), type: 'select', required: true, options: roles.map(function (r) { return { value: r.code, label: r.code }; }) },
          { name: 'module', label: t('module'), required: true, placeholder: 'finance | *' },
          { name: 'entity', label: t('entity'), required: true, placeholder: 'payment_vouchers | *' },
          { name: 'action', label: t('action'), type: 'select', required: true, options: actionEnum },
          { name: 'scope', label: t('scope'), type: 'select', required: true, options: ['GLOBAL', 'PROJECT', 'OWN'] }
        ], t('add') + ' ' + t('permission'), function (v) {
          return API.act('admin.permission.create', { record: v }).then(function () { toast('✓', 'success'); reload(); });
        });
        wrap.appendChild(el('details', { class: 'card collapsible' }, [el('summary', { text: '＋ ' + t('permission') }), f.form]));
      }
      var byRole = {}; perms.forEach(function (p) { (byRole[p.role_code] = byRole[p.role_code] || []).push(p); });
      roles.forEach(function (r) {
        var rows = byRole[r.code] || [];
        var cols = [
          { key: 'module', label: t('module') }, { key: 'entity', label: t('entity') },
          { key: 'action', label: t('action') }, { key: 'scope', label: t('scope') }
        ];
        if (can('admin', 'permissions', 'admin')) cols.push({ label: '', render: function (p) {
          return el('button', { class: 'btn small danger', text: t('remove'), onclick: function () {
            API.act('admin.permission.delete', { id: p.id }).then(function () { toast(t('remove') + ' ✓', 'success'); reload(); }).catch(function (e) { toast(e.message, 'error'); });
          } });
        } });
        wrap.appendChild(el('details', { class: 'card collapsible' }, [
          el('summary', { text: r.code + ' — ' + roleName(r) + '  (' + rows.length + ')' }),
          UI.table(rows, cols)
        ]));
      });
      return wrap;
    });
  }

  /* ===================== DELEGATION OF AUTHORITY ======================= */
  function doaTab(reload) {
    return API.list('doa_bands').then(function (bands) {
      var wrap = el('div', {});
      if (can('admin', 'doa_bands', 'admin')) {
        var f = UI.form([
          { name: 'domain', label: t('domain'), required: true, placeholder: 'procurement' },
          { name: 'action', label: t('action'), placeholder: 'commit' },
          { name: 'min_amount', label: t('min'), type: 'number', value: '0' },
          { name: 'max_amount', label: t('max'), type: 'number', placeholder: '(blank = ∞)' },
          { name: 'description_en', label: t('description') },
          { name: 'signer_chain_json', label: t('signer_chain'), type: 'textarea', placeholder: '[{"mode":"all","roles":["CFO"]}]' }
        ], t('save'), function (v) {
          if (v.signer_chain_json) { try { JSON.parse(v.signer_chain_json); } catch (e) { throw new Error(t('bad_json')); } }
          return API.act('admin.doa.upsert', { record: v }).then(function () { toast(t('save') + ' ✓', 'success'); reload(); });
        });
        wrap.appendChild(el('details', { class: 'card collapsible' }, [el('summary', { text: '＋ ' + t('authority') }), f.form]));
      }
      var cols = [
        { key: 'domain', label: t('domain') }, { key: 'action', label: t('action') },
        { key: 'min_amount', label: t('min') }, { label: t('max'), render: function (b) { return b.max_amount === '' ? '∞' : b.max_amount; } },
        { label: t('signer_chain'), render: function (b) {
          try { return (JSON.parse(b.signer_chain_json) || []).map(function (s) { return (s.roles || []).join('/') + (s.mode === 'any' ? '?' : ''); }).join(' → '); }
          catch (e) { return b.signer_chain_json || ''; }
        } },
        { key: 'description_en', label: t('description') }
      ];
      wrap.appendChild(el('div', { class: 'card' }, [UI.table(bands, cols)]));
      return wrap;
    });
  }

  /* ============================= LOOKUPS =============================== */
  function lookupsTab(reload) {
    return API.list('lookups').then(function (rows) {
      var wrap = el('div', {});
      if (can('admin', 'lookups', 'admin')) {
        var f = UI.form([
          { name: 'category', label: t('category'), required: true, placeholder: 'sector' },
          { name: 'code', label: t('code'), required: true },
          { name: 'label_en', label: t('name_en'), required: true },
          { name: 'label_ar', label: t('name_ar') }
        ], t('add'), function (v) { return API.act('admin.lookup.upsert', { record: v }).then(function () { toast('✓', 'success'); reload(); }); });
        wrap.appendChild(el('details', { class: 'card collapsible' }, [el('summary', { text: '＋ ' + t('lookups') }), f.form]));
      }
      var byCat = {}; rows.forEach(function (l) { (byCat[l.category] = byCat[l.category] || []).push(l); });
      Object.keys(byCat).sort().forEach(function (cat) {
        wrap.appendChild(el('details', { class: 'card collapsible' }, [
          el('summary', { text: cat + '  (' + byCat[cat].length + ')' }),
          UI.table(byCat[cat], [
            { key: 'code', label: t('code') }, { key: 'label_en', label: t('name_en') },
            { key: 'label_ar', label: t('name_ar') }, { key: 'active', label: t('status') }
          ])
        ]));
      });
      return wrap;
    });
  }

  /* ============================== AUDIT ================================ */
  function auditTab() {
    return API.act('admin.audit.recent', { limit: 80 }).then(function (rows) {
      var cols = [
        { label: t('date'), render: function (r) { return String(r.ts || '').slice(0, 16).replace('T', ' '); } },
        { key: 'user_email', label: t('email') }, { key: 'action', label: t('action') },
        { key: 'module', label: t('module') }, { key: 'entity', label: t('entity') },
        { key: 'amount', label: t('amount') }, { key: 'note', label: t('comment') }
      ];
      return el('div', { class: 'card' }, [UI.table(rows, cols)]);
    });
  }

  function view() {
    var defs = [{ key: 'users', label: t('users'), render: usersTab }];
    if (can('admin', 'permissions', 'view') || can('admin', 'permissions', 'admin'))
      defs.push({ key: 'perms', label: t('roles') + ' & ' + t('permissions'), render: permsTab });
    if (can('admin', 'doa_bands', 'view') || can('admin', 'doa_bands', 'admin'))
      defs.push({ key: 'doa', label: t('authority'), render: doaTab });
    if (can('admin', 'lookups', 'view') || can('admin', 'lookups', 'admin'))
      defs.push({ key: 'lookups', label: t('lookups'), render: lookupsTab });
    defs.push({ key: 'audit', label: t('audit'), render: auditTab });
    var wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'section-head' }, [el('h2', { text: t('admin') })]));
    wrap.appendChild(tabs(defs));
    return Promise.resolve(wrap);
  }

  window.ADMIN = { view: view };
})();
