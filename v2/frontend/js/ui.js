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
  window.UI = { el: el, clear: clear, toast: toast, form: form, table: table };
})();
