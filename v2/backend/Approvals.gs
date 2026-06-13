/**
 * Approvals.gs — generic Delegation-of-Authority approval engine.
 *
 * Given (domain, action, amount), resolveBand() finds the matching DoABands row
 * and createApprovalRequest() instantiates an ordered chain of steps from its
 * signer_chain_json. Each step is one chain position with a mode:
 *   all   → every distinct role in the step must approve
 *   any   → one approval suffices
 *   count → N approvals among the listed roles (distinct users)
 * Steps run sequentially; the next activates when the current is satisfied.
 * Segregation of duties: the initiator may never approve their own request.
 */

/** Find the DoA band for a domain/action covering `amount`. */
function resolveBand(domain, action, amount) {
  var amt = Number(amount || 0);
  var rows = dbList('doa_bands').filter(function (b) {
    return String(b.active) !== 'FALSE' && b.domain === domain &&
      (!action || !b.action || b.action === action);
  });
  for (var i = 0; i < rows.length; i++) {
    var b = rows[i];
    var min = Number(b.min_amount || 0);
    var max = (b.max_amount === '' || b.max_amount === null || b.max_amount === undefined) ? Infinity : Number(b.max_amount);
    if (amt >= min && amt <= max) return b;
  }
  return null;
}

/**
 * Create an approval request + its steps.
 * spec = { domain, action, entity, record_id, project_id, amount, currency, initiator_user }
 * Returns { request, steps }.
 */
function createApprovalRequest(spec, actor) {
  requireFields(spec, ['domain', 'entity', 'record_id', 'initiator_user']);
  var band = resolveBand(spec.domain, spec.action, spec.amount);
  if (!band) throw new AppError('NO_DOA_BAND', 'No authority band for ' + spec.domain + ' amount ' + spec.amount, 422);

  var chain;
  try { chain = JSON.parse(band.signer_chain_json); } catch (e) { throw new AppError('BAD_DOA', 'Corrupt signer chain in band ' + band.id, 500); }
  if (!chain.length) throw new AppError('BAD_DOA', 'Empty signer chain in band ' + band.id, 500);

  var req = dbInsert('approval_requests', {
    domain: spec.domain, entity: spec.entity, record_id: spec.record_id,
    project_id: spec.project_id || '', amount: coerceNumber(spec.amount), currency: spec.currency || CONFIG.BASE_CURRENCY,
    initiator_user: spec.initiator_user, band_id: band.id, status: 'Pending',
    current_step: 1, total_steps: chain.length, created_at: nowIso(), updated_at: nowIso()
  }, actor);

  var steps = [];
  for (var i = 0; i < chain.length; i++) {
    var st = chain[i];
    var roles = st.roles || [];
    var required = st.mode === 'any' ? 1 : (st.mode === 'count' ? (st.count || 1) : roles.length);
    steps.push(dbInsert('approval_steps', {
      request_id: req.id, step_no: i + 1, mode: st.mode || 'all', required_count: required,
      roles_json: JSON.stringify(roles), status: i === 0 ? 'Active' : 'Pending',
      approvals_json: '[]', decision_at: '', comment: ''
    }, actor));
  }
  audit({ user_id: spec.initiator_user, action: 'approval_created', module: 'approvals',
    entity: spec.entity, record_id: spec.record_id, project_id: spec.project_id, amount: spec.amount,
    note: spec.domain + ' band:' + band.id });
  // Notify the first step's approvers (never the initiator — SoD).
  notifyRoles_(chain[0].roles || [], {
    type: 'approval', title: 'Approval needed',
    body: spec.domain + ' • ' + (coerceNumber(spec.amount) || 0) + ' ' + (spec.currency || CONFIG.BASE_CURRENCY),
    link: 'approvals', entity: spec.entity, record_id: spec.record_id, project_id: spec.project_id
  }, spec.initiator_user);
  return { request: req, steps: steps };
}

/** The active step of a request, or null. */
function activeStep_(requestId) {
  var steps = dbList('approval_steps', { request_id: requestId });
  for (var i = 0; i < steps.length; i++) if (String(steps[i].status) === 'Active') return steps[i];
  return null;
}

/**
 * Record a decision on a request's active step.
 * authCtx = { user, roles }. decision = 'approve' | 'reject'.
 * Enforces: approver holds a role the step requires; SoD (not the initiator);
 * no double-approval by the same user.
 */
function decideApproval(requestId, authCtx, decision, comment) {
  return withLock_(function () {
    var req = dbGet('approval_requests', requestId);
    if (!req) throw new AppError('NOT_FOUND', 'Approval request not found.', 404);
    if (req.status !== 'Pending') throw new AppError('CLOSED', 'Request already ' + req.status + '.', 409);
    var step = activeStep_(requestId);
    if (!step) throw new AppError('NO_ACTIVE_STEP', 'No active step.', 409);

    // Segregation of duties
    if (String(req.initiator_user) === String(authCtx.user.id))
      throw new AppError('SOD_VIOLATION', 'You cannot approve a request you initiated.', 403);

    var roles = JSON.parse(step.roles_json || '[]');
    var myCodes = userRoleCodes(authCtx.roles || []);
    var matched = roles.filter(function (r) { return myCodes.indexOf(r) !== -1; });
    if (!matched.length)
      throw new AppError('FORBIDDEN', 'Your role is not authorized for this step (needs one of: ' + roles.join(', ') + ').', 403);

    var approvals = JSON.parse(step.approvals_json || '[]');
    if (approvals.some(function (a) { return String(a.user) === String(authCtx.user.id); }))
      throw new AppError('ALREADY_DECIDED', 'You have already decided on this step.', 409);

    if (decision === 'reject') {
      dbUpdate('approval_steps', step.id, { status: 'Rejected', decision_at: nowIso(),
        approvals_json: JSON.stringify(approvals.concat([{ user: authCtx.user.id, role: matched[0], decision: 'reject', at: nowIso() }])),
        comment: comment || '' }, authCtx.user.email);
      dbUpdate('approval_requests', requestId, { status: 'Rejected', updated_at: nowIso(), closed_at: nowIso() }, authCtx.user.email);
      applyApprovalOutcome_(req, 'Rejected');
      audit({ user_id: authCtx.user.id, user_email: authCtx.user.email, action: 'approval_rejected', module: 'approvals',
        entity: req.entity, record_id: req.record_id, project_id: req.project_id, amount: req.amount, note: comment });
      notify_(req.initiator_user, {
        type: 'rejected', title: 'Request rejected',
        body: req.entity + ' • ' + (req.amount || 0) + ' ' + (req.currency || '') + (comment ? (' — ' + comment) : ''),
        link: 'approvals', entity: req.entity, record_id: req.record_id, project_id: req.project_id });
      return finalizeAndReturn_(requestId);
    }

    // approve
    approvals = approvals.concat([{ user: authCtx.user.id, role: matched[0], decision: 'approve', at: nowIso() }]);
    // distinct-role approvals for 'all'; distinct-user count otherwise
    var satisfied;
    if (step.mode === 'all') {
      var rolesApproved = {};
      approvals.forEach(function (a) { if (a.decision === 'approve') rolesApproved[a.role] = 1; });
      satisfied = roles.every(function (r) { return rolesApproved[r]; });
    } else {
      var nApprove = approvals.filter(function (a) { return a.decision === 'approve'; }).length;
      satisfied = nApprove >= Number(step.required_count);
    }

    dbUpdate('approval_steps', step.id, {
      approvals_json: JSON.stringify(approvals),
      status: satisfied ? 'Approved' : 'Active',
      decision_at: satisfied ? nowIso() : '', comment: comment || step.comment
    }, authCtx.user.email);
    audit({ user_id: authCtx.user.id, user_email: authCtx.user.email, action: 'approval_signed', module: 'approvals',
      entity: req.entity, record_id: req.record_id, project_id: req.project_id, amount: req.amount,
      note: 'step ' + step.step_no + (satisfied ? ' satisfied' : ' partial') });

    if (satisfied) {
      var next = Number(step.step_no) + 1;
      if (next > Number(req.total_steps)) {
        dbUpdate('approval_requests', requestId, { status: 'Approved', current_step: req.total_steps, updated_at: nowIso(), closed_at: nowIso() }, authCtx.user.email);
        applyApprovalOutcome_(req, 'Approved');
        audit({ user_id: authCtx.user.id, user_email: authCtx.user.email, action: 'approval_completed', module: 'approvals', entity: req.entity, record_id: req.record_id });
        notify_(req.initiator_user, {
          type: 'approved', title: 'Request approved',
          body: req.entity + ' • ' + (req.amount || 0) + ' ' + (req.currency || ''),
          link: 'approvals', entity: req.entity, record_id: req.record_id, project_id: req.project_id });
      } else {
        // activate next step + notify its approvers
        var steps = dbList('approval_steps', { request_id: requestId });
        for (var i = 0; i < steps.length; i++) if (Number(steps[i].step_no) === next) {
          dbUpdate('approval_steps', steps[i].id, { status: 'Active' }, 'system');
          notifyRoles_(JSON.parse(steps[i].roles_json || '[]'), {
            type: 'approval', title: 'Approval needed',
            body: req.domain + ' • ' + (req.amount || 0) + ' ' + (req.currency || ''),
            link: 'approvals', entity: req.entity, record_id: req.record_id, project_id: req.project_id
          }, req.initiator_user);
        }
        dbUpdate('approval_requests', requestId, { current_step: next, updated_at: nowIso() }, authCtx.user.email);
      }
    }
    return finalizeAndReturn_(requestId);
  });
}

/**
 * Reflect an approval decision back onto the underlying document's status.
 * Generic: any entity with a 'status' column gets set to Approved/Rejected.
 * Never throws into the approval flow.
 */
function applyApprovalOutcome_(req, outcome) {
  try {
    var rec = dbGet(req.entity, req.record_id);
    if (rec && rec.hasOwnProperty('status')) dbUpdate(req.entity, req.record_id, { status: outcome }, 'approval-engine');
  } catch (e) { console.error('applyApprovalOutcome failed: ' + (e && e.message)); }
}

function finalizeAndReturn_(requestId) {
  return { request: dbGet('approval_requests', requestId), steps: dbList('approval_steps', { request_id: requestId }) };
}

/** Requests with an active step that the given user is authorized to act on. */
function pendingApprovalsFor(authCtx) {
  var myCodes = userRoleCodes(authCtx.roles || []);
  var reqs = dbList('approval_requests', { status: 'Pending' });
  var out = [];
  for (var i = 0; i < reqs.length; i++) {
    if (String(reqs[i].initiator_user) === String(authCtx.user.id)) continue; // SoD: never your own
    var step = activeStep_(reqs[i].id);
    if (!step) continue;
    var roles = JSON.parse(step.roles_json || '[]');
    if (!roles.some(function (r) { return myCodes.indexOf(r) !== -1; })) continue;
    var approvals = JSON.parse(step.approvals_json || '[]');
    if (approvals.some(function (a) { return String(a.user) === String(authCtx.user.id); })) continue; // already acted
    out.push({ request: reqs[i], step: step });
  }
  return out;
}
