/**
 * Operations.gs — Phase 2 domain services: Procurement, Warehouse, Finance,
 * Technical Office. Documents are created as Draft, then `submitDocument`
 * routes them through the DoA approval engine by (domain × amount). Approval
 * completion flips the document status via applyApprovalOutcome_ (Approvals.gs).
 */

var VAT_RATE = 0.14; // Egypt standard VAT

/** Insert header + numbered child lines for a parent document. */
function insertLines_(entity, parentField, parentId, lines, actor, compute) {
  var out = [];
  (lines || []).forEach(function (ln, i) {
    var rec = pickColumns(entity, ln);
    rec[parentField] = parentId;
    rec.line_no = rec.line_no || (i + 1);
    if (compute) compute(rec);
    out.push(dbInsert(entity, rec, actor));
  });
  return out;
}

/* =============================== SUBMIT ================================= */
/** entity → how to route its approval. domain may be a function(rec). */
var SUBMIT_MAP = {
  material_requisitions: { domain: 'procurement', action: 'commit', amount: 'est_total' },
  purchase_orders: { domain: 'procurement', action: 'commit', amount: 'total' },
  expenses: { domain: 'procurement', action: 'commit', amount: 'amount' },
  payment_vouchers: { domain: function (r) { return r.payment_method === 'Cheque' ? 'payment_cheque' : 'payment_transfer'; }, action: 'pay', amount: 'amount' },
  variation_orders: { domain: 'vor', action: 'approve', amount: 'amount' },
  interim_payment_certs: { domain: 'einvoice', action: 'issue', amount: 'net_amount' },
  project_charters: { domain: 'charter', action: 'sign', amount: 'budget' }
};

/** Submit a draft document into the approval workflow. */
function submitDocument(entity, id, authCtx) {
  var map = SUBMIT_MAP[entity];
  if (!map) throw new AppError('NOT_SUBMITTABLE', entity + ' does not support submission.', 400);
  var rec = dbGet(entity, id);
  if (!rec) throw new AppError('NOT_FOUND', entity + ' not found.', 404);
  if (rec.status && ['Submitted', 'Approved'].indexOf(String(rec.status)) !== -1)
    throw new AppError('ALREADY_SUBMITTED', 'Document is already ' + rec.status + '.', 409);
  var domain = typeof map.domain === 'function' ? map.domain(rec) : map.domain;
  var amount = Number(rec[map.amount] || 0);
  var res = createApprovalRequest({
    domain: domain, action: map.action, entity: entity, record_id: id,
    project_id: rec.project_id, amount: amount, currency: rec.currency || CONFIG.BASE_CURRENCY,
    initiator_user: authCtx.user.id
  }, authCtx.user.email);
  dbUpdate(entity, id, { status: 'Submitted', approval_id: res.request.id }, authCtx.user.email);
  return { request: res.request, steps: res.steps };
}

/* ============================= PROCUREMENT ============================== */
var Procurement = {
  createMR: function (body, authCtx) {
    requireFields(body, ['project_id']);
    var est = (body.lines || []).reduce(function (s, l) {
      return s + (Number(l.qty || 0) * Number(l.est_unit_price || 0)); }, 0);
    var mr = dbInsert('material_requisitions', {
      mr_number: nextDocNumber('MR'), project_id: body.project_id, requested_by: authCtx.user.id,
      required_date: body.required_date, cost_code: body.cost_code, priority: body.priority || 'Normal',
      justification: body.justification, est_total: est, currency: body.currency || 'EGP', status: 'Draft'
    }, authCtx.user.email);
    var lines = insertLines_('mr_lines', 'mr_id', mr.id, body.lines, authCtx.user.email, function (r) {
      r.qty = coerceNumber(r.qty); r.est_unit_price = coerceNumber(r.est_unit_price);
      r.est_total = Number(r.qty || 0) * Number(r.est_unit_price || 0);
    });
    return { header: mr, lines: lines };
  },
  createPO: function (body, authCtx) {
    requireFields(body, ['project_id', 'supplier_id']);
    var sub = (body.lines || []).reduce(function (s, l) {
      return s + (Number(l.qty || 0) * Number(l.unit_price || 0)); }, 0);
    var vat = Math.round(sub * VAT_RATE * 100) / 100;
    var po = dbInsert('purchase_orders', {
      po_number: nextDocNumber('PO'), project_id: body.project_id, supplier_id: body.supplier_id,
      mr_id: body.mr_id, order_date: body.order_date, delivery_date: body.delivery_date,
      currency: body.currency || 'EGP', subtotal: sub, vat: vat, total: sub + vat, status: 'Draft', notes: body.notes
    }, authCtx.user.email);
    var lines = insertLines_('po_lines', 'po_id', po.id, body.lines, authCtx.user.email, function (r) {
      r.qty = coerceNumber(r.qty); r.unit_price = coerceNumber(r.unit_price);
      r.line_total = Number(r.qty || 0) * Number(r.unit_price || 0);
    });
    return { header: po, lines: lines };
  }
};

/* ============================== WAREHOUSE ============================== */
var Warehouse = {
  createGRN: function (body, authCtx) {
    requireFields(body, ['project_id', 'received_date']);
    var grn = dbInsert('goods_received_notes', {
      grn_number: nextDocNumber('GRN'), project_id: body.project_id, po_id: body.po_id,
      supplier_id: body.supplier_id, received_date: body.received_date, received_by: authCtx.user.id,
      condition: body.condition || 'Good', photo_url: body.photo_url, notes: body.notes, status: 'Posted'
    }, authCtx.user.email);
    var lines = insertLines_('grn_lines', 'grn_id', grn.id, body.lines, authCtx.user.email, function (r) {
      r.qty_ordered = coerceNumber(r.qty_ordered); r.qty_received = coerceNumber(r.qty_received);
      r.qty_accepted = coerceNumber(r.qty_accepted);
    });
    // post accepted qty into stock
    lines.forEach(function (l) {
      if (l.item_code && Number(l.qty_accepted || 0) > 0) Warehouse._receiveStock(body.project_id, l, authCtx.user.email);
    });
    return { header: grn, lines: lines };
  },
  _receiveStock: function (projectId, line, actor) {
    var ex = dbList('stock_items', { project_id: projectId, item_code: line.item_code });
    if (ex.length) dbUpdate('stock_items', ex[0].id, { qty_on_hand: Number(ex[0].qty_on_hand || 0) + Number(line.qty_accepted || 0) }, actor);
    else dbInsert('stock_items', { project_id: projectId, item_code: line.item_code, description: line.description,
      unit: line.unit, qty_on_hand: Number(line.qty_accepted || 0), min_level: 0 }, actor);
  },
  createMIV: function (body, authCtx) {
    requireFields(body, ['project_id', 'issue_date', 'issued_to']);
    var miv = dbInsert('material_issues', {
      miv_number: nextDocNumber('MIV'), project_id: body.project_id, issue_date: body.issue_date,
      issued_to: body.issued_to, purpose: body.purpose, status: 'Issued'
    }, authCtx.user.email);
    var lines = insertLines_('miv_lines', 'miv_id', miv.id, body.lines, authCtx.user.email, function (r) { r.qty = coerceNumber(r.qty); });
    lines.forEach(function (l) {
      if (!l.item_code) return;
      var ex = dbList('stock_items', { project_id: body.project_id, item_code: l.item_code });
      if (ex.length) dbUpdate('stock_items', ex[0].id, { qty_on_hand: Number(ex[0].qty_on_hand || 0) - Number(l.qty || 0) }, authCtx.user.email);
    });
    return { header: miv, lines: lines };
  },
  upsertStock: function (body, authCtx) {
    requireFields(body, ['project_id', 'item_code', 'description']);
    body.qty_on_hand = coerceNumber(body.qty_on_hand); body.min_level = coerceNumber(body.min_level);
    var ex = dbList('stock_items', { project_id: body.project_id, item_code: body.item_code });
    return ex.length ? dbUpdate('stock_items', ex[0].id, body, authCtx.user.email) : dbInsert('stock_items', body, authCtx.user.email);
  },
  lowStock: function (projectId) {
    return (projectId ? dbList('stock_items', { project_id: projectId }) : dbList('stock_items'))
      .filter(function (r) { return Number(r.min_level || 0) > 0 && Number(r.qty_on_hand || 0) <= Number(r.min_level || 0); });
  }
};

/* =============================== FINANCE =============================== */
var Finance = {
  createPV: function (body, authCtx) {
    requireFields(body, ['project_id', 'amount', 'payment_method']);
    return dbInsert('payment_vouchers', {
      pv_number: nextDocNumber('PV'), project_id: body.project_id, supplier_id: body.supplier_id,
      payee: body.payee, payment_method: body.payment_method, amount: coerceNumber(body.amount),
      currency: body.currency || 'EGP', po_id: body.po_id, grn_id: body.grn_id, invoice_ref: body.invoice_ref,
      description: body.description, status: 'Draft'
    }, authCtx.user.email);
  },
  createRV: function (body, authCtx) {
    requireFields(body, ['project_id', 'amount']);
    return dbInsert('receipt_vouchers', {
      rv_number: nextDocNumber('RV'), project_id: body.project_id, client_id: body.client_id, payer: body.payer,
      amount: coerceNumber(body.amount), currency: body.currency || 'EGP', method: body.method || 'Bank Transfer',
      reference: body.reference, wht_amount: coerceNumber(body.wht_amount), retention_amount: coerceNumber(body.retention_amount),
      status: 'Recorded'
    }, authCtx.user.email);
  },
  createExpense: function (body, authCtx) {
    requireFields(body, ['project_id', 'expense_date', 'amount', 'category']);
    return dbInsert('expenses', {
      exp_number: nextDocNumber('EXP'), project_id: body.project_id, expense_date: body.expense_date,
      category: body.category, description: body.description, amount: coerceNumber(body.amount),
      currency: body.currency || 'EGP', payment_method: body.payment_method, vendor: body.vendor,
      receipt_url: body.receipt_url, status: 'Draft'
    }, authCtx.user.email);
  }
};

/* =========================== TECHNICAL OFFICE ========================== */
var TechOffice = {
  createCharter: function (body, authCtx) {
    requireFields(body, ['project_id']);
    return dbInsert('project_charters', {
      charter_number: nextDocNumber('CHTR'), project_id: body.project_id, objectives: body.objectives,
      scope: body.scope, pm_user: body.pm_user || authCtx.user.id, start_date: body.start_date, end_date: body.end_date,
      budget: coerceNumber(body.budget), currency: body.currency || 'EGP', status: 'Draft'
    }, authCtx.user.email);
  },
  createVOR: function (body, authCtx) {
    requireFields(body, ['project_id', 'title', 'amount']);
    return dbInsert('variation_orders', {
      vor_number: nextDocNumber('VOR'), project_id: body.project_id, title: body.title, description: body.description,
      type: body.type || 'Addition', amount: coerceNumber(body.amount), currency: body.currency || 'EGP',
      time_impact_days: coerceNumber(body.time_impact_days), status: 'Draft'
    }, authCtx.user.email);
  },
  createIPC: function (body, authCtx) {
    requireFields(body, ['project_id', 'gross_amount']);
    var gross = Number(body.gross_amount || 0), adv = Number(body.advance_recovery || 0), ret = Number(body.retention || 0);
    var net = gross - adv - ret;
    var vat = Math.round(net * VAT_RATE * 100) / 100;
    return dbInsert('interim_payment_certs', {
      ipc_number: nextDocNumber('IPC'), project_id: body.project_id, client_id: body.client_id, period: body.period,
      gross_amount: gross, advance_recovery: adv, retention: ret, vat: vat, net_amount: net + vat,
      currency: body.currency || 'EGP', status: 'Draft'
    }, authCtx.user.email);
  },
  createNCR: function (body, authCtx) {
    requireFields(body, ['project_id', 'category', 'description']);
    return dbInsert('ncrs', {
      ncr_number: nextDocNumber('NCR'), project_id: body.project_id, category: body.category,
      description: body.description, location: body.location, raised_by: authCtx.user.id, status: 'Open'
    }, authCtx.user.email);
  },
  /** Disposition an NCR — role authority depends on category (BLUEPRINT §3.5). */
  disposeNCR: function (id, disposition, rootCause, authCtx) {
    var ncr = dbGet('ncrs', id);
    if (!ncr) throw new AppError('NOT_FOUND', 'NCR not found.', 404);
    var need = { Minor: ['QAQC_ENGINEER', 'QAQC_MGR'], Major: ['QAQC_MGR', 'TPM_HEAD'], Critical: ['QAQC_MGR', 'CEO', 'COO'] }[ncr.category] || ['QAQC_MGR'];
    var codes = userRoleCodes(authCtx.roles);
    if (!need.some(function (r) { return codes.indexOf(r) !== -1; }))
      throw new AppError('FORBIDDEN', ncr.category + ' NCR disposition requires one of: ' + need.join(', '), 403);
    return dbUpdate('ncrs', id, { disposition: disposition, root_cause: rootCause, status: 'Dispositioned', closed_by: authCtx.user.id }, authCtx.user.email);
  }
};
