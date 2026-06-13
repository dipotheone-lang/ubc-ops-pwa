/**
 * Dashboard.gs — server-side aggregation for the role-aware home dashboard.
 *
 * Returns only the KPIs/charts the caller is permitted to see (reuses the RBAC
 * `can()` check), plus the pending-approval queue, the caller's own open items,
 * and a recent-activity feed sourced from the audit log. One call replaces the
 * dozen list round-trips the PWA would otherwise make to render a home screen.
 */

/** Cross-module rollup for a single project (counts + key totals + links). */
function projectWorkspace(projectId) {
  var p = dbGet('projects', projectId);
  if (!p) throw new AppError('NOT_FOUND', 'Project not found.', 404);
  var ents = ['material_requisitions', 'purchase_orders', 'goods_received_notes', 'material_issues',
    'payment_vouchers', 'expenses', 'invoices', 'variation_orders', 'interim_payment_certs', 'ncrs',
    'daily_site_reports', 'site_instructions', 'hira', 'permits', 'incidents', 'hse_inspections'];
  var counts = [];
  ents.forEach(function (e) {
    try { var n = dbList(e, { project_id: projectId }).length; if (n) counts.push({ entity: e, module: ENTITY_MODULE[e], count: n }); } catch (x) {}
  });
  var sum = function (e, c) { return dbList(e, { project_id: projectId }).reduce(function (s, r) { return s + (Number(r[c]) || 0); }, 0); };
  return {
    project: p, counts: counts,
    po_value: Math.round(sum('purchase_orders', 'total')),
    expense_total: Math.round(sum('expenses', 'amount')),
    open_ncrs: dbList('ncrs', { project_id: projectId }).filter(function (n) { return String(n.status) !== 'Closed'; }).length
  };
}

function dashboardSummary(authCtx) {
  var canView = function (module, entity) { return can(authCtx, { module: module, entity: entity, action: 'view' }); };
  var sum = function (rows, col) { return rows.reduce(function (s, r) { return s + (Number(r[col]) || 0); }, 0); };
  var openOf = function (rows, closed) { return rows.filter(function (r) { return closed.indexOf(String(r.status)) === -1; }); };

  var kpis = [];   // { key, label_en, label_ar, value, unit, link, tone }
  var charts = {}; // key -> [{ label, value }]
  var add = function (k, en, ar, value, unit, link, tone) {
    kpis.push({ key: k, label_en: en, label_ar: ar, value: value, unit: unit || '', link: link || '', tone: tone || '' });
  };
  var groupCount = function (rows, col) {
    var m = {}; rows.forEach(function (r) { var k = String(r[col] || '—'); m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(function (k) { return { label: k, value: m[k] }; });
  };
  var groupSum = function (rows, col, valcol) {
    var m = {}; rows.forEach(function (r) { var k = String(r[col] || '—'); m[k] = (m[k] || 0) + (Number(r[valcol]) || 0); });
    return Object.keys(m).map(function (k) { return { label: k, value: Math.round(m[k]) }; });
  };

  /* ---- masters ---- */
  if (canView('masters', 'projects')) {
    var projects = dbList('projects');
    add('projects_active', 'Active projects', 'مشاريع نشطة',
      projects.filter(function (p) { return String(p.status) === 'Active'; }).length, '', 'projects', 'primary');
    charts.projects_status = groupCount(projects, 'status');
  }
  if (canView('masters', 'clients')) add('clients', 'Clients', 'العملاء', dbList('clients').length, '', 'clients');
  if (canView('masters', 'suppliers')) add('suppliers', 'Suppliers', 'الموردون', dbList('suppliers').length, '', 'suppliers');

  /* ---- procurement ---- */
  if (canView('procurement', 'material_requisitions')) {
    var mrs = dbList('material_requisitions');
    add('mr_open', 'Open requisitions', 'طلبات شراء مفتوحة', openOf(mrs, ['Closed', 'Rejected']).length, '', 'procurement', 'warn');
    charts.mr_status = groupCount(mrs, 'status');
  }
  if (canView('procurement', 'purchase_orders')) {
    var pos = dbList('purchase_orders');
    add('po_value', 'PO value', 'قيمة أوامر التوريد', Math.round(sum(pos, 'total')), CONFIG.BASE_CURRENCY, 'procurement');
  }

  /* ---- warehouse ---- */
  if (canView('warehouse', 'stock_items')) {
    var stock = dbList('stock_items');
    var low = stock.filter(function (s) { return Number(s.qty_on_hand) < Number(s.min_level || 0); });
    add('low_stock', 'Low-stock items', 'أصناف تحت الحد', low.length, '', 'warehouse', low.length ? 'danger' : 'ok');
  }

  /* ---- finance ---- */
  if (canView('finance', 'payment_vouchers')) {
    var pvs = dbList('payment_vouchers');
    add('pv_pending', 'Payments awaiting', 'مدفوعات معلقة',
      pvs.filter(function (p) { return String(p.status) === 'Submitted'; }).length, '', 'finance', 'warn');
  }
  if (canView('finance', 'expenses')) {
    var exps = dbList('expenses');
    add('expense_total', 'Expenses', 'المصروفات', Math.round(sum(exps, 'amount')), CONFIG.BASE_CURRENCY, 'finance');
    charts.expense_category = groupSum(exps, 'category', 'amount');
  }

  /* ---- technical office ---- */
  if (canView('techoffice', 'ncrs')) {
    var ncrs = dbList('ncrs');
    add('ncr_open', 'Open NCRs', 'تقارير عدم مطابقة',
      openOf(ncrs, ['Closed', 'Disposed']).length, '', 'techoffice', 'warn');
  }

  /* ---- business development ---- */
  if (canView('bd', 'opportunities')) {
    var opps = dbList('opportunities');
    var openOpps = opps.filter(function (o) { return String(o.status) === 'Open'; });
    add('pipeline', 'Pipeline value', 'قيمة الفرص', Math.round(sum(openOpps, 'estimated_value')), CONFIG.BASE_CURRENCY, 'bd', 'primary');
    charts.opp_stage = groupCount(openOpps, 'stage');
  }

  /* ---- tendering ---- */
  if (canView('tendering', 'tenders')) {
    var tenders = dbList('tenders');
    add('tenders_active', 'Active tenders', 'عطاءات نشطة',
      openOf(tenders, ['Awarded', 'Lost', 'Closed']).length, '', 'tendering');
  }

  /* ---- construction ---- */
  if (canView('construction', 'daily_site_reports')) {
    var dsrs = dbList('daily_site_reports');
    var avgP = dsrs.length ? Math.round(sum(dsrs, 'progress_pct') / dsrs.length) : 0;
    add('site_progress', 'Avg site progress', 'متوسط التقدم', avgP, '%', 'construction', 'primary');
    add('dsr_count', 'Daily reports', 'التقارير اليومية', dsrs.length, '', 'construction');
  }

  /* ---- HR ---- */
  if (canView('hr', 'employees')) {
    var emps = dbList('employees');
    add('headcount', 'Active headcount', 'العمالة النشطة',
      emps.filter(function (e) { return String(e.status) === 'Active'; }).length, '', 'hr', 'primary');
    charts.hr_dept = groupCount(emps, 'department');
  }
  if (canView('hr', 'leave_requests')) {
    var lv = dbList('leave_requests');
    add('leave_pending', 'Leave to approve', 'إجازات للاعتماد',
      lv.filter(function (l) { return String(l.status) === 'Submitted'; }).length, '', 'hr', 'warn');
  }

  /* ---- assets ---- */
  if (canView('assets', 'assets')) {
    var assets = dbList('assets');
    add('assets_count', 'Assets', 'الأصول', assets.length, '', 'assets');
    charts.asset_status = groupCount(assets, 'status');
    var cals = dbList('calibration_records');
    var dueCal = cals.filter(function (c) { return String(c.status) !== 'Valid'; }).length;
    if (dueCal) add('cal_due', 'Calibration due', 'معايرات مستحقة', dueCal, '', 'assets', 'danger');
  }

  /* ---- HSE ---- */
  if (canView('hse', 'incidents')) {
    var incs = dbList('incidents');
    add('incidents_open', 'Open incidents', 'حوادث مفتوحة',
      openOf(incs, ['Closed']).length, '', 'hse', incs.length ? 'warn' : 'ok');
    charts.incident_type = groupCount(incs, 'type');
  }
  if (canView('hse', 'permits')) {
    var permits = dbList('permits');
    add('permits_active', 'Active permits', 'تصاريح سارية',
      permits.filter(function (p) { return String(p.status) === 'Active' || String(p.status) === 'Approved'; }).length, '', 'hse');
  }

  /* ---- approvals & my work ---- */
  var pending = pendingApprovalsFor(authCtx);
  add('approvals_pending', 'Awaiting my approval', 'بانتظار اعتمادي', pending.length, '', 'approvals', pending.length ? 'danger' : 'ok');

  var myReqs = dbList('approval_requests', { initiator_user: authCtx.user.id, status: 'Pending' });
  add('my_pending', 'My pending requests', 'طلباتي المعلقة', myReqs.length, '', 'approvals');

  /* ---- recent activity (audit) ---- */
  var isAdmin = can(authCtx, { module: 'admin', entity: '*', action: 'view' });
  var log = dbList('audit_log');
  if (!isAdmin) log = log.filter(function (a) { return String(a.user_id) === String(authCtx.user.id); });
  log.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
  var recent = log.slice(0, 12).map(function (a) {
    return { ts: a.ts, action: a.action, module: a.module, entity: a.entity, user_email: a.user_email, amount: a.amount, note: a.note };
  });

  return {
    kpis: kpis,
    charts: charts,
    pending_approvals: pending.length,
    my_pending: myReqs.length,
    recent: recent,
    generated_at: nowIso()
  };
}
