/**
 * Code.gs
 * ---------------------------------------------------------------------------
 * HTTP entry points for the Headless REST API (Apps Script Web App).
 *
 *  GET  ?action=ping|schema|list|get|lowstock&...        (reads)
 *  POST { action, token, ... }                            (reads + writes)
 *
 * Every response is the standard envelope: { ok, ts, data | error }.
 * Writes require a valid token (CONFIG.REQUIRE_TOKEN) and run under a script
 * lock inside the Database layer.
 * ---------------------------------------------------------------------------
 */

/** GET handler — read-only + health. */
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var action = p.action || 'ping';

    switch (action) {
      case 'ping':
        return ok({ service: 'UBC Operations API', version: '1.0.0', time: nowIso() });

      case 'schema':
        return ok(publicSchema_());

      case 'entities':
        return ok(listEntities());

      case 'list': {
        requireFields(p, ['entity']);
        var filter = p.filter ? JSON.parse(p.filter) : null;
        return ok(dbList(p.entity, filter));
      }

      case 'get': {
        requireFields(p, ['entity', 'id']);
        var row = dbGet(p.entity, p.id);
        if (!row) throw new AppError('NOT_FOUND', 'Record not found.', 404);
        return ok(row);
      }

      case 'lowstock':
        return ok(Warehouse.lowStock(p.project_id || null));

      default:
        throw new AppError('UNKNOWN_ACTION', 'Unknown GET action: ' + action);
    }
  } catch (err) {
    return fail(err);
  }
}

/** POST handler — the main command surface. */
function doPost(e) {
  try {
    var body = parseBody(e);
    var action = body.action;
    if (!action) throw new AppError('VALIDATION', 'Missing "action".');

    // Read actions are allowed without a token; everything else is gated.
    var readOnly = { 'list': 1, 'get': 1, 'schema': 1, 'ping': 1, 'lowstock': 1, 'sync.pull': 1 };
    if (!readOnly[action]) assertToken(body);

    var actor = body.actor || (body.token ? 'app' : 'anonymous');

    return ok(dispatch_(action, body, actor));
  } catch (err) {
    return fail(err);
  }
}

/** Route an action string to its handler and return raw data. */
function dispatch_(action, body, actor) {
  switch (action) {

    /* ---- health / meta ---- */
    case 'ping':   return { pong: true, time: nowIso() };
    case 'schema': return publicSchema_();

    /* ---- generic CRUD (any entity) ---- */
    case 'list':   requireFields(body, ['entity']); return dbList(body.entity, body.filter || null);
    case 'get':    requireFields(body, ['entity', 'id']); return dbGet(body.entity, body.id);
    case 'create': requireFields(body, ['entity', 'record']);
                   return dbInsert(body.entity, body.record, actor);
    case 'update': requireFields(body, ['entity', 'id', 'patch']);
                   return dbUpdate(body.entity, body.id, body.patch, actor);
    case 'delete': requireFields(body, ['entity', 'id']);
                   return dbDelete(body.entity, body.id);

    /* ---- projects + drive ---- */
    case 'project.create': return createProjectWithDrive(body.record || body, actor);
    case 'project.reprovision': {
      requireFields(body, ['id']);
      var p = dbGet('projects', body.id);
      if (!p) throw new AppError('NOT_FOUND', 'Project not found.', 404);
      var tree = provisionProjectTree(p.project_name, p.id);
      return dbUpdate('projects', p.id, {
        drive_root_id: tree.root.id, drive_root_url: tree.root.url,
        folder_procurement_url: tree.sub['01_Procurement_Requests'].url,
        folder_technical_url: tree.sub['02_Technical_Office_Submittals'].url,
        folder_accounting_url: tree.sub['03_Accounting_Invoices_Receipts'].url,
        folder_warehouse_url: tree.sub['04_Warehouse_MTRs_GRNs'].url,
        folder_site_url: tree.sub['05_Site_As_Built_Evidence'].url
      }, actor);
    }

    /* ---- procurement ---- */
    case 'procurement.requisition': return Procurement.createRequisition(body, actor);
    case 'procurement.po':          return Procurement.createPurchaseOrder(body, actor);
    case 'procurement.price':       return Procurement.logPrice(body, actor);

    /* ---- technical office ---- */
    case 'tech.progress':  return TechnicalOffice.logProgress(body, actor);
    case 'tech.takeoff':   return TechnicalOffice.addTakeoff(body, actor);
    case 'tech.milestone': return TechnicalOffice.signoffMilestone(body, actor);

    /* ---- accounting ---- */
    case 'acc.expense':        return Accounting.logExpense(body, actor);
    case 'acc.subpayment':     return Accounting.recordSubcontractorPayment(body, actor);
    case 'acc.receipt':        return Accounting.saveReceipt(body, actor);

    /* ---- warehouse ---- */
    case 'wh.mtr':       return Warehouse.createMTR(body, actor);
    case 'wh.grn':       return Warehouse.createGRN(body, actor);
    case 'wh.stock':     return Warehouse.upsertStockItem(body, actor);
    case 'wh.lowstock':  return Warehouse.lowStock(body.project_id || null);

    /* ---- files / drive uploads ---- */
    case 'file.uploadToProject': {
      requireFields(body, ['project_id', 'slot', 'fileName', 'base64']);
      var folderId = projectFolderId(body.project_id, body.slot);
      return uploadBase64ToFolder(folderId, body.fileName, body.mimeType, body.base64);
    }
    case 'file.upload': {
      requireFields(body, ['folderId', 'fileName', 'base64']);
      return uploadBase64ToFolder(body.folderId, body.fileName, body.mimeType, body.base64);
    }
    case 'upload.begin':  return beginUpload(body.meta || body);
    case 'upload.chunk':  return appendChunk(body.uploadId, body.index, body.chunk);
    case 'upload.finish': return finishUpload(body.uploadId);

    /* ---- offline sync (batch) ---- */
    case 'sync.push': return syncPush_(body, actor);

    default:
      throw new AppError('UNKNOWN_ACTION', 'Unknown action: ' + action);
  }
}

/**
 * Batch offline-queue ingestion. Each op is processed independently so one
 * bad capture never blocks the rest. Idempotent via client_uuid.
 * body.ops = [ { op_id, action, payload }, ... ]
 */
function syncPush_(body, actor) {
  var ops = Array.isArray(body.ops) ? body.ops : [];
  var results = [];
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    try {
      var data = dispatch_(op.action, op.payload || {}, actor);
      results.push({ op_id: op.op_id, ok: true, data: data });
    } catch (err) {
      results.push({
        op_id: op.op_id, ok: false,
        error: { code: (err && err.code) || 'INTERNAL', message: (err && err.message) || String(err) }
      });
    }
  }
  return { processed: results.length, results: results };
}

/** Schema without internal flags — safe to expose to the client. */
function publicSchema_() {
  var out = {};
  var names = listEntities();
  for (var i = 0; i < names.length; i++) {
    var s = SCHEMA[names[i]];
    out[names[i]] = { sheet: s.sheet, columns: s.columns, enums: s.enums || {}, fk: s.fk || {} };
  }
  return out;
}
