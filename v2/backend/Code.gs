/**
 * Code.gs — v2 HTTP entry points. Session-token auth + RBAC on every action.
 *
 *   GET  ?action=ping|version            (public health)
 *   POST { action, token?, ... }         (everything; token required except login/ping)
 *
 * Response envelope: { ok, ts, data | error }.
 */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {}, action = p.action || 'ping';
    if (action === 'ping' || action === 'version')
      return ok({ service: 'UBC Operations API v2', version: '2.0.0-phase1', time: nowIso() });
    throw new AppError('USE_POST', 'Use POST for ' + action + '.');
  } catch (err) { return fail(err); }
}

function doPost(e) {
  try {
    _permCache = null; // reset per-request memo
    var body = parseBody(e);
    var action = body.action;
    if (!action) throw new AppError('VALIDATION', 'Missing "action".');
    var ctx = { ip: (e && e.parameter && e.parameter.ip) || '', agent: '' };

    // public actions
    if (action === 'ping') return ok({ pong: true, time: nowIso() });
    if (action === 'auth.login') {
      requireFields(body, ['email', 'password']);
      return ok(login(body.email, body.password, ctx));
    }
    // One-time bootstrap: set an initial password for a seeded user, then
    // self-locks (Script Property SETUP_CLAIMED). Used immediately post-deploy
    // so the first admin can sign in without reading the editor log.
    if (action === 'setup.claim') return ok(setupClaim_(body));

    // everything else requires a valid session
    var auth = authenticate(body.token);
    var authCtx = { user: auth.user, roles: auth.roles };
    return ok(dispatch_(action, body, authCtx));
  } catch (err) { return fail(err); }
}

/** entity → module map for RBAC of generic reads + writes. */
var ENTITY_MODULE = {
  projects: 'masters', clients: 'masters', suppliers: 'masters',
  material_requisitions: 'procurement', mr_lines: 'procurement', purchase_orders: 'procurement', po_lines: 'procurement',
  goods_received_notes: 'warehouse', grn_lines: 'warehouse', stock_items: 'warehouse', material_issues: 'warehouse', miv_lines: 'warehouse',
  payment_vouchers: 'finance', receipt_vouchers: 'finance', expenses: 'finance',
  project_charters: 'techoffice', variation_orders: 'techoffice', interim_payment_certs: 'techoffice', ncrs: 'techoffice',
  opportunities: 'bd', interactions: 'bd',
  tenders: 'tendering', tender_costlines: 'tendering',
  daily_site_reports: 'construction', site_instructions: 'construction',
  correspondence: 'correspondence', prequalifications: 'prequal',
  employees: 'hr', leave_requests: 'hr', timesheets: 'hr', appraisals: 'hr',
  assets: 'assets', maintenance_records: 'assets', calibration_records: 'assets',
  hira: 'hse', permits: 'hse', incidents: 'hse', hse_inspections: 'hse',
  approval_requests: 'approvals', approval_steps: 'approvals'
};
function moduleOf_(entity) { return ENTITY_MODULE[entity] || 'admin'; }

function dispatch_(action, body, authCtx) {
  var actor = authCtx.user.email;

  switch (action) {
    /* ---- auth / self ---- */
    case 'auth.me':
      return { user: publicUser_(authCtx.user), roles: authCtx.roles };
    case 'auth.logout':
      return logout(body.token);
    case 'auth.changePassword':
      requireFields(body, ['oldPassword', 'newPassword']);
      return changePassword(authCtx.user, body.oldPassword, body.newPassword);

    /* ---- bootstrap for the UI: who am I + what can I see ---- */
    case 'bootstrap':
      return bootstrap_(authCtx);

    /* ---- generic reads (RBAC: view) ---- */
    case 'list': {
      requireFields(body, ['entity']);
      requirePermission(authCtx, { module: moduleOf_(body.entity), entity: body.entity, action: 'view',
        projectId: body.filter && body.filter.id });
      var rows = dbList(body.entity, body.filter || null);
      return body.entity === 'users' ? rows.map(publicUser_) : rows;
    }
    case 'get': {
      requireFields(body, ['entity', 'id']);
      requirePermission(authCtx, { module: moduleOf_(body.entity), entity: body.entity, action: 'view', projectId: body.id });
      var row = dbGet(body.entity, body.id);
      return body.entity === 'users' ? publicUser_(row) : row;
    }

    /* ---- masters ---- */
    case 'masters.client.create':
      requirePermission(authCtx, { module: 'masters', entity: 'clients', action: 'create' });
      return logged_(authCtx, 'create', 'masters', 'clients', createClient(body.record || body, actor));
    case 'masters.supplier.create':
      requirePermission(authCtx, { module: 'masters', entity: 'suppliers', action: 'create' });
      return logged_(authCtx, 'create', 'masters', 'suppliers', createSupplier(body.record || body, actor));
    case 'masters.project.create':
      requirePermission(authCtx, { module: 'masters', entity: 'projects', action: 'create' });
      return logged_(authCtx, 'create', 'masters', 'projects', createProject(body.record || body, actor));
    case 'masters.update': {
      requireFields(body, ['entity', 'id', 'patch']);
      if (['clients', 'suppliers', 'projects'].indexOf(body.entity) === -1) throw new AppError('VALIDATION', 'Not a master entity.');
      requirePermission(authCtx, { module: 'masters', entity: body.entity, action: 'edit', projectId: body.entity === 'projects' ? body.id : null });
      return logged_(authCtx, 'edit', 'masters', body.entity, dbUpdate(body.entity, body.id, body.patch, actor));
    }

    /* ---- admin: users & access ---- */
    case 'admin.user.create': {
      requirePermission(authCtx, { module: 'admin', entity: 'users', action: 'create' });
      var rec = body.record || body;
      requireFields(rec, ['email', 'full_name_en']);
      rec.email = String(rec.email).toLowerCase().trim();
      if (dbFindBy('users', 'email', rec.email)) throw new AppError('DUPLICATE', 'Email already exists.');
      rec.active = rec.active || 'TRUE'; rec.default_lang = rec.default_lang || 'ar'; rec.must_reset = 'TRUE';
      var u = dbInsert('users', rec, actor);
      var temp = randomToken().slice(0, 8) + 'A1';
      setUserPassword(u.id, temp, { actor: actor, mustReset: true });
      if (rec.role_code) assignRole(u.id, rec.role_code, rec.scope_type || 'GLOBAL', rec.project_id || '', actor);
      return logged_(authCtx, 'create', 'admin', 'users', { user: publicUser_(u), temporary_password: temp });
    }
    case 'admin.user.update':
      requirePermission(authCtx, { module: 'admin', entity: 'users', action: 'edit' });
      requireFields(body, ['id', 'patch']);
      return logged_(authCtx, 'edit', 'admin', 'users', publicUser_(dbUpdate('users', body.id, body.patch, actor)));
    case 'admin.user.resetPassword':
      requirePermission(authCtx, { module: 'admin', entity: 'users', action: 'admin' });
      requireFields(body, ['id']);
      return logged_(authCtx, 'reset_password', 'admin', 'users', adminResetPassword(actor, body.id));
    case 'admin.assignRole':
      requirePermission(authCtx, { module: 'admin', entity: 'role_assignments', action: 'admin' });
      requireFields(body, ['user_id', 'role_code']);
      return logged_(authCtx, 'assign_role', 'admin', 'role_assignments',
        assignRole(body.user_id, body.role_code, body.scope_type, body.project_id, actor));
    case 'admin.permission.create':
      requirePermission(authCtx, { module: 'admin', entity: 'permissions', action: 'admin' });
      return logged_(authCtx, 'create', 'admin', 'permissions', dbInsert('permissions', body.record || body, actor));
    case 'admin.reseed':
      requirePermission(authCtx, { module: 'admin', entity: '*', action: 'admin' });
      return logged_(authCtx, 'reseed', 'admin', 'setup', initializeWorkbook());
    case 'admin.doa.upsert': {
      requirePermission(authCtx, { module: 'admin', entity: 'doa_bands', action: 'admin' });
      var d = body.record || body;
      if (d.signer_chain && !d.signer_chain_json) d.signer_chain_json = JSON.stringify(d.signer_chain);
      var saved = d.id && dbGet('doa_bands', d.id) ? dbUpdate('doa_bands', d.id, d, actor) : dbInsert('doa_bands', d, actor);
      return logged_(authCtx, 'upsert', 'admin', 'doa_bands', saved);
    }

    /* ---- approvals ---- */
    case 'approvals.create':
      // any authenticated user may initiate; the band decides who signs
      return createApprovalRequest({
        domain: body.domain, action: body.actionType, entity: body.entity, record_id: body.record_id,
        project_id: body.project_id, amount: body.amount, currency: body.currency,
        initiator_user: authCtx.user.id
      }, actor);
    case 'approvals.decide':
      requireFields(body, ['request_id', 'decision']);
      return decideApproval(body.request_id, authCtx, body.decision, body.comment);
    case 'approvals.pending':
      return pendingApprovalsFor(authCtx);
    case 'approvals.get':
      requireFields(body, ['request_id']);
      return { request: dbGet('approval_requests', body.request_id), steps: dbList('approval_steps', { request_id: body.request_id }) };

    /* ====================== PHASE 2: value chain ====================== */
    case 'doc.submit': {
      requireFields(body, ['entity', 'id']);
      requirePermission(authCtx, { module: moduleOf_(body.entity), entity: body.entity, action: 'submit', projectId: body.project_id });
      return submitDocument(body.entity, body.id, authCtx);
    }

    // Procurement
    case 'procurement.mr.create':
      requirePermission(authCtx, { module: 'procurement', entity: 'material_requisitions', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'procurement', 'material_requisitions', Procurement.createMR(body.record || body, authCtx));
    case 'procurement.po.create':
      requirePermission(authCtx, { module: 'procurement', entity: 'purchase_orders', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'procurement', 'purchase_orders', Procurement.createPO(body.record || body, authCtx));

    // Warehouse
    case 'wh.grn.create':
      requirePermission(authCtx, { module: 'warehouse', entity: 'goods_received_notes', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'warehouse', 'goods_received_notes', Warehouse.createGRN(body.record || body, authCtx));
    case 'wh.miv.create':
      requirePermission(authCtx, { module: 'warehouse', entity: 'material_issues', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'warehouse', 'material_issues', Warehouse.createMIV(body.record || body, authCtx));
    case 'wh.stock.upsert':
      requirePermission(authCtx, { module: 'warehouse', entity: 'stock_items', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'upsert', 'warehouse', 'stock_items', Warehouse.upsertStock(body.record || body, authCtx));
    case 'wh.lowstock':
      requirePermission(authCtx, { module: 'warehouse', entity: 'stock_items', action: 'view', projectId: body.project_id });
      return Warehouse.lowStock(body.project_id || null);

    // Finance
    case 'fin.pv.create':
      requirePermission(authCtx, { module: 'finance', entity: 'payment_vouchers', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'finance', 'payment_vouchers', Finance.createPV(body.record || body, authCtx));
    case 'fin.rv.create':
      requirePermission(authCtx, { module: 'finance', entity: 'receipt_vouchers', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'finance', 'receipt_vouchers', Finance.createRV(body.record || body, authCtx));
    case 'fin.expense.create':
      requirePermission(authCtx, { module: 'finance', entity: 'expenses', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'finance', 'expenses', Finance.createExpense(body.record || body, authCtx));

    // Technical Office
    case 'tech.charter.create':
      requirePermission(authCtx, { module: 'techoffice', entity: 'project_charters', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'techoffice', 'project_charters', TechOffice.createCharter(body.record || body, authCtx));
    case 'tech.vor.create':
      requirePermission(authCtx, { module: 'techoffice', entity: 'variation_orders', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'techoffice', 'variation_orders', TechOffice.createVOR(body.record || body, authCtx));
    case 'tech.ipc.create':
      requirePermission(authCtx, { module: 'techoffice', entity: 'interim_payment_certs', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'techoffice', 'interim_payment_certs', TechOffice.createIPC(body.record || body, authCtx));
    case 'tech.ncr.create':
      requirePermission(authCtx, { module: 'techoffice', entity: 'ncrs', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'techoffice', 'ncrs', TechOffice.createNCR(body.record || body, authCtx));
    case 'tech.ncr.dispose':
      requireFields(body, ['id', 'disposition']);
      return logged_(authCtx, 'dispose', 'techoffice', 'ncrs', TechOffice.disposeNCR(body.id, body.disposition, body.root_cause, authCtx));

    /* ====================== PHASE 3: commercial & site ====================== */
    // Business Development
    case 'bd.opp.create':
      requirePermission(authCtx, { module: 'bd', entity: 'opportunities', action: 'create' });
      return logged_(authCtx, 'create', 'bd', 'opportunities', BD.createOpportunity(body.record || body, authCtx));
    case 'bd.opp.advance':
      requireFields(body, ['id', 'stage']);
      requirePermission(authCtx, { module: 'bd', entity: 'opportunities', action: 'edit' });
      return logged_(authCtx, 'advance', 'bd', 'opportunities', BD.advanceOpportunity(body.id, body.stage, authCtx));
    case 'bd.interaction.create':
      requirePermission(authCtx, { module: 'bd', entity: 'interactions', action: 'create' });
      return logged_(authCtx, 'create', 'bd', 'interactions', BD.logInteraction(body.record || body, authCtx));

    // Tendering
    case 'pts.tender.create':
      requirePermission(authCtx, { module: 'tendering', entity: 'tenders', action: 'create' });
      return logged_(authCtx, 'create', 'tendering', 'tenders', Tendering.createTender(body.record || body, authCtx));
    case 'pts.tender.award':
      requireFields(body, ['id', 'outcome']);
      requirePermission(authCtx, { module: 'tendering', entity: 'tenders', action: 'edit' });
      return logged_(authCtx, 'award', 'tendering', 'tenders', Tendering.award(body.id, body.outcome, authCtx));

    // Construction
    case 'con.dsr.create':
      requirePermission(authCtx, { module: 'construction', entity: 'daily_site_reports', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'construction', 'daily_site_reports', Construction.createDailyReport(body.record || body, authCtx));
    case 'con.si.create':
      requirePermission(authCtx, { module: 'construction', entity: 'site_instructions', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'construction', 'site_instructions', Construction.createSiteInstruction(body.record || body, authCtx));

    // Correspondence
    case 'corr.create':
      requirePermission(authCtx, { module: 'correspondence', entity: 'correspondence', action: 'create' });
      return logged_(authCtx, 'create', 'correspondence', 'correspondence', Correspondence.create(body.record || body, authCtx));
    case 'corr.issue':
      requireFields(body, ['id']);
      requirePermission(authCtx, { module: 'correspondence', entity: 'correspondence', action: 'create' });
      return logged_(authCtx, 'issue', 'correspondence', 'correspondence', Correspondence.issue(body.id, authCtx));

    // Prequalification
    case 'prequal.create':
      requirePermission(authCtx, { module: 'prequal', entity: 'prequalifications', action: 'create' });
      return logged_(authCtx, 'create', 'prequal', 'prequalifications', Prequal.create(body.record || body, authCtx));

    /* ====================== PHASE 4: HR / Assets / HSE ====================== */
    // HR
    case 'hr.employee.create':
      requirePermission(authCtx, { module: 'hr', entity: 'employees', action: 'create' });
      return logged_(authCtx, 'create', 'hr', 'employees', HR.createEmployee(body.record || body, authCtx));
    case 'hr.leave.create':
      requirePermission(authCtx, { module: 'hr', entity: 'leave_requests', action: 'create' });
      return logged_(authCtx, 'create', 'hr', 'leave_requests', HR.createLeave(body.record || body, authCtx));
    case 'hr.timesheet.create':
      requirePermission(authCtx, { module: 'hr', entity: 'timesheets', action: 'create' });
      return logged_(authCtx, 'create', 'hr', 'timesheets', HR.createTimesheet(body.record || body, authCtx));
    case 'hr.appraisal.create':
      requirePermission(authCtx, { module: 'hr', entity: 'appraisals', action: 'create' });
      return logged_(authCtx, 'create', 'hr', 'appraisals', HR.createAppraisal(body.record || body, authCtx));

    // Asset & Equipment
    case 'asset.create':
      requirePermission(authCtx, { module: 'assets', entity: 'assets', action: 'create' });
      return logged_(authCtx, 'create', 'assets', 'assets', Assets.createAsset(body.record || body, authCtx));
    case 'asset.maintenance.create':
      requirePermission(authCtx, { module: 'assets', entity: 'maintenance_records', action: 'create' });
      return logged_(authCtx, 'create', 'assets', 'maintenance_records', Assets.logMaintenance(body.record || body, authCtx));
    case 'asset.calibration.create':
      requirePermission(authCtx, { module: 'assets', entity: 'calibration_records', action: 'create' });
      return logged_(authCtx, 'create', 'assets', 'calibration_records', Assets.logCalibration(body.record || body, authCtx));

    // HSE
    case 'hse.hira.create':
      requirePermission(authCtx, { module: 'hse', entity: 'hira', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'hse', 'hira', HSE.createHIRA(body.record || body, authCtx));
    case 'hse.permit.create':
      requirePermission(authCtx, { module: 'hse', entity: 'permits', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'hse', 'permits', HSE.createPermit(body.record || body, authCtx));
    case 'hse.incident.create':
      requirePermission(authCtx, { module: 'hse', entity: 'incidents', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'hse', 'incidents', HSE.reportIncident(body.record || body, authCtx));
    case 'hse.incident.investigate':
      requireFields(body, ['id']);
      requirePermission(authCtx, { module: 'hse', entity: 'incidents', action: 'edit' });
      return logged_(authCtx, 'investigate', 'hse', 'incidents', HSE.investigateIncident(body.id, body.root_cause, body.corrective_action, authCtx));
    case 'hse.inspection.create':
      requirePermission(authCtx, { module: 'hse', entity: 'hse_inspections', action: 'create', projectId: (body.record || body).project_id });
      return logged_(authCtx, 'create', 'hse', 'hse_inspections', HSE.createInspection(body.record || body, authCtx));

    /* ---- dashboard (any authenticated user; results are permission-scoped) ---- */
    case 'dashboard.summary':
      return dashboardSummary(authCtx);

    /* ---- notifications (self only) ---- */
    case 'notifications.list':
      return listNotifications(authCtx.user.id, { unreadOnly: !!body.unreadOnly, limit: body.limit });
    case 'notifications.unread':
      return { count: unreadCount(authCtx.user.id) };
    case 'notifications.markRead':
      requireFields(body, ['id']);
      return markNotificationRead(authCtx.user.id, body.id);
    case 'notifications.markAllRead':
      return markAllNotificationsRead(authCtx.user.id);

    /* ---- admin: directory, roles, lookups, audit ---- */
    case 'admin.users':
      requirePermission(authCtx, { module: 'admin', entity: 'users', action: 'view' });
      return adminListUsers();
    case 'admin.user.detail':
      requirePermission(authCtx, { module: 'admin', entity: 'users', action: 'view' });
      requireFields(body, ['id']);
      return adminUserDetail(body.id);
    case 'admin.role.revoke':
      requirePermission(authCtx, { module: 'admin', entity: 'role_assignments', action: 'admin' });
      requireFields(body, ['assignment_id']);
      return logged_(authCtx, 'revoke_role', 'admin', 'role_assignments', revokeRoleAssignment(body.assignment_id, actor));
    case 'admin.lookup.upsert':
      requirePermission(authCtx, { module: 'admin', entity: 'lookups', action: 'admin' });
      return logged_(authCtx, 'upsert', 'admin', 'lookups', upsertLookup(body.record || body, actor));
    case 'admin.permission.delete':
      requirePermission(authCtx, { module: 'admin', entity: 'permissions', action: 'admin' });
      requireFields(body, ['id']);
      return logged_(authCtx, 'delete', 'admin', 'permissions', deletePermissionRow(body.id));
    case 'admin.audit.recent':
      requirePermission(authCtx, { module: 'admin', entity: '*', action: 'view' });
      return recentAudit(body.limit, body.filter);

    default:
      throw new AppError('UNKNOWN_ACTION', 'Unknown action: ' + action);
  }
}

/** Wrap a write result with an audit-log entry. */
function logged_(authCtx, act, module, entity, result) {
  var rid = result && (result.id || (result.user && result.user.id)) || '';
  audit({ user_id: authCtx.user.id, user_email: authCtx.user.email, action: act, module: module, entity: entity, record_id: rid });
  return result;
}

/** Everything the UI needs to render for this user. */
function bootstrap_(authCtx) {
  var codes = userRoleCodes(authCtx.roles);
  var perms = allPermissions_().filter(function (p) { return codes.indexOf(p.role_code) !== -1; })
    .map(function (p) { return { module: p.module, entity: p.entity, action: p.action, scope: p.scope }; });
  return {
    user: publicUser_(authCtx.user),
    roles: authCtx.roles,
    permissions: perms,
    lookups: dbList('lookups').filter(function (l) { return String(l.active) !== 'FALSE'; }),
    company: CONFIG.COMPANY,
    pending_approvals: pendingApprovalsFor(authCtx).length
  };
}
