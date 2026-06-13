/**
 * Notifications.gs — per-user in-app notification feed.
 *
 * A notification is a durable row addressed to one user. The approval engine,
 * admin actions and document workflow call notify_()/notifyRoles_() to push
 * signals ("approval needed", "your PV was approved", "your password was
 * reset"). The PWA polls notifications.unread + notifications.list to render a
 * bell with an unread badge. Like the audit log, notifications must NEVER break
 * the main operation, so every write is wrapped and swallowed on error.
 */

/** Insert one notification for a single user. opts = { type, title, body, link, entity, record_id, project_id }. */
function notify_(userId, opts) {
  try {
    if (!userId) return null;
    opts = opts || {};
    return dbInsert('notifications', {
      user_id: userId,
      type: opts.type || 'info',
      title: String(opts.title || '').slice(0, 200),
      body: String(opts.body || '').slice(0, 500),
      link: opts.link || '',
      entity: opts.entity || '',
      record_id: opts.record_id || '',
      project_id: opts.project_id || '',
      read: 'FALSE'
    }, 'system');
  } catch (e) {
    console.error('notify_ failed: ' + (e && e.message));
    return null;
  }
}

/** Distinct active user_ids holding ANY of the given role codes. */
function usersByRoles_(roleCodes) {
  var want = {}; (roleCodes || []).forEach(function (c) { want[c] = 1; });
  var seen = {}, out = [];
  dbList('role_assignments').forEach(function (ra) {
    if (String(ra.active) === 'FALSE') return;
    if (!want[ra.role_code]) return;
    if (seen[ra.user_id]) return;
    seen[ra.user_id] = 1; out.push(ra.user_id);
  });
  return out;
}

/** Fan a notification out to every user holding one of roleCodes (minus excludeUserId). */
function notifyRoles_(roleCodes, opts, excludeUserId) {
  try {
    var ids = usersByRoles_(roleCodes);
    for (var i = 0; i < ids.length; i++) {
      if (excludeUserId && String(ids[i]) === String(excludeUserId)) continue;
      notify_(ids[i], opts);
    }
  } catch (e) { console.error('notifyRoles_ failed: ' + (e && e.message)); }
}

/** List a user's notifications, newest first. opts = { unreadOnly, limit }. */
function listNotifications(userId, opts) {
  opts = opts || {};
  var rows = dbList('notifications', { user_id: userId });
  if (opts.unreadOnly) rows = rows.filter(function (n) { return !truthy(n.read); });
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var limit = Number(opts.limit || 30);
  return rows.slice(0, limit);
}

/** Count a user's unread notifications. */
function unreadCount(userId) {
  return dbList('notifications', { user_id: userId }).filter(function (n) { return !truthy(n.read); }).length;
}

/** Mark a single notification read (only if it belongs to the user). */
function markNotificationRead(userId, id) {
  var n = dbGet('notifications', id);
  if (!n || String(n.user_id) !== String(userId)) throw new AppError('NOT_FOUND', 'Notification not found.', 404);
  if (!truthy(n.read)) dbUpdate('notifications', id, { read: 'TRUE' }, 'system');
  return { id: id, read: true };
}

/** Mark all of a user's notifications read. Returns the number cleared. */
function markAllNotificationsRead(userId) {
  var rows = dbList('notifications', { user_id: userId }).filter(function (n) { return !truthy(n.read); });
  for (var i = 0; i < rows.length; i++) dbUpdate('notifications', rows[i].id, { read: 'TRUE' }, 'system');
  return { cleared: rows.length };
}
