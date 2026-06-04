/**
 * Config.gs
 * ---------------------------------------------------------------------------
 * United Brothers Co. — Internal Operations PWA
 * Single source of truth for the Google Sheets "relational ledger" schema,
 * Drive folder tree, and global runtime constants.
 *
 * The whole backend reads from SCHEMA. Adding a column = edit one place here,
 * then run Setup.initializeWorkbook() to migrate headers idempotently.
 * ---------------------------------------------------------------------------
 */

/** Global runtime configuration. Override via Script Properties if desired. */
var CONFIG = {
  // If empty, the bound spreadsheet (SpreadsheetApp.getActive) is used.
  // For a standalone Web App, set SPREADSHEET_ID in Script Properties.
  SPREADSHEET_ID: '',

  // Root Drive folder that will contain every per-project directory tree.
  // If empty, a folder named ROOT_FOLDER_NAME is created at Drive root.
  ROOT_FOLDER_ID: '',
  ROOT_FOLDER_NAME: 'UBC_Operations',

  // LockService wait window (ms). Spec requires 15 seconds.
  LOCK_TIMEOUT_MS: 15000,

  // Shared-secret gate for write endpoints. Set API_TOKEN in Script Properties.
  REQUIRE_TOKEN: true,

  // Max characters of a base64 image accepted in a single doPost (≈ payload guard).
  // Apps Script hard limit on POST body is ~50MB; we stay well under.
  MAX_BASE64_CHARS: 48 * 1024 * 1024,

  TIMEZONE: 'Africa/Cairo'
};

/** Per-project Drive sub-folders, created in this exact order. */
var PROJECT_SUBFOLDERS = [
  '01_Procurement_Requests',
  '02_Technical_Office_Submittals',
  '03_Accounting_Invoices_Receipts',
  '04_Warehouse_MTRs_GRNs',
  '05_Site_As_Built_Evidence'
];

/**
 * SCHEMA — every tab in the workbook.
 * - sheet:    tab name
 * - pk:       primary key column (UUID)
 * - columns:  ordered header row. The first column is always the pk.
 * - fk:       { column: 'projects' } declares a foreign key into another sheet.
 *
 * Convention: every table carries id, created_at, updated_at, created_by,
 * sync_status, client_uuid (for offline idempotency).
 */
var AUDIT_COLUMNS = ['created_at', 'updated_at', 'created_by', 'sync_status', 'client_uuid'];

var SCHEMA = {

  /* ----------------------------- MASTER ---------------------------------- */
  projects: {
    sheet: 'Projects',
    pk: 'id',
    columns: [
      'id', 'project_code', 'project_name', 'client_name', 'location',
      'contract_value_egp', 'start_date', 'end_date', 'status',
      'drive_root_url', 'drive_root_id',
      'folder_procurement_url', 'folder_technical_url',
      'folder_accounting_url', 'folder_warehouse_url', 'folder_site_url'
    ].concat(AUDIT_COLUMNS),
    enums: { status: ['Planned', 'Active', 'On Hold', 'Closed'] }
  },

  users: {
    sheet: 'Users',
    pk: 'id',
    columns: ['id', 'full_name', 'email', 'role', 'phone', 'active']
      .concat(AUDIT_COLUMNS),
    enums: {
      role: ['Admin', 'ProjectManager', 'Procurement', 'TechnicalOffice',
        'Accounting', 'Warehouse', 'SiteEngineer', 'HSE'],
      active: ['TRUE', 'FALSE']
    }
  },

  /* --------------------------- PROCUREMENT -------------------------------- */
  material_requisitions: {
    sheet: 'MaterialRequisitions',
    pk: 'id',
    fk: { project_id: 'projects' },
    columns: [
      'id', 'mr_number', 'project_id', 'requested_by', 'required_date',
      'cost_code', 'priority', 'status', 'notes'
    ].concat(AUDIT_COLUMNS),
    enums: {
      priority: ['Low', 'Normal', 'High', 'Urgent'],
      status: ['Draft', 'Submitted', 'Approved', 'Rejected', 'PO Issued', 'Closed']
    }
  },

  material_requisition_lines: {
    sheet: 'MaterialRequisitionLines',
    pk: 'id',
    fk: { mr_id: 'material_requisitions' },
    columns: [
      'id', 'mr_id', 'line_no', 'description', 'spec', 'unit',
      'qty', 'est_unit_price_egp', 'est_total_egp'
    ].concat(AUDIT_COLUMNS)
  },

  purchase_orders: {
    sheet: 'PurchaseOrders',
    pk: 'id',
    fk: { project_id: 'projects', mr_id: 'material_requisitions' },
    columns: [
      'id', 'po_number', 'project_id', 'mr_id', 'supplier_name',
      'supplier_contact', 'order_date', 'delivery_date', 'currency',
      'subtotal_egp', 'vat_egp', 'total_egp', 'status', 'attachment_url', 'notes'
    ].concat(AUDIT_COLUMNS),
    enums: {
      currency: ['EGP', 'USD', 'EUR'],
      status: ['Draft', 'Issued', 'Partially Received', 'Received', 'Cancelled']
    }
  },

  purchase_order_lines: {
    sheet: 'PurchaseOrderLines',
    pk: 'id',
    fk: { po_id: 'purchase_orders' },
    columns: [
      'id', 'po_id', 'line_no', 'description', 'unit', 'qty',
      'unit_price_egp', 'line_total_egp'
    ].concat(AUDIT_COLUMNS)
  },

  price_tracker: {
    sheet: 'PriceTracker',
    pk: 'id',
    columns: [
      'id', 'item_description', 'unit', 'supplier_name', 'unit_price_egp',
      'quote_date', 'valid_until', 'source', 'attachment_url'
    ].concat(AUDIT_COLUMNS)
  },

  /* ------------------------- TECHNICAL OFFICE ----------------------------- */
  site_progress_logs: {
    sheet: 'SiteProgressLogs',
    pk: 'id',
    fk: { project_id: 'projects' },
    columns: [
      'id', 'project_id', 'log_date', 'weather', 'manpower_count',
      'equipment_count', 'activities', 'progress_pct', 'delays',
      'photo_url', 'logged_by'
    ].concat(AUDIT_COLUMNS)
  },

  quantity_takeoffs: {
    sheet: 'QuantityTakeoffs',
    pk: 'id',
    fk: { project_id: 'projects' },
    columns: [
      'id', 'project_id', 'boq_ref', 'description', 'unit',
      'length_m', 'width_m', 'height_m', 'count', 'qty', 'unit_rate_egp',
      'amount_egp', 'discipline'
    ].concat(AUDIT_COLUMNS)
  },

  milestone_signoffs: {
    sheet: 'MilestoneSignoffs',
    pk: 'id',
    fk: { project_id: 'projects' },
    columns: [
      'id', 'project_id', 'milestone_name', 'planned_date', 'actual_date',
      'status', 'value_egp', 'signed_by', 'evidence_url', 'remarks'
    ].concat(AUDIT_COLUMNS),
    enums: { status: ['Pending', 'Delivered', 'Approved', 'Disputed'] }
  },

  /* --------------------------- ACCOUNTING --------------------------------- */
  expense_logs: {
    sheet: 'ExpenseLogs',
    pk: 'id',
    fk: { project_id: 'projects' },
    columns: [
      'id', 'project_id', 'expense_date', 'category', 'description',
      'amount_egp', 'payment_method', 'vendor', 'cost_code',
      'receipt_url', 'reimbursable', 'approved_by'
    ].concat(AUDIT_COLUMNS),
    enums: {
      category: ['Materials', 'Labor', 'Equipment', 'Transport', 'Permits',
        'Utilities', 'Subcontractor', 'Misc'],
      payment_method: ['Cash', 'Bank Transfer', 'Cheque', 'Credit'],
      reimbursable: ['TRUE', 'FALSE']
    }
  },

  subcontractor_payments: {
    sheet: 'SubcontractorPayments',
    pk: 'id',
    fk: { project_id: 'projects' },
    columns: [
      'id', 'project_id', 'subcontractor_name', 'contract_ref', 'ipc_no',
      'work_period', 'gross_amount_egp', 'retention_pct', 'retention_egp',
      'deductions_egp', 'net_payable_egp', 'due_date', 'status',
      'attachment_url'
    ].concat(AUDIT_COLUMNS),
    enums: { status: ['Submitted', 'Certified', 'Paid', 'Held'] }
  },

  digital_receipts: {
    sheet: 'DigitalReceipts',
    pk: 'id',
    fk: { project_id: 'projects', expense_id: 'expense_logs' },
    columns: [
      'id', 'project_id', 'expense_id', 'receipt_no', 'receipt_date',
      'vendor', 'amount_egp', 'image_url'
    ].concat(AUDIT_COLUMNS)
  },

  /* ---------------------------- WAREHOUSE --------------------------------- */
  material_transfers: {
    sheet: 'MaterialTransfers',
    pk: 'id',
    fk: { from_project_id: 'projects', to_project_id: 'projects' },
    columns: [
      'id', 'mtr_number', 'from_project_id', 'to_project_id', 'transfer_date',
      'requested_by', 'status', 'vehicle', 'driver', 'notes'
    ].concat(AUDIT_COLUMNS),
    enums: { status: ['Requested', 'Approved', 'In Transit', 'Received', 'Cancelled'] }
  },

  material_transfer_lines: {
    sheet: 'MaterialTransferLines',
    pk: 'id',
    fk: { mtr_id: 'material_transfers' },
    columns: [
      'id', 'mtr_id', 'line_no', 'item_code', 'description', 'unit', 'qty'
    ].concat(AUDIT_COLUMNS)
  },

  goods_received_notes: {
    sheet: 'GoodsReceivedNotes',
    pk: 'id',
    fk: { project_id: 'projects', po_id: 'purchase_orders' },
    columns: [
      'id', 'grn_number', 'project_id', 'po_id', 'supplier_name',
      'received_date', 'received_by', 'condition', 'photo_url', 'notes'
    ].concat(AUDIT_COLUMNS),
    enums: { condition: ['Good', 'Damaged', 'Partial', 'Rejected'] }
  },

  goods_received_lines: {
    sheet: 'GoodsReceivedLines',
    pk: 'id',
    fk: { grn_id: 'goods_received_notes' },
    columns: [
      'id', 'grn_id', 'line_no', 'item_code', 'description', 'unit',
      'qty_ordered', 'qty_received', 'qty_accepted'
    ].concat(AUDIT_COLUMNS)
  },

  stock_items: {
    sheet: 'StockItems',
    pk: 'id',
    fk: { project_id: 'projects' },
    columns: [
      'id', 'project_id', 'item_code', 'description', 'unit',
      'qty_on_hand', 'min_level', 'reorder_qty', 'location', 'last_counted'
    ].concat(AUDIT_COLUMNS)
  }
};

/** Returns the SCHEMA entry for a logical entity name, or throws. */
function getSchema(entity) {
  var s = SCHEMA[entity];
  if (!s) throw new AppError('UNKNOWN_ENTITY', 'Unknown entity: ' + entity);
  return s;
}

/** All entity names that are exposed through the REST API. */
function listEntities() {
  return Object.keys(SCHEMA);
}
