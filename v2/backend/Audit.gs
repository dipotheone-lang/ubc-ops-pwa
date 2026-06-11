/**
 * Audit.gs — append-only audit trail. Never updated or deleted via the API.
 */
function audit(entry) {
  // entry: { user_id, user_email, action, module, entity, record_id, project_id, amount, before, after, ip, note }
  try {
    var rec = {
      id: uuid(), ts: nowIso(),
      user_id: entry.user_id || '', user_email: entry.user_email || '',
      action: entry.action || '', module: entry.module || '', entity: entry.entity || '',
      record_id: entry.record_id || '', project_id: entry.project_id || '',
      amount: (entry.amount === undefined || entry.amount === null) ? '' : entry.amount,
      before_json: entry.before ? JSON.stringify(entry.before).slice(0, 40000) : '',
      after_json: entry.after ? JSON.stringify(entry.after).slice(0, 40000) : '',
      ip: entry.ip || '', note: entry.note || ''
    };
    // Direct append (no FK/audit-column processing) to keep the log immutable & fast.
    var sheet = getSheet_('audit_log'), h = headers_(sheet);
    sheet.appendRow(objToRow_(h, rec));
    return rec.id;
  } catch (e) {
    // Auditing must never break the main operation; swallow but log to Stackdriver.
    console.error('audit failed: ' + (e && e.message));
    return null;
  }
}
