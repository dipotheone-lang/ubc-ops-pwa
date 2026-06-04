/**
 * Departments.gs
 * ---------------------------------------------------------------------------
 * Department-specific business operations layered on the generic CRUD.
 * Each "create document" op assigns a human-readable number and (where a file
 * is attached) routes uploads to the correct project sub-folder.
 *
 * Modules: Procurement, TechnicalOffice, Accounting, Warehouse.
 * All are invoked through the action router in Code.gs.
 * ---------------------------------------------------------------------------
 */

/* ============================= PROCUREMENT ============================== */
var Procurement = {

  /** Material Requisition header + optional lines in one atomic-ish call. */
  createRequisition: function (body, actor) {
    requireFields(body, ['project_id']);
    if (!body.mr_number) body.mr_number = nextDocNumber_('MR');
    body.status = body.status || 'Draft';
    var header = dbInsert('material_requisitions', body, actor);

    var lines = Array.isArray(body.lines) ? body.lines : [];
    var stored = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = pickColumns('material_requisition_lines', lines[i]);
      ln.mr_id = header.id;
      ln.line_no = ln.line_no || (i + 1);
      ln.qty = coerceNumber(ln.qty);
      ln.est_unit_price_egp = coerceNumber(ln.est_unit_price_egp);
      ln.est_total_egp = coerceNumber(ln.est_total_egp) ||
        (Number(ln.qty || 0) * Number(ln.est_unit_price_egp || 0));
      // Per-line idempotency key derived from header capture + line index.
      if (body.client_uuid) ln.client_uuid = body.client_uuid + ':L' + ln.line_no;
      stored.push(dbInsert('material_requisition_lines', ln, actor));
    }
    return { header: header, lines: stored };
  },

  createPurchaseOrder: function (body, actor) {
    requireFields(body, ['project_id', 'supplier_name']);
    if (!body.po_number) body.po_number = nextDocNumber_('PO');
    body.status = body.status || 'Draft';
    var sub = 0;
    var lines = Array.isArray(body.lines) ? body.lines : [];
    for (var i = 0; i < lines.length; i++) {
      var lt = Number(lines[i].qty || 0) * Number(lines[i].unit_price_egp || 0);
      lines[i].line_total_egp = coerceNumber(lines[i].line_total_egp) || lt;
      sub += Number(lines[i].line_total_egp || 0);
    }
    if (body.subtotal_egp === undefined || body.subtotal_egp === '') body.subtotal_egp = sub;
    if (body.vat_egp === undefined || body.vat_egp === '') {
      body.vat_egp = Math.round(sub * 0.14 * 100) / 100; // Egypt VAT default 14%
    }
    if (body.total_egp === undefined || body.total_egp === '') {
      body.total_egp = Number(body.subtotal_egp) + Number(body.vat_egp);
    }
    var header = dbInsert('purchase_orders', body, actor);

    var stored = [];
    for (var j = 0; j < lines.length; j++) {
      var ln = pickColumns('purchase_order_lines', lines[j]);
      ln.po_id = header.id;
      ln.line_no = ln.line_no || (j + 1);
      ln.qty = coerceNumber(ln.qty);
      ln.unit_price_egp = coerceNumber(ln.unit_price_egp);
      if (body.client_uuid) ln.client_uuid = body.client_uuid + ':L' + ln.line_no;
      stored.push(dbInsert('purchase_order_lines', ln, actor));
    }
    return { header: header, lines: stored };
  },

  logPrice: function (body, actor) {
    requireFields(body, ['item_description', 'supplier_name', 'unit_price_egp']);
    body.unit_price_egp = coerceNumber(body.unit_price_egp);
    return dbInsert('price_tracker', body, actor);
  }
};

/* =========================== TECHNICAL OFFICE ========================== */
var TechnicalOffice = {

  logProgress: function (body, actor) {
    requireFields(body, ['project_id', 'log_date']);
    body.progress_pct = coerceNumber(body.progress_pct);
    body.manpower_count = coerceNumber(body.manpower_count);
    return dbInsert('site_progress_logs', body, actor);
  },

  addTakeoff: function (body, actor) {
    requireFields(body, ['project_id', 'description', 'unit']);
    var L = Number(body.length_m || 0), W = Number(body.width_m || 0),
        H = Number(body.height_m || 0), C = Number(body.count || 1);
    // qty = product of provided dimensions × count (dims of 0 are treated as 1).
    var dims = [L, W, H].filter(function (x) { return x > 0; });
    var product = dims.reduce(function (a, b) { return a * b; }, 1);
    if (body.qty === undefined || body.qty === '') body.qty = product * (C || 1);
    body.qty = coerceNumber(body.qty);
    body.unit_rate_egp = coerceNumber(body.unit_rate_egp);
    if (body.amount_egp === undefined || body.amount_egp === '') {
      body.amount_egp = Number(body.qty || 0) * Number(body.unit_rate_egp || 0);
    }
    return dbInsert('quantity_takeoffs', body, actor);
  },

  signoffMilestone: function (body, actor) {
    requireFields(body, ['project_id', 'milestone_name']);
    body.status = body.status || 'Pending';
    body.value_egp = coerceNumber(body.value_egp);
    return dbInsert('milestone_signoffs', body, actor);
  }
};

/* ============================== ACCOUNTING ============================= */
var Accounting = {

  logExpense: function (body, actor) {
    requireFields(body, ['project_id', 'expense_date', 'amount_egp']);
    body.amount_egp = coerceNumber(body.amount_egp);
    return dbInsert('expense_logs', body, actor);
  },

  recordSubcontractorPayment: function (body, actor) {
    requireFields(body, ['project_id', 'subcontractor_name', 'gross_amount_egp']);
    var gross = Number(body.gross_amount_egp || 0);
    var retPct = Number(body.retention_pct || 0);
    if (body.retention_egp === undefined || body.retention_egp === '') {
      body.retention_egp = Math.round(gross * (retPct / 100) * 100) / 100;
    }
    var ded = Number(body.deductions_egp || 0);
    if (body.net_payable_egp === undefined || body.net_payable_egp === '') {
      body.net_payable_egp = gross - Number(body.retention_egp) - ded;
    }
    body.gross_amount_egp = gross;
    body.status = body.status || 'Submitted';
    return dbInsert('subcontractor_payments', body, actor);
  },

  saveReceipt: function (body, actor) {
    requireFields(body, ['project_id', 'amount_egp']);
    body.amount_egp = coerceNumber(body.amount_egp);
    return dbInsert('digital_receipts', body, actor);
  }
};

/* ============================== WAREHOUSE ============================== */
var Warehouse = {

  createMTR: function (body, actor) {
    requireFields(body, ['from_project_id', 'to_project_id', 'transfer_date']);
    if (!body.mtr_number) body.mtr_number = nextDocNumber_('MTR');
    body.status = body.status || 'Requested';
    var header = dbInsert('material_transfers', body, actor);
    var lines = Array.isArray(body.lines) ? body.lines : [];
    var stored = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = pickColumns('material_transfer_lines', lines[i]);
      ln.mtr_id = header.id;
      ln.line_no = ln.line_no || (i + 1);
      ln.qty = coerceNumber(ln.qty);
      if (body.client_uuid) ln.client_uuid = body.client_uuid + ':L' + ln.line_no;
      stored.push(dbInsert('material_transfer_lines', ln, actor));
    }
    return { header: header, lines: stored };
  },

  createGRN: function (body, actor) {
    requireFields(body, ['project_id', 'received_date']);
    if (!body.grn_number) body.grn_number = nextDocNumber_('GRN');
    body.condition = body.condition || 'Good';
    var header = dbInsert('goods_received_notes', body, actor);
    var lines = Array.isArray(body.lines) ? body.lines : [];
    var stored = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = pickColumns('goods_received_lines', lines[i]);
      ln.grn_id = header.id;
      ln.line_no = ln.line_no || (i + 1);
      ln.qty_ordered = coerceNumber(ln.qty_ordered);
      ln.qty_received = coerceNumber(ln.qty_received);
      ln.qty_accepted = coerceNumber(ln.qty_accepted);
      if (body.client_uuid) ln.client_uuid = body.client_uuid + ':L' + ln.line_no;
      stored.push(dbInsert('goods_received_lines', ln, actor));
      // Auto-increment stock on accepted goods.
      if (ln.item_code && Number(ln.qty_accepted || 0) > 0) {
        Warehouse._receiveIntoStock(header.project_id, ln, actor);
      }
    }
    return { header: header, lines: stored };
  },

  /** Upsert a stock item and add accepted qty to on-hand. */
  _receiveIntoStock: function (projectId, line, actor) {
    var existing = dbList('stock_items', { project_id: projectId, item_code: line.item_code });
    if (existing.length) {
      var s = existing[0];
      var newQty = Number(s.qty_on_hand || 0) + Number(line.qty_accepted || 0);
      dbUpdate('stock_items', s.id, { qty_on_hand: newQty }, actor);
    } else {
      dbInsert('stock_items', {
        project_id: projectId,
        item_code: line.item_code,
        description: line.description,
        unit: line.unit,
        qty_on_hand: Number(line.qty_accepted || 0),
        min_level: 0,
        client_uuid: 'stock:' + projectId + ':' + line.item_code
      }, actor);
    }
  },

  upsertStockItem: function (body, actor) {
    requireFields(body, ['project_id', 'item_code', 'description']);
    body.qty_on_hand = coerceNumber(body.qty_on_hand);
    body.min_level = coerceNumber(body.min_level);
    var existing = dbList('stock_items', {
      project_id: body.project_id, item_code: body.item_code
    });
    if (existing.length) return dbUpdate('stock_items', existing[0].id, body, actor);
    return dbInsert('stock_items', body, actor);
  },

  /** Items at/below minimum level — the "stock minimums" alert view. */
  lowStock: function (projectId) {
    var rows = projectId
      ? dbList('stock_items', { project_id: projectId })
      : dbList('stock_items');
    return rows.filter(function (r) {
      return Number(r.min_level || 0) > 0 &&
        Number(r.qty_on_hand || 0) <= Number(r.min_level || 0);
    });
  }
};
