/**
 * Operations2.gs — Phase 3 domain services: Business Development, Proposals &
 * Tendering, Construction site ops, Arabic Correspondence, Supplier Prequal.
 * Tenders route through the DoA engine via doc.submit (tender_submit band).
 */

/* ======================= BUSINESS DEVELOPMENT ========================= */
var BD = {
  createOpportunity: function (body, authCtx) {
    requireFields(body, ['client_id', 'title']);
    return dbInsert('opportunities', {
      opp_number: nextDocNumber('OPP'), client_id: body.client_id, title: body.title, sector: body.sector,
      estimated_value: coerceNumber(body.estimated_value), currency: body.currency || 'EGP',
      stage: body.stage || 'Lead', probability: coerceNumber(body.probability), source: body.source,
      owner_user: body.owner_user || authCtx.user.id, status: 'Open', notes: body.notes
    }, authCtx.user.email);
  },
  advanceOpportunity: function (id, stage, authCtx) {
    var o = dbGet('opportunities', id);
    if (!o) throw new AppError('NOT_FOUND', 'Opportunity not found.', 404);
    var patch = { stage: stage };
    if (stage === 'Won') patch.status = 'Won';
    if (stage === 'Lost') patch.status = 'Lost';
    return dbUpdate('opportunities', id, patch, authCtx.user.email);
  },
  logInteraction: function (body, authCtx) {
    requireFields(body, ['type', 'interaction_date']);
    return dbInsert('interactions', {
      opportunity_id: body.opportunity_id, client_id: body.client_id, type: body.type,
      interaction_date: body.interaction_date, contact_name: body.contact_name,
      summary: body.summary, next_action: body.next_action
    }, authCtx.user.email);
  }
};

/* ===================== PROPOSALS, SALES & TENDERING ==================== */
var Tendering = {
  createTender: function (body, authCtx) {
    requireFields(body, ['client_id', 'title']);
    var est = body.estimated_value;
    if ((est === undefined || est === '') && body.lines)
      est = body.lines.reduce(function (s, l) { return s + (Number(l.qty || 0) * Number(l.unit_cost || 0)); }, 0);
    var tender = dbInsert('tenders', {
      tender_number: nextDocNumber('TND'), client_id: body.client_id, opportunity_id: body.opportunity_id,
      title: body.title, scope: body.scope, estimated_value: coerceNumber(est), currency: body.currency || 'EGP',
      submission_deadline: body.submission_deadline, go_decision: body.go_decision || '', status: 'Registered'
    }, authCtx.user.email);
    var lines = insertLines_('tender_costlines', 'tender_id', tender.id, body.lines, authCtx.user.email, function (r) {
      r.qty = coerceNumber(r.qty); r.unit_cost = coerceNumber(r.unit_cost);
      r.total = Number(r.qty || 0) * Number(r.unit_cost || 0);
    });
    return { header: tender, lines: lines };
  },
  award: function (id, outcome, authCtx) {
    var st = outcome === 'Awarded' ? 'Awarded' : 'Lost';
    return dbUpdate('tenders', id, { status: st }, authCtx.user.email);
  }
};

/* ====================== CONSTRUCTION SITE OPS ========================= */
var Construction = {
  createDailyReport: function (body, authCtx) {
    requireFields(body, ['project_id', 'report_date']);
    return dbInsert('daily_site_reports', {
      dsr_number: nextDocNumber('DSR'), project_id: body.project_id, report_date: body.report_date,
      weather: body.weather, manpower_count: coerceNumber(body.manpower_count), equipment_count: coerceNumber(body.equipment_count),
      activities: body.activities, progress_pct: coerceNumber(body.progress_pct), delays: body.delays,
      photo_url: body.photo_url, logged_by: authCtx.user.id
    }, authCtx.user.email);
  },
  createSiteInstruction: function (body, authCtx) {
    requireFields(body, ['project_id', 'subject']);
    return dbInsert('site_instructions', {
      si_number: nextDocNumber('SI'), project_id: body.project_id, instruction_date: body.instruction_date,
      issued_to: body.issued_to, subject: body.subject, details: body.details, status: 'Open'
    }, authCtx.user.email);
  }
};

/* ====================== ARABIC CORRESPONDENCE ========================= */
var Correspondence = {
  create: function (body, authCtx) {
    requireFields(body, ['type', 'recipient']);
    return dbInsert('correspondence', {
      letter_number: nextDocNumber('COR'), type: body.type, project_id: body.project_id, recipient: body.recipient,
      subject_ar: body.subject_ar, body_ar: body.body_ar, reference: body.reference, status: 'Draft',
      letter_date: body.letter_date
    }, authCtx.user.email);
  },
  issue: function (id, authCtx) {
    return dbUpdate('correspondence', id, { status: 'Issued', signed_by: authCtx.user.id }, authCtx.user.email);
  }
};

/* ===================== SUPPLIER PREQUALIFICATION ====================== */
var Prequal = {
  create: function (body, authCtx) {
    requireFields(body, ['client_id']);
    return dbInsert('prequalifications', {
      prq_number: nextDocNumber('PRQ'), client_id: body.client_id, submitted_date: body.submitted_date,
      portal: body.portal, scope: body.scope, status: body.status || 'Draft', notes: body.notes
    }, authCtx.user.email);
  }
};
