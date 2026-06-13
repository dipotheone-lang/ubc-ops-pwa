/**
 * AdminExt.gs — administration operations the v2 console needs beyond the
 * original create-only surface: user directory with roles, role revocation,
 * lookup management, permission removal, and audit browsing. All callers are
 * gated by RBAC in Code.gs (module 'admin'); these functions assume that check
 * has already passed and focus on the data work.
 */

/** Users with their active role codes attached — powers the admin Users grid. */
function adminListUsers() {
  var assignments = dbList('role_assignments').filter(function (r) { return String(r.active) !== 'FALSE'; });
  var byUser = {};
  assignments.forEach(function (r) {
    (byUser[r.user_id] = byUser[r.user_id] || []).push({ id: r.id, role_code: r.role_code, scope_type: r.scope_type, project_id: r.project_id || '' });
  });
  return dbList('users').map(function (u) {
    var pu = publicUser_(u);
    pu.roles = byUser[u.id] || [];
    return pu;
  });
}

/** Full detail for one user: profile + role assignments (with labels). */
function adminUserDetail(userId) {
  var u = dbGet('users', userId);
  if (!u) throw new AppError('NOT_FOUND', 'User not found.', 404);
  var roleLabels = {};
  dbList('roles').forEach(function (r) { roleLabels[r.code] = { en: r.name_en, ar: r.name_ar }; });
  var roles = dbList('role_assignments', { user_id: userId })
    .filter(function (r) { return String(r.active) !== 'FALSE'; })
    .map(function (r) {
      var l = roleLabels[r.role_code] || {};
      return { id: r.id, role_code: r.role_code, name_en: l.en || r.role_code, name_ar: l.ar || r.role_code,
        scope_type: r.scope_type, project_id: r.project_id || '' };
    });
  return { user: publicUser_(u), roles: roles };
}

/** Deactivate a role assignment (soft revoke — keeps the audit trail). */
function revokeRoleAssignment(assignmentId, actor) {
  var ra = dbGet('role_assignments', assignmentId);
  if (!ra) throw new AppError('NOT_FOUND', 'Role assignment not found.', 404);
  dbUpdate('role_assignments', assignmentId, { active: 'FALSE' }, actor || 'system');
  return { revoked: true, id: assignmentId };
}

/** Create or update a lookup row (dropdown catalog value). */
function upsertLookup(rec, actor) {
  rec = rec || {};
  requireFields(rec, ['category', 'code', 'label_en']);
  if (rec.id && dbGet('lookups', rec.id)) return dbUpdate('lookups', rec.id, rec, actor);
  if (rec.active === undefined) rec.active = 'TRUE';
  if (rec.sort === undefined) rec.sort = dbList('lookups', { category: rec.category }).length;
  return dbInsert('lookups', rec, actor);
}

/** Remove a permission row from the matrix. */
function deletePermissionRow(id) {
  if (!dbGet('permissions', id)) throw new AppError('NOT_FOUND', 'Permission not found.', 404);
  return dbDelete('permissions', id);
}

/** Recent audit-log entries, newest first (admin browser). */
function recentAudit(limit, filter) {
  var rows = dbList('audit_log', filter || null);
  rows.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
  return rows.slice(0, Number(limit || 50));
}
