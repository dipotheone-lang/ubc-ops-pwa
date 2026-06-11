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
