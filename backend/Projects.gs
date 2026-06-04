/**
 * Projects.gs
 * ---------------------------------------------------------------------------
 * Master project lifecycle. Creating a project provisions its Drive tree and
 * writes the folder URLs back to the master row (per architecture req #1).
 * ---------------------------------------------------------------------------
 */

/**
 * Create a project + Drive directory tree, then persist folder URLs.
 * @param {Object} body  { project_name, project_code?, client_name?, ... , client_uuid? }
 * @param {string} actor
 * @return {Object} stored project row including all folder URLs.
 */
function createProjectWithDrive(body, actor) {
  requireFields(body, ['project_name']);

  // Idempotency guard before we provision Drive (expensive / side-effecting).
  if (body.client_uuid) {
    var dup = dbFindByClientUuid_('projects', body.client_uuid);
    if (dup) return dup.obj;
  }

  var id = isUuid(body.id) ? body.id : uuid();
  if (!body.project_code) {
    body.project_code = nextDocNumber_('PRJ');
  }

  // 1) Provision Drive tree.
  var tree = provisionProjectTree(body.project_name, id);

  // 2) Build the master record with folder URLs written back.
  var record = pickColumns('projects', body);
  record.id = id;
  record.status = record.status || 'Planned';
  record.contract_value_egp = coerceNumber(record.contract_value_egp);
  record.drive_root_id = tree.root.id;
  record.drive_root_url = tree.root.url;
  record.folder_procurement_url = folderUrlFor_(tree, 'procurement').url;
  record.folder_technical_url = folderUrlFor_(tree, 'technical').url;
  record.folder_accounting_url = folderUrlFor_(tree, 'accounting').url;
  record.folder_warehouse_url = folderUrlFor_(tree, 'warehouse').url;
  record.folder_site_url = folderUrlFor_(tree, 'site').url;

  // 3) Persist (under lock, idempotent).
  return dbInsert('projects', record, actor);
}

/** Return the Drive sub-folder id for a project + logical slot. */
function projectFolderId(projectId, slot) {
  var p = dbGet('projects', projectId);
  if (!p) throw new AppError('NOT_FOUND', 'Project ' + projectId + ' not found.', 404);
  var urlField = {
    procurement: 'folder_procurement_url',
    technical: 'folder_technical_url',
    accounting: 'folder_accounting_url',
    warehouse: 'folder_warehouse_url',
    site: 'folder_site_url'
  }[slot];
  if (!urlField) throw new AppError('VALIDATION', 'Unknown folder slot: ' + slot);
  var url = p[urlField];
  if (!url) throw new AppError('NO_FOLDER', 'Project has no ' + slot + ' folder. Re-provision.', 409);
  var m = String(url).match(/folders\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new AppError('NO_FOLDER', 'Cannot parse folder id from URL.', 500);
  return m[1];
}
