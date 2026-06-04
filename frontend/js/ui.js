/**
 * ui.js — small DOM + form-rendering helpers (no framework).
 */
(function () {
  'use strict';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      } else if (attrs[k] !== null && attrs[k] !== undefined) {
        node.setAttribute(k, attrs[k]);
      }
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var _toastTimer = null;
  function toast(msg, kind) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (kind || 'info');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { t.className = 'toast'; }, 4000);
  }

  /**
   * Build a form from a field spec and return { form, getValues, setError }.
   * field = { name, label, type, required, options?, placeholder?, value? }
   * type ∈ text|number|date|select|textarea|email|tel|file|checkbox
   */
  function buildForm(fields, submitLabel, onSubmit) {
    var inputs = {};
    var form = el('form', { class: 'form', autocomplete: 'off' });

    fields.forEach(function (f) {
      var id = 'f_' + f.name;
      var wrap = el('div', { class: 'field' });
      wrap.appendChild(el('label', { for: id, text: f.label + (f.required ? ' *' : '') }));

      var input;
      if (f.type === 'select') {
        input = el('select', { id: id, name: f.name });
        if (!f.required) input.appendChild(el('option', { value: '', text: '— select —' }));
        (f.options || []).forEach(function (o) {
          var val = (typeof o === 'object') ? o.value : o;
          var lab = (typeof o === 'object') ? o.label : o;
          input.appendChild(el('option', { value: val, text: lab }));
        });
        if (f.value) input.value = f.value;
      } else if (f.type === 'textarea') {
        input = el('textarea', { id: id, name: f.name, rows: 3, placeholder: f.placeholder || '' });
        if (f.value) input.value = f.value;
      } else if (f.type === 'checkbox') {
        input = el('input', { id: id, name: f.name, type: 'checkbox' });
        if (f.value) input.checked = true;
      } else if (f.type === 'file') {
        input = el('input', { id: id, name: f.name, type: 'file',
          accept: f.accept || 'image/*', capture: f.capture || null });
      } else {
        input = el('input', { id: id, name: f.name, type: f.type || 'text',
          placeholder: f.placeholder || '', value: f.value || '',
          step: f.type === 'number' ? 'any' : null });
      }
      inputs[f.name] = { node: input, spec: f };
      wrap.appendChild(input);
      wrap.appendChild(el('div', { class: 'field-error', id: id + '_err' }));
      form.appendChild(wrap);
    });

    var btn = el('button', { type: 'submit', class: 'btn primary', text: submitLabel || 'Save' });
    form.appendChild(btn);

    function getValues() {
      var out = {};
      Object.keys(inputs).forEach(function (name) {
        var rec = inputs[name];
        if (rec.spec.type === 'checkbox') out[name] = rec.node.checked ? 'TRUE' : 'FALSE';
        else if (rec.spec.type === 'file') out[name] = rec.node.files[0] || null;
        else {
          var v = rec.node.value;
          out[name] = (v === '' ? '' : v);
        }
      });
      return out;
    }

    function validate(values) {
      var ok = true;
      fields.forEach(function (f) {
        var errNode = document.getElementById('f_' + f.name + '_err');
        errNode.textContent = '';
        if (f.required && (values[f.name] === '' || values[f.name] === null)) {
          errNode.textContent = 'Required';
          ok = false;
        }
      });
      return ok;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var values = getValues();
      if (!validate(values)) { toast('Please fix the highlighted fields', 'error'); return; }
      btn.disabled = true;
      Promise.resolve(onSubmit(values)).then(function () {
        btn.disabled = false;
      }).catch(function (err) {
        btn.disabled = false;
        toast(err.message || 'Error', 'error');
      });
    });

    return { form: form, getValues: getValues };
  }

  /** Render an array of objects as a simple responsive table. */
  function table(rows, columns) {
    if (!rows || !rows.length) return el('p', { class: 'muted', text: 'No records.' });
    var t = el('table', { class: 'data' });
    var thead = el('thead');
    var tr = el('tr');
    columns.forEach(function (c) { tr.appendChild(el('th', { text: c.label })); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      columns.forEach(function (c) {
        var v = c.render ? c.render(r) : r[c.key];
        if (v && typeof v === 'object' && v.nodeType) row.appendChild(el('td', {}, [v]));
        else row.appendChild(el('td', { text: v === undefined || v === null ? '' : String(v) }));
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    return el('div', { class: 'table-wrap' }, [t]);
  }

  window.UI = { el: el, clear: clear, toast: toast, buildForm: buildForm, table: table };
})();
