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

    // everything else requires a valid session
    var auth = authenticate(body.token);
    var authCtx = { user: auth.user, roles: auth.roles };
    return ok(dispatch_(action, body, authCtx));
  } catch (err) { return fail(err); }
}

/** entity → module map for RBAC of generic reads. */
function moduleOf_(entity) {
  if (entity === 'projects' || entity === 'clients' || entity === 'suppliers') return 'masters';
  if (entity === 'users' || entity === 'roles' || entity === 'permissions' ||
      entity === 'role_assignments' || entity === 'doa_bands' || entity === 'lookups' ||
      entity === 'sessions' || entity === 'audit_log') return 'admin';
  if (entity === 'approval_requests' || entity === 'approval_steps') return 'approvals';
  return 'admin';
}

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
