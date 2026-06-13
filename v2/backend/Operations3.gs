/**
 * Operations3.gs — Phase 4 domain services: HR, Asset & Equipment, HSE.
 * Leave requests, HIRA (risk-scored), and permits route through the DoA engine
 * via doc.submit (hr_leave / hse_risk / hse_permit bands).
 */

/* ================================= HR ================================== */
var HR = {
  createEmployee: function (body, authCtx) {
    requireFields(body, ['full_name_en']);
    return dbInsert('employees', {
      emp_code: body.emp_code || nextDocNumber('EMP'), full_name_en: body.full_name_en, full_name_ar: body.full_name_ar,
      national_id: body.national_id, title: body.title, grade: body.grade, department: body.department,
      hire_date: body.hire_date, contract_type: body.contract_type || 'Permanent', basic_salary: coerceNumber(body.basic_salary),
      currency: body.currency || 'EGP', phone: body.phone, user_id: body.user_id, status: body.status || 'Active'
    }, authCtx.user.email);
  },
  createLeave: function (body, authCtx) {
    requireFields(body, ['employee_id', 'type', 'from_date', 'to_date']);
    var days = body.days;
    if (days === undefined || days === '') {
      var d1 = new Date(body.from_date), d2 = new Date(body.to_date);
      days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
    }
    return dbInsert('leave_requests', {
      leave_number: nextDocNumber('LV'), employee_id: body.employee_id, type: body.type,
      from_date: body.from_date, to_date: body.to_date, days: coerceNumber(days), reason: body.reason, status: 'Draft'
    }, authCtx.user.email);
  },
  createTimesheet: function (body, authCtx) {
    requireFields(body, ['employee_id', 'period']);
    return dbInsert('timesheets', {
      ts_number: nextDocNumber('TS'), employee_id: body.employee_id, project_id: body.project_id, period: body.period,
      days_worked: coerceNumber(body.days_worked), ot_hours: coerceNumber(body.ot_hours), status: 'Draft'
    }, authCtx.user.email);
  },
  createAppraisal: function (body, authCtx) {
    requireFields(body, ['employee_id', 'period']);
    return dbInsert('appraisals', {
      appr_number: nextDocNumber('APR'), employee_id: body.employee_id, period: body.period, rating: body.rating,
      reviewer_user: authCtx.user.id, strengths: body.strengths, improvements: body.improvements, status: 'Draft'
    }, authCtx.user.email);
  }
};

/* ========================= ASSET & EQUIPMENT =========================== */
var Assets = {
  createAsset: function (body, authCtx) {
    requireFields(body, ['name', 'category']);
    return dbInsert('assets', {
      asset_code: body.asset_code || nextDocNumber('AST'), name: body.name, category: body.category, serial_no: body.serial_no,
      acquisition_date: body.acquisition_date, cost: coerceNumber(body.cost), currency: body.currency || 'EGP',
      location: body.location, assigned_to: body.assigned_to, project_id: body.project_id, status: body.status || 'In Service'
    }, authCtx.user.email);
  },
  logMaintenance: function (body, authCtx) {
    requireFields(body, ['asset_id', 'type', 'mnt_date']);
    var rec = dbInsert('maintenance_records', {
      mnt_number: nextDocNumber('MNT'), asset_id: body.asset_id, type: body.type, mnt_date: body.mnt_date,
      description: body.description, cost: coerceNumber(body.cost), next_due: body.next_due, performed_by: authCtx.user.id
    }, authCtx.user.email);
    if (body.type === 'Corrective') dbUpdate('assets', body.asset_id, { status: 'In Service' }, authCtx.user.email);
    return rec;
  },
  logCalibration: function (body, authCtx) {
    requireFields(body, ['asset_id', 'calibrated_date', 'due_date']);
    var status = 'Valid';
    return dbInsert('calibration_records', {
      cal_number: nextDocNumber('CAL'), asset_id: body.asset_id, cert_no: body.cert_no,
      calibrated_date: body.calibrated_date, due_date: body.due_date, status: status
    }, authCtx.user.email);
  }
};

/* ================================ HSE ================================== */
var HSE = {
  createHIRA: function (body, authCtx) {
    requireFields(body, ['project_id', 'activity']);
    return dbInsert('hira', {
      hira_number: nextDocNumber('HIRA'), project_id: body.project_id, activity: body.activity, hazards: body.hazards,
      risk_score: coerceNumber(body.risk_score), controls: body.controls, residual_score: coerceNumber(body.residual_score),
      status: 'Draft'
    }, authCtx.user.email);
  },
  createPermit: function (body, authCtx) {
    requireFields(body, ['project_id', 'type']);
    return dbInsert('permits', {
      permit_number: nextDocNumber('PTW'), project_id: body.project_id, type: body.type, valid_from: body.valid_from,
      valid_to: body.valid_to, issued_to: body.issued_to, status: 'Draft'
    }, authCtx.user.email);
  },
  reportIncident: function (body, authCtx) {
    requireFields(body, ['project_id', 'incident_date', 'type']);
    return dbInsert('incidents', {
      incident_number: nextDocNumber('INC'), project_id: body.project_id, incident_date: body.incident_date, type: body.type,
      description: body.description, severity: body.severity || 'Low', status: 'Open'
    }, authCtx.user.email);
  },
  investigateIncident: function (id, rootCause, action, authCtx) {
    return dbUpdate('incidents', id, { root_cause: rootCause, corrective_action: action, status: 'Closed' }, authCtx.user.email);
  },
  createInspection: function (body, authCtx) {
    requireFields(body, ['project_id', 'inspection_date']);
    return dbInsert('hse_inspections', {
      insp_number: nextDocNumber('INSP'), project_id: body.project_id, inspection_date: body.inspection_date,
      area: body.area, findings: body.findings, score: coerceNumber(body.score), status: 'Open'
    }, authCtx.user.email);
  }
};
