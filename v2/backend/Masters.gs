/**
 * Masters.gs — Clients, Suppliers, Projects (Phase-1 master data).
 * Projects use the ratified key model: external client_ref / PO is the primary
 * operational key; UBC-PRJ-#### is a secondary internal id. Creating a project
 * provisions its Drive tree and writes folder URLs back.
 */

function createClient(body, actor) {
  requireFields(body, ['name_en']);
  if (!body.client_code) body.client_code = nextDocNumber('CLI');
  body.status = body.status || 'Active';
  return dbInsert('clients', body, actor);
}

function createSupplier(body, actor) {
  requireFields(body, ['name_en']);
  if (!body.supplier_code) body.supplier_code = nextDocNumber('SUP');
  body.status = body.status || 'Active';
  body.avl_status = body.avl_status || 'Pending';
  return dbInsert('suppliers', body, actor);
}

/** Create a project + Drive tree. Requires online Drive (provisioning side-effect). */
function createProject(body, actor) {
  requireFields(body, ['name_en', 'client_id']);
  if (!dbGet('clients', body.client_id)) throw new AppError('FK_VIOLATION', 'client_id not found.');
  var id = uuid();
  if (!body.project_code) body.project_code = nextDocNumber('UBC-PRJ');
  body.contract_value = coerceNumber(body.contract_value);
  body.currency = body.currency || CONFIG.BASE_CURRENCY;
  body.status = body.status || 'Planned';

  var tree = provisionProjectTree(body.name_en, id);
  body.id = id;
  body.drive_root_id = tree.root.id;
  body.drive_root_url = tree.root.url;
  body.folder_procurement_url = tree.sub['01_Procurement_Requests'].url;
  body.folder_technical_url = tree.sub['02_Technical_Office_Submittals'].url;
  body.folder_accounting_url = tree.sub['03_Accounting_Invoices_Receipts'].url;
  body.folder_warehouse_url = tree.sub['04_Warehouse_MTRs_GRNs'].url;
  body.folder_site_url = tree.sub['05_Site_As_Built_Evidence'].url;
  return dbInsert('projects', body, actor);
}
