/**
 * ui.js — minimal DOM + form/table/toast helpers (framework-free, RTL-aware).
 */
(function () {
  'use strict';
  function el(tag, attrs, kids) {
    var n = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c == null) return; n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  var _tt;
  function toast(msg, kind) {
    var t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast show ' + (kind || 'info');
    if (_tt) clearTimeout(_tt); _tt = setTimeout(function () { t.className = 'toast'; }, 4000);
  }
  function form(fields, submitLabel, onSubmit) {
    var inputs = {}, f = el('form', { class: 'form', autocomplete: 'off' });
    fields.forEach(function (fl) {
      var id = 'f_' + fl.name, w = el('div', { class: 'field' });
      w.appendChild(el('label', { for: id, text: fl.label + (fl.required ? ' *' : '') }));
      var input;
      if (fl.type === 'select') {
        input = el('select', { id: id });
        if (!fl.required) input.appendChild(el('option', { value: '', text: '—' }));
        (fl.options || []).forEach(function (o) {
          var v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
          input.appendChild(el('option', { value: v, text: l }));
        });
        if (fl.value) input.value = fl.value;
      } else if (fl.type === 'textarea') { input = el('textarea', { id: id, rows: 3 }); if (fl.value) input.value = fl.value; }
      else { input = el('input', { id: id, type: fl.type || 'text', value: fl.value || '', placeholder: fl.placeholder || '', step: fl.type === 'number' ? 'any' : null }); }
      inputs[fl.name] = { node: input, spec: fl };
      w.appendChild(input); w.appendChild(el('div', { class: 'field-error', id: id + '_err' }));
      f.appendChild(w);
    });
    var btn = el('button', { type: 'submit', class: 'btn primary', text: submitLabel });
    f.appendChild(btn);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = {}, okv = true;
      Object.keys(inputs).forEach(function (name) {
        var rec = inputs[name]; v[name] = rec.node.value;
        var errN = document.getElementById('f_' + name + '_err'); errN.textContent = '';
        if (rec.spec.required && !v[name]) { errN.textContent = '!'; okv = false; }
      });
      if (!okv) return;
      btn.disabled = true;
      Promise.resolve(onSubmit(v)).then(function () { btn.disabled = false; })
        .catch(function (err) { btn.disabled = false; toast(err.message || 'Error', 'error'); });
    });
    return { form: f };
  }
  function table(rows, cols) {
    if (!rows || !rows.length) return el('p', { class: 'muted', text: I18N.t('no_records') });
    var t = el('table', { class: 'data' }), thead = el('thead'), tr = el('tr');
    cols.forEach(function (c) { tr.appendChild(el('th', { text: c.label })); });
    thead.appendChild(tr); t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      cols.forEach(function (c) {
        var v = c.render ? c.render(r) : r[c.key];
        if (v && v.nodeType) row.appendChild(el('td', {}, [v]));
        else row.appendChild(el('td', { text: v == null ? '' : String(v) }));
      });
      tb.appendChild(row);
    });
    t.appendChild(tb); return el('div', { class: 'table-wrap' }, [t]);
  }

  /** Shared modal. Returns { close }. */
  function modal(title, body, opts) {
    var box = el('div', { class: 'modal-box' + (opts && opts.wide ? ' wide' : '') }, [
      el('div', { class: 'modal-head' }, [el('h3', { text: title }), el('button', { class: 'icon-btn', text: '✕', onclick: function () { close(); } })]),
      el('div', { class: 'modal-body' }, [body])
    ]);
    var overlay = el('div', { class: 'modal-overlay', onclick: function (e) { if (e.target === overlay) close(); } }, [box]);
    document.body.appendChild(overlay);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    return { close: close, body: box.querySelector('.modal-body') };
  }

  /**
   * Searchable / sortable / paginated table.
   * cols: [{ key|render, label, sortKey? }]. opts: { onRow, pageSize, searchKeys }
   */
  function dataTable(rows, cols, opts) {
    opts = opts || {}; var pageSize = opts.pageSize || 25;
    var state = { q: '', sort: null, dir: 1, page: 0 };
    var wrap = el('div', {});
    var search = el('input', { class: 'tbl-search', type: 'search', placeholder: '🔎 ' + (I18N.t('search') || 'Search') });
    var holder = el('div', {});
    wrap.appendChild(search); wrap.appendChild(holder);

    function val(r, c) { return c.render ? null : r[c.key]; }
    function searchText(r) {
      var keys = opts.searchKeys || cols.filter(function (c) { return c.key; }).map(function (c) { return c.key; });
      return keys.map(function (k) { return String(r[k] == null ? '' : r[k]); }).join(' ').toLowerCase();
    }
    function draw() {
      UI.clear(holder);
      var data = rows.slice();
      if (state.q) { var q = state.q.toLowerCase(); data = data.filter(function (r) { return searchText(r).indexOf(q) !== -1; }); }
      if (state.sort) data.sort(function (a, b) {
        var x = a[state.sort], y = b[state.sort];
        var nx = Number(x), ny = Number(y);
        if (!isNaN(nx) && !isNaN(ny) && x !== '' && y !== '') return (nx - ny) * state.dir;
        return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)) * state.dir;
      });
      var total = data.length, pages = Math.max(1, Math.ceil(total / pageSize));
      if (state.page >= pages) state.page = pages - 1;
      var slice = data.slice(state.page * pageSize, state.page * pageSize + pageSize);
      if (!total) { holder.appendChild(el('p', { class: 'muted', text: I18N.t('no_records') })); return; }
      var t = el('table', { class: 'data' });
      var thead = el('thead'), tr = el('tr');
      cols.forEach(function (c) {
        var sortable = !!c.key;
        var th = el('th', { class: sortable ? 'sortable' : '', text: c.label + (state.sort === c.key ? (state.dir > 0 ? ' ▲' : ' ▼') : '') });
        if (sortable) th.addEventListener('click', function () { if (state.sort === c.key) state.dir = -state.dir; else { state.sort = c.key; state.dir = 1; } draw(); });
        tr.appendChild(th);
      });
      thead.appendChild(tr); t.appendChild(thead);
      var tb = el('tbody');
      slice.forEach(function (r) {
        var row = el('tr', opts.onRow ? { class: 'clickable', onclick: function () { opts.onRow(r); } } : {});
        cols.forEach(function (c) {
          var v = c.render ? c.render(r) : r[c.key];
          if (v && v.nodeType) row.appendChild(el('td', {}, [v]));
          else row.appendChild(el('td', { text: v == null ? '' : String(v) }));
        });
        tb.appendChild(row);
      });
      t.appendChild(tb);
      holder.appendChild(el('div', { class: 'table-wrap' }, [t]));
      if (pages > 1) {
        holder.appendChild(el('div', { class: 'pager' }, [
          el('button', { class: 'btn small', text: '‹', onclick: function () { if (state.page > 0) { state.page--; draw(); } } }),
          el('span', { class: 'muted', text: (state.page + 1) + ' / ' + pages + '  (' + total + ')' }),
          el('button', { class: 'btn small', text: '›', onclick: function () { if (state.page < pages - 1) { state.page++; draw(); } } })
        ]));
      }
    }
    var deb; search.addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(function () { state.q = search.value; state.page = 0; draw(); }, 200); });
    draw();
    return wrap;
  }

  window.UI = { el: el, clear: clear, toast: toast, form: form, table: table, modal: modal, dataTable: dataTable };
})();
