/**
 * DriveService.gs — per-project Drive folder-tree provisioning (carried from v1).
 */
function getRootFolder_() {
  var id = prop('ROOT_FOLDER_ID', CONFIG.ROOT_FOLDER_ID);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.ROOT_FOLDER_NAME);
  setProp('ROOT_FOLDER_ID', folder.getId());
  return folder;
}
function shareFolder_(folder) {
  try { folder.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {} }
}
/** Resolve a project's Drive sub-folder id for a logical slot. */
function projectFolderId(projectId, slot) {
  var p = dbGet('projects', projectId);
  if (!p) throw new AppError('NOT_FOUND', 'Project not found.', 404);
  var field = { procurement: 'folder_procurement_url', technical: 'folder_technical_url',
    accounting: 'folder_accounting_url', warehouse: 'folder_warehouse_url', site: 'folder_site_url' }[slot] || 'folder_site_url';
  var m = String(p[field] || p.drive_root_url || '').match(/folders\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new AppError('NO_FOLDER', 'Project has no Drive folder for slot ' + slot + '.', 409);
  return m[1];
}

/** Decode a base64 (or data: URL) string and store it as a Drive file. */
function uploadBase64ToFolder(folderId, fileName, mimeType, base64) {
  var clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!clean) throw new AppError('VALIDATION', 'No file content.');
  var bytes;
  try { bytes = Utilities.base64Decode(clean); } catch (e) { throw new AppError('BAD_BASE64', 'Invalid base64 content.'); }
  var folder;
  try { folder = DriveApp.getFolderById(folderId); } catch (e) { throw new AppError('FOLDER_NOT_FOUND', 'Drive folder not accessible.', 404); }
  var safe = String(fileName || ('upload_' + uuid())).replace(/[\\/:*?"<>|]/g, '_');
  var file = folder.createFile(Utilities.newBlob(bytes, mimeType || 'application/octet-stream', safe));
  try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { id: file.getId(), url: file.getUrl(), name: file.getName() };
}

function provisionProjectTree(projectName, projectId) {
  var safe = String(projectName || 'Project').replace(/[\\/:*?"<>|]/g, ' ').trim();
  var rootName = safe + '_' + projectId, parent = getRootFolder_();
  var ex = parent.getFoldersByName(rootName);
  var root = ex.hasNext() ? ex.next() : parent.createFolder(rootName);
  shareFolder_(root);
  var sub = {};
  for (var i = 0; i < PROJECT_SUBFOLDERS.length; i++) {
    var name = PROJECT_SUBFOLDERS[i], it = root.getFoldersByName(name);
    var f = it.hasNext() ? it.next() : root.createFolder(name);
    sub[name] = { id: f.getId(), url: f.getUrl() };
  }
  return { root: { id: root.getId(), url: root.getUrl() }, sub: sub };
}
