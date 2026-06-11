/**
 * RBAC.gs — role/permission resolution and enforcement.
 *
 * A user has role_assignments (GLOBAL or PROJECT-scoped). Permissions are rows
 * (role_code, module, entity, action, scope) where module/entity may be '*'.
 * Access check: does any of the user's roles grant (module,entity,action) at a
 * scope the request satisfies?
 *   - GLOBAL  : always satisfies.
 *   - PROJECT : satisfied if the user has a PROJECT assignment for that project
 *               (or a GLOBAL assignment of the same role), and a project is given.
 *   - OWN     : satisfied if ownerUserId === user.id.
 */

/** Returns array of { role_code, scope_type, project_id } for active assignments. */
function getUserRoles(userId) {
  var rows = dbList('role_assignments', { user_id: userId });
  return rows.filter(function (r) { return String(r.active) !== 'FALSE'; })
    .map(function (r) { return { role_code: r.role_code, scope_type: r.scope_type, project_id: r.project_id || '' }; });
}

/** All distinct role codes a user holds. */
function userRoleCodes(roles) {
  var set = {}; roles.forEach(function (r) { set[r.role_code] = 1; }); return Object.keys(set);
}

/** Cache permission rows for the request lifetime (simple memo). */
var _permCache = null;
function allPermissions_() {
  if (_permCache) return _permCache;
  _permCache = dbList('permissions');
  return _permCache;
}

/**
 * Core check. ctx = { module, entity, action, projectId?, ownerUserId? }
 * Returns true/false.
 */
function can(authCtx, ctx) {
  var roles = authCtx.roles || [];
  var codes = userRoleCodes(roles);
  var perms = allPermissions_();

  for (var i = 0; i < perms.length; i++) {
    var p = perms[i];
    if (codes.indexOf(p.role_code) === -1) continue;
    if (p.module !== '*' && p.module !== ctx.module) continue;
    if (p.entity !== '*' && p.entity !== ctx.entity) continue;
    if (p.action !== ctx.action && !(p.action === 'admin')) continue; // 'admin' implies all actions
    // scope check
    if (p.scope === 'GLOBAL') return true;
    if (p.scope === 'OWN') {
      if (ctx.ownerUserId && String(ctx.ownerUserId) === String(authCtx.user.id)) return true;
      continue;
    }
    if (p.scope === 'PROJECT') {
      if (!ctx.projectId) continue;
      // user must hold this role GLOBAL, or PROJECT-scoped for this project
      for (var j = 0; j < roles.length; j++) {
        var ra = roles[j];
        if (ra.role_code !== p.role_code) continue;
        if (ra.scope_type === 'GLOBAL') return true;
        if (ra.scope_type === 'PROJECT' && String(ra.project_id) === String(ctx.projectId)) return true;
      }
    }
  }
  return false;
}

/** Enforce; throws 403 if denied. */
function requirePermission(authCtx, ctx) {
  if (!can(authCtx, ctx)) {
    throw new AppError('FORBIDDEN',
      'Not authorized: ' + ctx.action + ' on ' + ctx.module + '/' + ctx.entity +
      (ctx.projectId ? (' (project ' + ctx.projectId + ')') : ''), 403);
  }
  return true;
}

/** True if the user holds a given role (any scope). */
function hasRole(authCtx, roleCode) {
  return userRoleCodes(authCtx.roles || []).indexOf(roleCode) !== -1;
}

/** Assign a role to a user (admin op). */
function assignRole(userId, roleCode, scopeType, projectId, actor) {
  if (!dbFindBy('roles', 'code', roleCode)) throw new AppError('VALIDATION', 'Unknown role: ' + roleCode);
  if (!dbGet('users', userId)) throw new AppError('NOT_FOUND', 'User not found.', 404);
  // avoid duplicate
  var existing = dbList('role_assignments', { user_id: userId, role_code: roleCode, scope_type: scopeType, project_id: projectId || '' });
  if (existing.length) return existing[0];
  return dbInsert('role_assignments', {
    user_id: userId, role_code: roleCode, scope_type: scopeType || 'GLOBAL',
    project_id: projectId || '', active: 'TRUE'
  }, actor);
}
