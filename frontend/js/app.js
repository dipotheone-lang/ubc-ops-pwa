/**
 * app.js — application shell, hash router, and all department views.
 */
(function () {
  'use strict';
  var el = UI.el, toast = UI.toast;
  var STATE = { projects: [], schema: null, online: navigator.onLine };

  /* ----------------------- bootstrap ----------------------------------- */
  function boot() {
    registerSW();
    wireChrome();
    UBC_SYNC.on(onSyncEvent);
    refreshPendingBadge();
    loadProjects().catch(function () {});
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/dashboard';
    else route();
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
  }

  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(function (e) {
        console.warn('SW registration failed', e);
      });
    }
  }

  function wireChrome() {
    document.getElementById('menu-toggle').addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('open');
    });
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.addEventListener('click', function () {
        document.getElementById('sidebar').classList.remove('open');
      });
    });
    document.getElementById('sync-now').addEventListener('click', function () {
      if (!UBC_SYNC.isOnline()) { toast('You are offline', 'error'); return; }
      UBC_SYNC.processQueue().then(function () { toast('Sync complete', 'success'); });
    });
  }

  function updateOnline() {
    STATE.online = navigator.onLine;
    var b = document.getElementById('net-status');
    b.textContent = STATE.online ? 'Online' : 'Offline';
    b.className = 'badge ' + (STATE.online ? 'ok' : 'warn');
  }

  function onSyncEvent(s) {
    if (s.event === 'sync-done') { refreshPendingBadge(); loadProjects().catch(function () {}); }
    if (s.event === 'queued') refreshPendingBadge();
    if (s.event === 'sync-start') document.getElementById('sync-now').classList.add('spin');
    if (s.event === 'sync-done' || s.event === 'sync-error')
      document.getElementById('sync-now').classList.remove('spin');
  }

  function refreshPendingBadge() {
    UBC_SYNC.pendingCount().then(function (n) {
      var b = document.getElementById('pending-badge');
      b.textContent = n;
      b.style.display = n > 0 ? 'inline-flex' : 'none';
    });
  }

  /* ----------------------- data helpers -------------------------------- */
  function loadProjects() {
    if (UBC_SYNC.isOnline() && getApiBase()) {
      return UBC_API.list('projects').then(function (rows) {
        STATE.projects = rows || [];
        return UBC_DB.putCache('projects', STATE.projects);
      }).then(function () { return STATE.projects; })
        .catch(function () { return loadProjectsFromCache(); });
    }
    return loadProjectsFromCache();
  }
  function loadProjectsFromCache() {
    return UBC_DB.getCache('projects').then(function (rows) {
      STATE.projects = rows || [];
      return STATE.projects;
    });
  }
  function projectOptions() {
    return STATE.projects.map(function (p) {
      return { value: p.id, label: (p.project_code ? p.project_code + ' — ' : '') + p.project_name };
    });
  }

  /** Compress an attached file (if any) into op.file shape for the sync queue. */
  function buildFilePart(file, slot, targetField) {
    if (!file) return Promise.resolve(null);
    return UBC_IMG.compress(file).then(function (c) {
      return { blob: c.blob, name: c.name, mime: c.mime, slot: slot, targetField: targetField };
    });
  }

  /** Submit a department write: compress file -> queue (offline-first). */
  function submitWrite(action, payload, fileField, slot, targetField) {
    var file = fileField ? payload[fileField] : null;
    if (fileField) delete payload[fileField];
    // strip empty strings to keep the ledger clean
    Object.keys(payload).forEach(function (k) { if (payload[k] === '') delete payload[k]; });

    return buildFilePart(file, slot, targetField || 'attachment_url').then(function (filePart) {
      return UBC_SYNC.queueWrite(action, payload, filePart);
    }).then(function () {
      toast(UBC_SYNC.isOnline() ? 'Saved & syncing…' : 'Saved offline — will sync', 'success');
      route(); // re-render current view (refresh lists)
    });
  }

  /* --------------------------- ROUTER ---------------------------------- */
  var ROUTES = {
    'dashboard': viewDashboard,
    'projects': viewProjects,
    'procurement': viewProcurement,
    'technical': viewTechnical,
    'accounting': viewAccounting,
    'warehouse': viewWarehouse,
    'queue': viewQueue,
    'settings': viewSettings
  };

  function route() {
    var hash = (location.hash || '#/dashboard').replace(/^#\//, '');
    var name = hash.split('/')[0];
    var view = ROUTES[name] || viewDashboard;
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#/' + name);
    });
    var main = document.getElementById('view');
    UI.clear(main);
    main.appendChild(el('div', { class: 'loading', text: 'Loading…' }));
    Promise.resolve(view()).then(function (node) {
      UI.clear(main);
      main.appendChild(node);
    }).catch(function (err) {
      UI.clear(main);
      main.appendChild(el('div', { class: 'error-box', text: err.message || String(err) }));
    });
  }

  function section(title, subtitle) {
    return el('div', { class: 'section-head' }, [
      el('h2', { text: title }),
      subtitle ? el('p', { class: 'muted', text: subtitle }) : null
    ]);
  }

  function card(title, bodyNode) {
    return el('div', { class: 'card' }, [
      el('h3', { text: title }),
      bodyNode
    ]);
  }

  function tabs(items) {
    // items: [{ id, label, render }]
    var wrap = el('div', { class: 'tabs' });
    var bar = el('div', { class: 'tabbar' });
    var body = el('div', { class: 'tabbody' });
    items.forEach(function (it, i) {
      var b = el('button', { class: 'tab' + (i === 0 ? ' active' : ''), text: it.label,
        onclick: function () {
          bar.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          UI.clear(body);
          Promise.resolve(it.render()).then(function (n) { UI.clear(body); body.appendChild(n); });
        }
      });
      bar.appendChild(b);
    });
    wrap.appendChild(bar); wrap.appendChild(body);
    Promise.resolve(items[0].render()).then(function (n) { body.appendChild(n); });
    return wrap;
  }

  /* --------------------------- DASHBOARD ------------------------------- */
  function viewDashboard() {
    return loadProjects().then(function (projects) {
      var active = projects.filter(function (p) { return p.status === 'Active'; });
      var totalValue = projects.reduce(function (a, p) { return a + Number(p.contract_value_egp || 0); }, 0);
      return UBC_SYNC.pendingCount().then(function (pending) {
        var wrap = el('div', {});
        wrap.appendChild(section('Dashboard', 'United Brothers Co. — Operations'));
        var grid = el('div', { class: 'stats' }, [
          stat('Projects', projects.length),
          stat('Active', active.length),
          stat('Portfolio (EGP)', fmtMoney(totalValue)),
          stat('Pending sync', pending)
        ]);
        wrap.appendChild(grid);
        wrap.appendChild(card('Projects', UI.table(projects, [
          { key: 'project_code', label: 'Code' },
          { key: 'project_name', label: 'Name' },
          { key: 'status', label: 'Status' },
          { label: 'Value', render: function (r) { return fmtMoney(r.contract_value_egp); } },
          { label: 'Drive', render: function (r) {
            return r.drive_root_url ? el('a', { href: r.drive_root_url, target: '_blank', text: 'Open' }) : '';
          } }
        ])));
        return wrap;
      });
    });
  }
  function stat(label, value) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'stat-value', text: String(value) }),
      el('div', { class: 'stat-label', text: label })
    ]);
  }

  /* --------------------------- PROJECTS -------------------------------- */
  function viewProjects() {
    return loadProjects().then(function (projects) {
      var wrap = el('div', {});
      wrap.appendChild(section('Projects', 'Create a project to auto-provision its Drive folder tree'));

      var f = UI.buildForm([
        { name: 'project_name', label: 'Project Name', required: true },
        { name: 'client_name', label: 'Client' },
        { name: 'location', label: 'Location' },
        { name: 'contract_value_egp', label: 'Contract Value (EGP)', type: 'number' },
        { name: 'start_date', label: 'Start Date', type: 'date' },
        { name: 'end_date', label: 'End Date', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', options: ['Planned', 'Active', 'On Hold', 'Closed'], value: 'Planned' }
      ], 'Create Project + Drive Tree', function (v) {
        if (!getApiBase()) { toast('Set API URL in Settings first', 'error'); return; }
        if (!UBC_SYNC.isOnline()) {
          // Project creation provisions Drive — must be online.
          toast('Project creation needs connectivity (Drive provisioning).', 'error');
          return;
        }
        v.client_uuid = 'prj_' + Date.now();
        return UBC_API.action('project.create', { record: v }).then(function (p) {
          toast('Project created. Drive tree provisioned.', 'success');
          return loadProjects().then(route);
        });
      });
      wrap.appendChild(card('New Project', f.form));

      wrap.appendChild(card('All Projects', UI.table(projects, [
        { key: 'project_code', label: 'Code' },
        { key: 'project_name', label: 'Name' },
        { key: 'client_name', label: 'Client' },
        { key: 'status', label: 'Status' },
        { label: 'Folders', render: function (r) {
          var box = el('div', { class: 'links' });
          [['Proc', r.folder_procurement_url], ['Tech', r.folder_technical_url],
           ['Acc', r.folder_accounting_url], ['WH', r.folder_warehouse_url],
           ['Site', r.folder_site_url]].forEach(function (pair) {
            if (pair[1]) box.appendChild(el('a', { href: pair[1], target: '_blank', text: pair[0] }));
          });
          return box;
        } }
      ])));
      return wrap;
    });
  }

  /* ------------------------- PROCUREMENT ------------------------------- */
  function viewProcurement() {
    return loadProjects().then(function () {
      var wrap = el('div', {});
      wrap.appendChild(section('Procurement', 'Requisitions · Purchase Orders · Price Tracker'));
      wrap.appendChild(tabs([
        { id: 'mr', label: 'Material Requisition', render: formMR },
        { id: 'po', label: 'Purchase Order', render: formPO },
        { id: 'price', label: 'Price Tracker', render: formPrice },
        { id: 'list', label: 'Records', render: function () { return listEntity('material_requisitions',
            [{ key: 'mr_number', label: 'MR#' }, { key: 'status', label: 'Status' }, { key: 'required_date', label: 'Needed' }]); } }
      ]));
      return wrap;
    });
  }

  function formMR() {
    var lines = lineEditor(['description', 'unit', 'qty', 'est_unit_price_egp']);
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'required_date', label: 'Required Date', type: 'date' },
      { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Normal', 'High', 'Urgent'], value: 'Normal' },
      { name: 'cost_code', label: 'Cost Code' },
      { name: 'notes', label: 'Notes', type: 'textarea' }
    ], 'Submit Requisition', function (v) {
      v.lines = lines.getRows();
      v.client_uuid = 'mr_' + Date.now();
      return submitWrite('procurement.requisition', v);
    });
    return el('div', {}, [f.form, el('h4', { text: 'Line Items' }), lines.node]);
  }

  function formPO() {
    var lines = lineEditor(['description', 'unit', 'qty', 'unit_price_egp']);
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'supplier_name', label: 'Supplier', required: true },
      { name: 'supplier_contact', label: 'Supplier Contact' },
      { name: 'order_date', label: 'Order Date', type: 'date' },
      { name: 'delivery_date', label: 'Delivery Date', type: 'date' },
      { name: 'currency', label: 'Currency', type: 'select', options: ['EGP', 'USD', 'EUR'], value: 'EGP' },
      { name: 'notes', label: 'Notes', type: 'textarea' }
    ], 'Create PO', function (v) {
      v.lines = lines.getRows();
      v.client_uuid = 'po_' + Date.now();
      return submitWrite('procurement.po', v);
    });
    return el('div', {}, [f.form, el('h4', { text: 'Line Items' }), lines.node]);
  }

  function formPrice() {
    var f = UI.buildForm([
      { name: 'item_description', label: 'Item', required: true },
      { name: 'unit', label: 'Unit' },
      { name: 'supplier_name', label: 'Supplier', required: true },
      { name: 'unit_price_egp', label: 'Unit Price (EGP)', type: 'number', required: true },
      { name: 'quote_date', label: 'Quote Date', type: 'date' },
      { name: 'valid_until', label: 'Valid Until', type: 'date' },
      { name: 'source', label: 'Source' }
    ], 'Log Price', function (v) {
      v.client_uuid = 'price_' + Date.now();
      return submitWrite('procurement.price', v);
    });
    return f.form;
  }

  /* ------------------------ TECHNICAL OFFICE --------------------------- */
  function viewTechnical() {
    return loadProjects().then(function () {
      var wrap = el('div', {});
      wrap.appendChild(section('Technical Office', 'Progress Logs · Takeoffs · Milestones'));
      wrap.appendChild(tabs([
        { id: 'prog', label: 'Daily Progress', render: formProgress },
        { id: 'takeoff', label: 'Quantity Takeoff', render: formTakeoff },
        { id: 'milestone', label: 'Milestone Sign-off', render: formMilestone },
        { id: 'list', label: 'Records', render: function () { return listEntity('site_progress_logs',
            [{ key: 'log_date', label: 'Date' }, { key: 'progress_pct', label: '%' }, { key: 'activities', label: 'Activities' }]); } }
      ]));
      return wrap;
    });
  }

  function formProgress() {
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'log_date', label: 'Date', type: 'date', required: true },
      { name: 'weather', label: 'Weather' },
      { name: 'manpower_count', label: 'Manpower', type: 'number' },
      { name: 'equipment_count', label: 'Equipment', type: 'number' },
      { name: 'progress_pct', label: 'Progress %', type: 'number' },
      { name: 'activities', label: 'Activities', type: 'textarea' },
      { name: 'delays', label: 'Delays / Issues', type: 'textarea' },
      { name: 'photo', label: 'Site Photo', type: 'file', capture: 'environment' }
    ], 'Save Progress Log', function (v) {
      v.client_uuid = 'prog_' + Date.now();
      return submitWrite('tech.progress', v, 'photo', 'site', 'photo_url');
    });
    return f.form;
  }

  function formTakeoff() {
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'boq_ref', label: 'BOQ Ref' },
      { name: 'description', label: 'Description', required: true },
      { name: 'unit', label: 'Unit', required: true },
      { name: 'length_m', label: 'Length (m)', type: 'number' },
      { name: 'width_m', label: 'Width (m)', type: 'number' },
      { name: 'height_m', label: 'Height (m)', type: 'number' },
      { name: 'count', label: 'Count', type: 'number', value: '1' },
      { name: 'unit_rate_egp', label: 'Unit Rate (EGP)', type: 'number' },
      { name: 'discipline', label: 'Discipline' }
    ], 'Add Takeoff', function (v) {
      v.client_uuid = 'tko_' + Date.now();
      return submitWrite('tech.takeoff', v);
    });
    return f.form;
  }

  function formMilestone() {
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'milestone_name', label: 'Milestone', required: true },
      { name: 'planned_date', label: 'Planned Date', type: 'date' },
      { name: 'actual_date', label: 'Actual Date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'Delivered', 'Approved', 'Disputed'], value: 'Pending' },
      { name: 'value_egp', label: 'Value (EGP)', type: 'number' },
      { name: 'signed_by', label: 'Signed By' },
      { name: 'evidence', label: 'Evidence Photo', type: 'file', capture: 'environment' },
      { name: 'remarks', label: 'Remarks', type: 'textarea' }
    ], 'Save Milestone', function (v) {
      v.client_uuid = 'ms_' + Date.now();
      return submitWrite('tech.milestone', v, 'evidence', 'technical', 'evidence_url');
    });
    return f.form;
  }

  /* --------------------------- ACCOUNTING ------------------------------ */
  function viewAccounting() {
    return loadProjects().then(function () {
      var wrap = el('div', {});
      wrap.appendChild(section('Accounting & Finance', 'Expenses · Subcontractor Payments · Receipts'));
      wrap.appendChild(tabs([
        { id: 'exp', label: 'Expense', render: formExpense },
        { id: 'sub', label: 'Subcontractor Payment', render: formSubPay },
        { id: 'rcpt', label: 'Digital Receipt', render: formReceipt },
        { id: 'list', label: 'Records', render: function () { return listEntity('expense_logs',
            [{ key: 'expense_date', label: 'Date' }, { key: 'category', label: 'Category' },
             { label: 'Amount', render: function (r) { return fmtMoney(r.amount_egp); } }]); } }
      ]));
      return wrap;
    });
  }

  function formExpense() {
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'expense_date', label: 'Date', type: 'date', required: true },
      { name: 'category', label: 'Category', type: 'select', required: true,
        options: ['Materials', 'Labor', 'Equipment', 'Transport', 'Permits', 'Utilities', 'Subcontractor', 'Misc'] },
      { name: 'amount_egp', label: 'Amount (EGP)', type: 'number', required: true },
      { name: 'payment_method', label: 'Payment', type: 'select', options: ['Cash', 'Bank Transfer', 'Cheque', 'Credit'] },
      { name: 'vendor', label: 'Vendor' },
      { name: 'cost_code', label: 'Cost Code' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'reimbursable', label: 'Reimbursable', type: 'checkbox' },
      { name: 'receipt', label: 'Receipt Photo', type: 'file', capture: 'environment' }
    ], 'Log Expense', function (v) {
      v.client_uuid = 'exp_' + Date.now();
      return submitWrite('acc.expense', v, 'receipt', 'accounting', 'receipt_url');
    });
    return f.form;
  }

  function formSubPay() {
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'subcontractor_name', label: 'Subcontractor', required: true },
      { name: 'contract_ref', label: 'Contract Ref' },
      { name: 'ipc_no', label: 'IPC No.' },
      { name: 'work_period', label: 'Work Period' },
      { name: 'gross_amount_egp', label: 'Gross (EGP)', type: 'number', required: true },
      { name: 'retention_pct', label: 'Retention %', type: 'number', value: '10' },
      { name: 'deductions_egp', label: 'Deductions (EGP)', type: 'number' },
      { name: 'due_date', label: 'Due Date', type: 'date' },
      { name: 'attachment', label: 'Attachment', type: 'file', accept: 'image/*,application/pdf' }
    ], 'Record Payment', function (v) {
      v.client_uuid = 'sub_' + Date.now();
      return submitWrite('acc.subpayment', v, 'attachment', 'accounting', 'attachment_url');
    });
    return f.form;
  }

  function formReceipt() {
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'receipt_no', label: 'Receipt No.' },
      { name: 'receipt_date', label: 'Date', type: 'date' },
      { name: 'vendor', label: 'Vendor' },
      { name: 'amount_egp', label: 'Amount (EGP)', type: 'number', required: true },
      { name: 'image', label: 'Receipt Image', type: 'file', required: true, capture: 'environment' }
    ], 'Save Receipt', function (v) {
      v.client_uuid = 'rcpt_' + Date.now();
      return submitWrite('acc.receipt', v, 'image', 'accounting', 'image_url');
    });
    return f.form;
  }

  /* --------------------------- WAREHOUSE ------------------------------- */
  function viewWarehouse() {
    return loadProjects().then(function () {
      var wrap = el('div', {});
      wrap.appendChild(section('Warehouse', 'Transfers · Goods Received · Stock'));
      wrap.appendChild(tabs([
        { id: 'mtr', label: 'Transfer (MTR)', render: formMTR },
        { id: 'grn', label: 'Goods Received (GRN)', render: formGRN },
        { id: 'stock', label: 'Stock Item', render: formStock },
        { id: 'low', label: 'Low Stock', render: viewLowStock }
      ]));
      return wrap;
    });
  }

  function formMTR() {
    var lines = lineEditor(['item_code', 'description', 'unit', 'qty']);
    var f = UI.buildForm([
      { name: 'from_project_id', label: 'From Project', type: 'select', required: true, options: projectOptions() },
      { name: 'to_project_id', label: 'To Project', type: 'select', required: true, options: projectOptions() },
      { name: 'transfer_date', label: 'Date', type: 'date', required: true },
      { name: 'vehicle', label: 'Vehicle' },
      { name: 'driver', label: 'Driver' },
      { name: 'notes', label: 'Notes', type: 'textarea' }
    ], 'Create MTR', function (v) {
      v.lines = lines.getRows();
      v.client_uuid = 'mtr_' + Date.now();
      return submitWrite('wh.mtr', v);
    });
    return el('div', {}, [f.form, el('h4', { text: 'Items' }), lines.node]);
  }

  function formGRN() {
    var lines = lineEditor(['item_code', 'description', 'unit', 'qty_ordered', 'qty_received', 'qty_accepted']);
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'supplier_name', label: 'Supplier' },
      { name: 'received_date', label: 'Received Date', type: 'date', required: true },
      { name: 'received_by', label: 'Received By' },
      { name: 'condition', label: 'Condition', type: 'select', options: ['Good', 'Damaged', 'Partial', 'Rejected'], value: 'Good' },
      { name: 'photo', label: 'Delivery Photo', type: 'file', capture: 'environment' },
      { name: 'notes', label: 'Notes', type: 'textarea' }
    ], 'Create GRN', function (v) {
      v.lines = lines.getRows();
      v.client_uuid = 'grn_' + Date.now();
      return submitWrite('wh.grn', v, 'photo', 'warehouse', 'photo_url');
    });
    return el('div', {}, [f.form, el('h4', { text: 'Items' }), lines.node]);
  }

  function formStock() {
    var f = UI.buildForm([
      { name: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions() },
      { name: 'item_code', label: 'Item Code', required: true },
      { name: 'description', label: 'Description', required: true },
      { name: 'unit', label: 'Unit' },
      { name: 'qty_on_hand', label: 'Qty On Hand', type: 'number' },
      { name: 'min_level', label: 'Minimum Level', type: 'number' },
      { name: 'reorder_qty', label: 'Reorder Qty', type: 'number' },
      { name: 'location', label: 'Location' }
    ], 'Save Stock Item', function (v) {
      v.client_uuid = 'stock_' + v.project_id + '_' + v.item_code;
      return submitWrite('wh.stock', v);
    });
    return f.form;
  }

  function viewLowStock() {
    if (!UBC_SYNC.isOnline()) return Promise.resolve(el('p', { class: 'muted', text: 'Connect to view live stock levels.' }));
    return UBC_API.post({ action: 'wh.lowstock' }).then(function (rows) {
      return UI.table(rows, [
        { key: 'item_code', label: 'Code' },
        { key: 'description', label: 'Item' },
        { key: 'qty_on_hand', label: 'On Hand' },
        { key: 'min_level', label: 'Min' }
      ]);
    });
  }

  /* ----------------------------- QUEUE --------------------------------- */
  function viewQueue() {
    return UBC_DB.allOps().then(function (ops) {
      var wrap = el('div', {});
      wrap.appendChild(section('Sync Queue', 'Offline captures waiting to upload'));
      wrap.appendChild(el('button', { class: 'btn primary', text: 'Sync Now',
        onclick: function () {
          if (!UBC_SYNC.isOnline()) { toast('Offline', 'error'); return; }
          UBC_SYNC.processQueue().then(function () { toast('Done', 'success'); route(); });
        } }));
      wrap.appendChild(UI.table(ops, [
        { key: 'action', label: 'Action' },
        { key: 'sync_status', label: 'Status' },
        { key: 'attempts', label: 'Tries' },
        { key: 'ts', label: 'Queued' },
        { key: 'last_error', label: 'Last Error' }
      ]));
      return wrap;
    });
  }

  /* ---------------------------- SETTINGS ------------------------------- */
  function viewSettings() {
    var wrap = el('div', {});
    wrap.appendChild(section('Settings', 'Connect this device to the backend'));
    var f = UI.buildForm([
      { name: 'api_base', label: 'Apps Script Web App URL (/exec)', value: getApiBase(), placeholder: 'https://script.google.com/macros/s/…/exec' },
      { name: 'api_token', label: 'API Token', value: getApiToken() },
      { name: 'actor', label: 'Your Name / Email', value: getActor() }
    ], 'Save Settings', function (v) {
      localStorage.setItem('ubc_api_base', v.api_base || '');
      localStorage.setItem('ubc_api_token', v.api_token || '');
      localStorage.setItem('ubc_actor', v.actor || 'app-user');
      toast('Settings saved', 'success');
      return loadProjects().catch(function () {});
    });
    wrap.appendChild(card('Connection', f.form));
    wrap.appendChild(card('Test', el('div', {}, [
      el('button', { class: 'btn', text: 'Ping Backend', onclick: function () {
        UBC_API.ping().then(function (d) { toast('OK: ' + d.service + ' ' + d.version, 'success'); })
          .catch(function (e) { toast('Failed: ' + e.message, 'error'); });
      } })
    ])));
    return Promise.resolve(wrap);
  }

  /* --------------------------- shared bits ----------------------------- */
  function listEntity(entity, columns) {
    if (!UBC_SYNC.isOnline() || !getApiBase())
      return Promise.resolve(el('p', { class: 'muted', text: 'Connect to view records.' }));
    return UBC_API.list(entity).then(function (rows) { return UI.table(rows, columns); })
      .catch(function (e) { return el('div', { class: 'error-box', text: e.message }); });
  }

  /** A repeatable line-item editor. fields = column names. */
  function lineEditor(fields) {
    var rowsWrap = el('div', { class: 'lines' });
    function addRow(prefill) {
      var row = el('div', { class: 'line-row' });
      var inputs = {};
      fields.forEach(function (fn) {
        var isNum = /qty|price|count|level/.test(fn);
        var inp = el('input', { type: isNum ? 'number' : 'text', placeholder: fn, step: isNum ? 'any' : null,
          value: (prefill && prefill[fn]) || '' });
        inputs[fn] = inp;
        row.appendChild(inp);
      });
      row.appendChild(el('button', { type: 'button', class: 'btn small danger', text: '×',
        onclick: function () { rowsWrap.removeChild(row); } }));
      row._inputs = inputs;
      rowsWrap.appendChild(row);
    }
    addRow();
    var node = el('div', {}, [
      rowsWrap,
      el('button', { type: 'button', class: 'btn small', text: '+ Add line', onclick: function () { addRow(); } })
    ]);
    return {
      node: node,
      getRows: function () {
        var out = [];
        rowsWrap.querySelectorAll('.line-row').forEach(function (row) {
          var obj = {}; var any = false;
          fields.forEach(function (fn) {
            var v = row._inputs[fn].value;
            if (v !== '') any = true;
            obj[fn] = v;
          });
          if (any) out.push(obj);
        });
        return out;
      }
    };
  }

  function fmtMoney(n) {
    n = Number(n || 0);
    return n.toLocaleString('en-EG', { maximumFractionDigits: 0 });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
