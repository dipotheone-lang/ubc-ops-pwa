/**
 * DriveService.gs
 * ---------------------------------------------------------------------------
 * Programmatic Drive provisioning + file/image intake.
 *
 *  - provisionProjectTree(): creates [Name]_[UUID] root + 5 sub-folders,
 *    sets corporate-readable sharing, returns all folder URLs/IDs.
 *  - uploadBase64ToFolder(): writes a single base64 blob to a folder.
 *  - Chunked upload protocol (beginUpload / appendChunk / finishUpload):
 *    large files (>2MB) are streamed in pieces, cached, then assembled —
 *    bypassing the single-request payload ceiling.
 * ---------------------------------------------------------------------------
 */

/** Resolve (or lazily create) the global root folder that holds all projects. */
function getRootFolder_() {
  var id = prop('ROOT_FOLDER_ID', CONFIG.ROOT_FOLDER_ID);
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { /* fall through and recreate */ }
  }
  // Reuse by name if it exists, else create.
  var it = DriveApp.getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.ROOT_FOLDER_NAME);
  PropertiesService.getScriptProperties().setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

/** Make a folder readable to anyone in the domain with the link. */
function shareFolder_(folder) {
  try {
    folder.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // Personal Gmail accounts have no domain; fall back to link sharing.
    try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (e2) { /* leave private if both fail */ }
  }
}

/**
 * Create the full directory tree for a project.
 * @param {string} projectName
 * @param {string} projectId UUID
 * @return {Object} { root:{id,url}, sub:{ '01_...':{id,url}, ... } }
 */
function provisionProjectTree(projectName, projectId) {
  var safeName = String(projectName || 'Project').replace(/[\\/:*?"<>|]/g, ' ').trim();
  var rootName = safeName + '_' + projectId;
  var parent = getRootFolder_();

  // Idempotent: if a folder with this exact name already exists, reuse it.
  var existing = parent.getFoldersByName(rootName);
  var root = existing.hasNext() ? existing.next() : parent.createFolder(rootName);
  shareFolder_(root);

  var sub = {};
  for (var i = 0; i < PROJECT_SUBFOLDERS.length; i++) {
    var name = PROJECT_SUBFOLDERS[i];
    var it = root.getFoldersByName(name);
    var f = it.hasNext() ? it.next() : root.createFolder(name);
    sub[name] = { id: f.getId(), url: f.getUrl() };
  }

  return {
    root: { id: root.getId(), url: root.getUrl() },
    sub: sub
  };
}

/** Map a subfolder slot key to its folder URL within a provisioned tree. */
function folderUrlFor_(tree, slot) {
  var map = {
    procurement: '01_Procurement_Requests',
    technical: '02_Technical_Office_Submittals',
    accounting: '03_Accounting_Invoices_Receipts',
    warehouse: '04_Warehouse_MTRs_GRNs',
    site: '05_Site_As_Built_Evidence'
  };
  var name = map[slot];
  return name && tree.sub[name] ? tree.sub[name] : null;
}

/** Find a project's sub-folder by id; returns a DriveApp Folder. */
function resolveProjectFolder_(folderId) {
  if (!folderId) throw new AppError('VALIDATION', 'folderId is required for upload.');
  try {
    return DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new AppError('FOLDER_NOT_FOUND', 'Drive folder ' + folderId + ' not accessible.', 404);
  }
}

/**
 * Decode a base64 string (optionally a data: URL) and store as a file.
 * @return {Object} { id, url, name }
 */
function uploadBase64ToFolder(folderId, fileName, mimeType, base64) {
  if (!base64) throw new AppError('VALIDATION', 'No file content provided.');
  var clean = String(base64).replace(/^data:[^;]+;base64,/, '');
  if (clean.length > CONFIG.MAX_BASE64_CHARS) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'File exceeds maximum size.', 413);
  }
  var bytes;
  try {
    bytes = Utilities.base64Decode(clean);
  } catch (e) {
    throw new AppError('BAD_BASE64', 'File content is not valid base64.');
  }
  var folder = resolveProjectFolder_(folderId);
  var safe = String(fileName || ('upload_' + uuid())).replace(/[\\/:*?"<>|]/g, '_');
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', safe);
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { /* non-fatal */ }
  return { id: file.getId(), url: file.getUrl(), name: file.getName() };
}

/* ---------------------- CHUNKED UPLOAD PROTOCOL ------------------------- */
/*
 * Client splits a large base64 payload into ordered chunks. Each chunk is
 * cached server-side (CacheService, 1h) keyed by uploadId. finishUpload
 * concatenates in order and writes one Drive file. This avoids holding the
 * whole file in a single request body and survives the 6-min execution limit
 * by spreading work across calls.
 */

function beginUpload(meta) {
  requireFields(meta, ['fileName', 'totalChunks', 'folderId']);
  var uploadId = uuid();
  var cache = CacheService.getScriptCache();
  cache.put('UP_META_' + uploadId, JSON.stringify({
    fileName: meta.fileName,
    mimeType: meta.mimeType || 'application/octet-stream',
    totalChunks: Number(meta.totalChunks),
    folderId: meta.folderId,
    received: 0
  }), 3600);
  return { uploadId: uploadId };
}

function appendChunk(uploadId, index, chunkB64) {
  if (!uploadId) throw new AppError('VALIDATION', 'uploadId required.');
  var cache = CacheService.getScriptCache();
  var metaRaw = cache.get('UP_META_' + uploadId);
  if (!metaRaw) throw new AppError('UPLOAD_EXPIRED', 'Upload session expired or unknown.', 410);
  var clean = String(chunkB64 || '').replace(/^data:[^;]+;base64,/, '');
  // Cache value cap is 100KB/key; chunks must be sized accordingly client-side.
  cache.put('UP_CHUNK_' + uploadId + '_' + index, clean, 3600);
  var meta = JSON.parse(metaRaw);
  meta.received = Math.max(meta.received, Number(index) + 1);
  cache.put('UP_META_' + uploadId, JSON.stringify(meta), 3600);
  return { index: Number(index), received: meta.received };
}

function finishUpload(uploadId) {
  if (!uploadId) throw new AppError('VALIDATION', 'uploadId required.');
  var cache = CacheService.getScriptCache();
  var metaRaw = cache.get('UP_META_' + uploadId);
  if (!metaRaw) throw new AppError('UPLOAD_EXPIRED', 'Upload session expired or unknown.', 410);
  var meta = JSON.parse(metaRaw);

  var keys = [];
  for (var i = 0; i < meta.totalChunks; i++) keys.push('UP_CHUNK_' + uploadId + '_' + i);
  var parts = cache.getAll(keys);

  var combined = '';
  for (var j = 0; j < meta.totalChunks; j++) {
    var part = parts['UP_CHUNK_' + uploadId + '_' + j];
    if (part === undefined || part === null) {
      throw new AppError('CHUNK_MISSING', 'Missing chunk ' + j + ' of ' + meta.totalChunks + '.');
    }
    combined += part;
  }

  var result = uploadBase64ToFolder(meta.folderId, meta.fileName, meta.mimeType, combined);

  // Best-effort cleanup.
  cache.remove('UP_META_' + uploadId);
  cache.removeAll(keys);
  return result;
}
