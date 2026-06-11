/**
 * Config.gs — UBC Operations Platform v2 (Foundation)
 * ---------------------------------------------------------------------------
 * Single source of truth for the v2 relational ledger schema, the role
 * catalog, the seed permission matrix, and the Delegation-of-Authority (DoA)
 * bands. Everything the RBAC + approval engine needs is data here, so the
 * matrix can be tuned in the Sheet without code changes.
 *
 * Decisions encoded (ratified 2026-06, see docs/BLUEPRINT.md §8 & §11):
 *  - Auth: email + password (hash+salt+pepper, sessions).
 *  - Org: MANUAL org canonical (Sadiek CEO, Ghareeb COO, Hassan CFO, Younes CM, Donia PTS).
 *  - COA: hybrid; project/cost key = (Client × client-PO). Bilingual AR/EN + RTL.
 *  - Authority by role + amount; optional title→grade map.
 * ---------------------------------------------------------------------------
 */

var CONFIG = {
  SPREADSHEET_ID: '',                 // set in Script Properties for standalone
  ROOT_FOLDER_ID: '',
  ROOT_FOLDER_NAME: 'UBC_Operations_v2',
  LOCK_TIMEOUT_MS: 15000,
  SESSION_TTL_MS: 12 * 60 * 60 * 1000, // 12h
  PBKDF2_ITERATIONS: 20000,           // HMAC-SHA256 stretching rounds
  MAX_FAILED_LOGINS: 5,
  LOCKOUT_MS: 15 * 60 * 1000,         // 15 min
  BASE_CURRENCY: 'EGP',
  CURRENCIES: ['EGP', 'USD', 'EUR', 'GBP'],
  TIMEZONE: 'Africa/Cairo',
  COMPANY: {
    legal_name_en: 'United Brothers Co. (UBcsis) — Contracting, Supplies & Industrial Services',
    legal_name_ar: 'شركة الأخوة المتحدين للمقاولات والتوريدات والخدمات الصناعية',
    commercial_register: '66236',
    tax_register: '545-821-037',
    founded: 2017,
    city: 'Suez, Egypt'
  }
};

var AUDIT_COLUMNS = ['created_at', 'updated_at', 'created_by', 'updated_by'];

/**
 * SCHEMA — Phase 1 (Foundation) tables only. Domain modules (procurement,
 * finance, …) are added in later phases against this same pattern.
 */
var SCHEMA = {

  /* ----- identity & access ----- */
  users: {
    sheet: 'Users', pk: 'id',
    columns: ['id', 'email', 'full_name_en', 'full_name_ar', 'phone',
      'title_en', 'title_ar', 'grade', 'salt', 'password_hash', 'must_reset',
      'failed_attempts', 'locked_until', 'active', 'default_lang']
      .concat(AUDIT_COLUMNS),
    enums: { active: ['TRUE', 'FALSE'], must_reset: ['TRUE', 'FALSE'], default_lang: ['ar', 'en'] }
  },
  roles: {
    sheet: 'Roles', pk: 'id',
    columns: ['id', 'code', 'name_en', 'name_ar', 'description', 'active'].concat(AUDIT_COLUMNS),
    enums: { active: ['TRUE', 'FALSE'] }
  },
  permissions: {
    sheet: 'Permissions', pk: 'id',
    columns: ['id', 'role_code', 'module', 'entity', 'action', 'scope'].concat(AUDIT_COLUMNS),
    enums: {
      action: ['view', 'create', 'edit', 'submit', 'approve', 'reject', 'sign', 'close', 'void', 'export', 'admin'],
      scope: ['GLOBAL', 'PROJECT', 'OWN']
    }
  },
  role_assignments: {
    sheet: 'RoleAssignments', pk: 'id',
    fk: { user_id: 'users', project_id: 'projects' },
    columns: ['id', 'user_id', 'role_code', 'scope_type', 'project_id', 'active'].concat(AUDIT_COLUMNS),
    enums: { scope_type: ['GLOBAL', 'PROJECT'], active: ['TRUE', 'FALSE'] }
  },
  sessions: {
    sheet: 'Sessions', pk: 'id',
    columns: ['id', 'token_hash', 'user_id', 'created_at', 'expires_at', 'last_seen', 'revoked', 'ip', 'agent']
  },

  /* ----- governance ----- */
  audit_log: {
    sheet: 'AuditLog', pk: 'id',
    columns: ['id', 'ts', 'user_id', 'user_email', 'action', 'module', 'entity',
      'record_id', 'project_id', 'amount', 'before_json', 'after_json', 'ip', 'note']
  },
  doa_bands: {
    sheet: 'DoABands', pk: 'id',
    columns: ['id', 'domain', 'action', 'min_amount', 'max_amount', 'currency',
      'signer_chain_json', 'description_en', 'description_ar', 'active'].concat(AUDIT_COLUMNS),
    enums: { active: ['TRUE', 'FALSE'] }
  },
  approval_requests: {
    sheet: 'ApprovalRequests', pk: 'id',
    fk: { project_id: 'projects', initiator_user: 'users' },
    columns: ['id', 'domain', 'entity', 'record_id', 'project_id', 'amount', 'currency',
      'initiator_user', 'band_id', 'status', 'current_step', 'total_steps',
      'created_at', 'updated_at', 'closed_at'],
    enums: { status: ['Pending', 'Approved', 'Rejected', 'Returned', 'Cancelled'] }
  },
  approval_steps: {
    sheet: 'ApprovalSteps', pk: 'id',
    fk: { request_id: 'approval_requests' },
    columns: ['id', 'request_id', 'step_no', 'mode', 'required_count', 'roles_json',
      'status', 'approvals_json', 'decision_at', 'comment'],
    enums: { mode: ['all', 'any', 'count'], status: ['Pending', 'Active', 'Approved', 'Rejected', 'Skipped'] }
  },
  doc_sequences: {
    sheet: 'DocSequences', pk: 'id',
    columns: ['id', 'seq_key', 'year', 'current', 'updated_at']
  },
  lookups: {
    sheet: 'Lookups', pk: 'id',
    columns: ['id', 'category', 'code', 'label_en', 'label_ar', 'sort', 'active'].concat(AUDIT_COLUMNS),
    enums: { active: ['TRUE', 'FALSE'] }
  },

  /* ----- masters ----- */
  clients: {
    sheet: 'Clients', pk: 'id',
    columns: ['id', 'client_code', 'name_en', 'name_ar', 'sector', 'tax_id',
      'contact_name', 'contact_phone', 'contact_email', 'address', 'status', 'notes']
      .concat(AUDIT_COLUMNS),
    enums: { status: ['Active', 'Prospect', 'Inactive', 'Blacklisted'] }
  },
  suppliers: {
    sheet: 'Suppliers', pk: 'id',
    columns: ['id', 'supplier_code', 'name_en', 'name_ar', 'category', 'tax_id',
      'contact_name', 'contact_phone', 'contact_email', 'avl_status', 'rating', 'status', 'notes']
      .concat(AUDIT_COLUMNS),
    enums: { avl_status: ['Approved', 'Conditional', 'Rejected', 'Pending'], status: ['Active', 'Inactive'] }
  },
  projects: {
    sheet: 'Projects', pk: 'id',
    fk: { client_id: 'clients' },
    columns: ['id', 'project_code', 'client_id', 'client_ref', 'name_en', 'name_ar',
      'sector', 'location', 'contract_value', 'currency', 'start_date', 'end_date',
      'status', 'pm_user', 'drive_root_url', 'drive_root_id',
      'folder_procurement_url', 'folder_technical_url', 'folder_accounting_url',
      'folder_warehouse_url', 'folder_site_url', 'notes'].concat(AUDIT_COLUMNS),
    enums: { status: ['Planned', 'Active', 'On Hold', 'Closed'], currency: ['EGP', 'USD', 'EUR', 'GBP'] }
  }
};

/** Per-project Drive sub-folders (carried forward from v1). */
var PROJECT_SUBFOLDERS = [
  '01_Procurement_Requests', '02_Technical_Office_Submittals',
  '03_Accounting_Invoices_Receipts', '04_Warehouse_MTRs_GRNs', '05_Site_As_Built_Evidence'
];

/* =========================================================================
 * SEED DATA — roles, the manual-org users, permission matrix, DoA bands.
 * Consumed by Setup.initializeWorkbook(). All editable in-sheet afterwards.
 * ========================================================================= */

/** Role catalog (code → bilingual label). */
var SEED_ROLES = [
  ['CEO', 'Chief Executive Officer', 'الرئيس التنفيذي'],
  ['COO', 'Chief Operating Officer', 'مدير العمليات'],
  ['CFO', 'Chief Financial Officer', 'المدير المالي'],
  ['CONSTRUCTION_MGR', 'Construction Manager', 'مدير الإنشاءات'],
  ['TPM_HEAD', 'Technical Office Manager', 'مدير المكتب الفني'],
  ['PTS_HEAD', 'Head of Proposals & Tendering', 'مدير العطاءات والمناقصات'],
  ['PROCUREMENT_MGR', 'Procurement Manager', 'مدير المشتريات'],
  ['FINANCE_CONTROLLER', 'Finance Controller / Accountant', 'المحاسب / المراقب المالي'],
  ['HR_MGR', 'HR Manager', 'مدير الموارد البشرية'],
  ['HSE_MGR', 'HSE Manager', 'مدير السلامة والصحة المهنية'],
  ['QAQC_MGR', 'QA/QC Manager', 'مدير الجودة'],
  ['BD_MGR', 'Business Development Manager', 'مدير تطوير الأعمال'],
  ['ASSET_LEAD', 'Asset & Maintenance Lead', 'مسؤول الأصول والصيانة'],
  ['PROJECT_MGR', 'Project Manager', 'مدير المشروع'],
  ['SITE_ENGINEER', 'Site Engineer', 'مهندس موقع'],
  ['QS', 'Quantity Surveyor', 'حصر كميات'],
  ['QAQC_ENGINEER', 'QA/QC Engineer', 'مهندس جودة'],
  ['HSE_OFFICER', 'HSE Officer', 'مسؤول سلامة'],
  ['PLANNING_ENGINEER', 'Planning Engineer', 'مهندس تخطيط'],
  ['TECH_OFFICE_ENGINEER', 'Technical Office Engineer', 'مهندس مكتب فني'],
  ['STOREKEEPER', 'Storekeeper', 'أمين مخزن'],
  ['SITE_ADMIN', 'Site Administrator', 'إداري موقع'],
  ['EMPLOYEE', 'Employee', 'موظف'],
  ['ADMIN', 'System Administrator', 'مدير النظام']
];

/**
 * Seed users — the ratified MANUAL org. Passwords are NOT set here; Setup
 * creates them with must_reset=TRUE and a temporary password printed to the log.
 * [email, name_en, name_ar, title_en, role_code]
 */
var SEED_USERS = [
  ['admin@ubcsis.com', 'System Admin', 'مدير النظام', 'System Administrator', 'ADMIN'],
  ['ceo@ubcsis.com', 'Ahmed Sadiek', 'أحمد صادق', 'Chief Executive Officer', 'CEO'],
  ['coo@ubcsis.com', 'Ghareeb Mahmoud', 'غريب محمود', 'Chief Operating Officer', 'COO'],
  ['cfo@ubcsis.com', 'Ahmed Hassan', 'أحمد حسن', 'Chief Financial Officer', 'CFO'],
  ['construction@ubcsis.com', 'Mahmoud Younes', 'محمود يونس', 'Construction Manager', 'CONSTRUCTION_MGR'],
  ['tenders@ubcsis.com', 'Donia Ali', 'دنيا علي', 'Head of Proposals & Tendering', 'PTS_HEAD'],
  ['procurement@ubcsis.com', 'Ahmed Hassan (Procurement)', 'أحمد حسن', 'Procurement Manager', 'PROCUREMENT_MGR'],
  ['accounts@ubcsis.com', 'Mahmoud Diab', 'محمود دياب', 'Accountant', 'FINANCE_CONTROLLER']
];

/**
 * Permission matrix seed: [role_code, module, entity, action, scope].
 * entity '*' = all entities in module; module '*' = everything (admin).
 * This is the Phase-1 baseline; domain modules extend it per phase.
 */
var SEED_PERMISSIONS = [
  // Full system admin
  ['ADMIN', '*', '*', 'admin', 'GLOBAL'],
  ['ADMIN', '*', '*', 'view', 'GLOBAL'],
  ['ADMIN', '*', '*', 'create', 'GLOBAL'],
  ['ADMIN', '*', '*', 'edit', 'GLOBAL'],

  // Executives: global visibility + approval authority
  ['CEO', '*', '*', 'view', 'GLOBAL'], ['CEO', '*', '*', 'approve', 'GLOBAL'], ['CEO', '*', '*', 'sign', 'GLOBAL'],
  ['COO', '*', '*', 'view', 'GLOBAL'], ['COO', '*', '*', 'approve', 'GLOBAL'],
  ['CFO', '*', '*', 'view', 'GLOBAL'], ['CFO', '*', '*', 'approve', 'GLOBAL'], ['CFO', 'finance', '*', 'create', 'GLOBAL'],

  // Masters management (admin + relevant heads)
  ['PROCUREMENT_MGR', 'masters', 'suppliers', 'create', 'GLOBAL'],
  ['PROCUREMENT_MGR', 'masters', 'suppliers', 'edit', 'GLOBAL'],
  ['BD_MGR', 'masters', 'clients', 'create', 'GLOBAL'],
  ['BD_MGR', 'masters', 'clients', 'edit', 'GLOBAL'],
  ['PTS_HEAD', 'masters', 'projects', 'create', 'GLOBAL'],
  ['TPM_HEAD', 'masters', 'projects', 'edit', 'GLOBAL'],

  // Everyone authenticated can view masters + their own approvals
  ['EMPLOYEE', 'masters', 'projects', 'view', 'GLOBAL'],
  ['EMPLOYEE', 'masters', 'clients', 'view', 'GLOBAL'],
  ['EMPLOYEE', 'masters', 'suppliers', 'view', 'GLOBAL'],
  ['EMPLOYEE', 'approvals', 'approval_requests', 'view', 'OWN'],

  // Project roles: view their project masters
  ['PROJECT_MGR', 'masters', 'projects', 'view', 'PROJECT'],
  ['PROJECT_MGR', 'masters', 'projects', 'edit', 'PROJECT'],
  ['SITE_ENGINEER', 'masters', 'projects', 'view', 'PROJECT']
];

/**
 * DoA bands — the ratified §3 authority matrix encoded as data.
 * signer_chain = JSON array of steps (executed sequentially). Each step:
 *   { mode: 'all'|'any'|'count', roles: [..], count?: n }
 * 'all' = every listed role must approve; 'any' = one of; 'count' = N of the listed.
 * Amounts in EGP. max_amount '' or null = unbounded.
 * [domain, action, min, max, signer_chain, desc_en]
 */
var SEED_DOA = [
  // ---- Procurement (Finance-manual bands, ratified canonical) ----
  ['procurement', 'commit', 0, 25000, [{ mode: 'all', roles: ['SITE_ENGINEER', 'CONSTRUCTION_MGR'] }], 'PR ≤25K: Site Eng + Construction Mgr'],
  ['procurement', 'commit', 25001, 100000, [{ mode: 'all', roles: ['CONSTRUCTION_MGR', 'PROCUREMENT_MGR'] }], 'PR 25–100K: CM + Procurement Mgr (≥3 quotes)'],
  ['procurement', 'commit', 100001, 500000, [{ mode: 'all', roles: ['PROCUREMENT_MGR', 'CFO'] }], 'PR 100–500K: + CFO co-sign'],
  ['procurement', 'commit', 500001, 2000000, [{ mode: 'all', roles: ['CFO', 'CEO'] }], 'PR 500K–2M: + CEO co-sign'],
  ['procurement', 'commit', 2000001, null, [{ mode: 'all', roles: ['CEO'] }, { mode: 'any', roles: ['CEO'] }], 'PR >2M: CEO + Board'],

  // ---- Payments (cheque) ----
  ['payment_cheque', 'pay', 0, 250000, [{ mode: 'count', roles: ['CEO', 'COO', 'CFO'], count: 2 }], 'Cheque ≤250K: two of CEO/COO/CFO'],
  ['payment_cheque', 'pay', 250001, 1000000, [{ mode: 'count', roles: ['CEO', 'CFO'], count: 1 }, { mode: 'count', roles: ['CEO', 'COO', 'CFO'], count: 2 }], 'Cheque 250K–1M: two of three incl. CEO/CFO'],
  ['payment_cheque', 'pay', 1000001, null, [{ mode: 'all', roles: ['CEO', 'CFO'] }], 'Cheque >1M: CEO + CFO'],

  // ---- Payments (transfer) ----
  ['payment_transfer', 'pay', 0, 250000, [{ mode: 'all', roles: ['FINANCE_CONTROLLER', 'CFO'] }], 'Transfer ≤250K: Maker + CFO'],
  ['payment_transfer', 'pay', 250001, null, [{ mode: 'all', roles: ['FINANCE_CONTROLLER'] }, { mode: 'any', roles: ['CEO', 'CFO'] }], 'Transfer >250K: Maker + (CEO or CFO)'],

  // ---- Revenue / e-invoice ----
  ['einvoice', 'issue', 0, 500000, [{ mode: 'all', roles: ['CFO'] }], 'E-invoice ≤500K: CFO'],
  ['einvoice', 'issue', 500001, null, [{ mode: 'all', roles: ['CFO', 'CEO'] }], 'E-invoice >500K: CFO + CEO'],

  // ---- Technical Office: Variation Orders ----
  ['vor', 'approve', 0, 250000, [{ mode: 'all', roles: ['PROJECT_MGR'] }], 'VOR ≤250K: PM'],
  ['vor', 'approve', 250001, 1000000, [{ mode: 'all', roles: ['TPM_HEAD'] }], 'VOR 250K–1M: TPM Head'],
  ['vor', 'approve', 1000001, 5000000, [{ mode: 'all', roles: ['COO'] }], 'VOR 1M–5M: COO'],
  ['vor', 'approve', 5000001, null, [{ mode: 'all', roles: ['CEO', 'CFO'] }], 'VOR >5M: CEO + CFO'],

  // ---- HR ----
  ['hr_hire', 'approve', 0, null, [{ mode: 'all', roles: ['HR_MGR'] }, { mode: 'any', roles: ['COO', 'CFO'] }], 'Hire below dept-head: HR Mgr + COO/CFO'],
  ['hr_termination', 'approve', 0, null, [{ mode: 'all', roles: ['CEO'] }], 'Termination (post-probation): CEO + Legal'],

  // ---- Tendering (PTS) ----
  ['tender_submit', 'approve', 0, 1000000, [{ mode: 'all', roles: ['PTS_HEAD'] }], 'Submit ≤1M: PTS Head'],
  ['tender_submit', 'approve', 1000001, 25000000, [{ mode: 'all', roles: ['PTS_HEAD', 'CFO'] }], 'Submit 1M–25M: PTS Head + CFO'],
  ['tender_submit', 'approve', 25000001, null, [{ mode: 'all', roles: ['CEO'] }], 'Submit >25M: CEO'],
  ['contract_sign', 'sign', 0, null, [{ mode: 'all', roles: ['CEO'] }], 'Sign client contract: CEO only (all values)']
];

/** Sectors lookup seed (bilingual). */
var SEED_LOOKUPS = [
  ['sector', 'chemicals', 'Chemicals', 'كيماويات'],
  ['sector', 'energy', 'Energy', 'طاقة'],
  ['sector', 'sugar', 'Sugar', 'سكر'],
  ['sector', 'mining', 'Mining', 'تعدين'],
  ['sector', 'glass', 'Glass', 'زجاج'],
  ['sector', 'cement', 'Cement', 'أسمنت'],
  ['sector', 'construction', 'Construction', 'إنشاءات'],
  ['sector', 'food', 'Food & Beverage', 'أغذية ومشروبات']
];

/** A few anchor clients to seed (the rest migrate later). [code,en,ar,sector] */
var SEED_CLIENTS = [
  ['GCE', 'Galaxy Chemicals Egypt', 'جالاكسي كيماويات مصر', 'chemicals'],
  ['SMNS', 'Siemens Energy', 'سيمنس للطاقة', 'energy'],
  ['SGGE', 'Saint-Gobain Glass Egypt', 'سان جوبان للزجاج', 'glass'],
  ['CSU', 'Canal Sugar', 'القناة للسكر', 'sugar'],
  ['KNF', 'KNAUF', 'كناوف', 'construction'],
  ['SUST', 'Suez Steel', 'السويس للصلب', 'energy'],
  ['SUK', 'Centamin / Sukari Gold Mine', 'سنتامين - منجم السكري', 'mining']
];

function getSchema(entity) {
  var s = SCHEMA[entity];
  if (!s) throw new AppError('UNKNOWN_ENTITY', 'Unknown entity: ' + entity);
  return s;
}
function listEntities() { return Object.keys(SCHEMA); }
