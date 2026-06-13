/** verify-depth.mjs — exercise doc.update/void, project.workspace, file.upload. */
const exec = process.argv[2];
async function p(o, n) {
  for (let i = 0; i < (n || 6); i++) {
    try { const r = await fetch(exec, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(o) }); return JSON.parse(await r.text()); }
    catch (e) { await new Promise(s => setTimeout(s, 2500)); }
  }
  return { ok: false, err: 'network' };
}
const L = (n, o) => console.log(n.padEnd(26), JSON.stringify(o));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async () => {
  const l = await p({ action: 'auth.login', email: 'admin@ubcsis.com', password: 'UbcAdmin#2026' });
  const t = l.data && l.data.token; L('login', { ok: l.ok }); if (!t) return;
  const prj = await p({ action: 'list', token: t, entity: 'projects' });
  const projId = prj.data[0].id;
  const mr = await p({ action: 'procurement.mr.create', token: t, record: { project_id: projId, priority: 'Normal', lines: [{ description: 'Test', unit: 'pc', qty: 1, est_unit_price: 100 }] } });
  const id = mr.data && mr.data.header.id; L('mr.create', { ok: mr.ok, id: !!id });
  const up = await p({ action: 'doc.update', token: t, entity: 'material_requisitions', id: id, patch: { priority: 'Urgent', cost_code: 'CC-TEST' } });
  L('doc.update (draft)', { ok: up.ok, priority: up.data && up.data.priority });
  const vd = await p({ action: 'doc.void', token: t, entity: 'material_requisitions', id: id, reason: 'test void' });
  L('doc.void', { ok: vd.ok, status: vd.data && vd.data.status });
  const up2 = await p({ action: 'doc.update', token: t, entity: 'material_requisitions', id: id, patch: { priority: 'Low' } });
  L('doc.update (voided)', { ok: up2.ok, err: up2.error && up2.error.code });
  const ws = await p({ action: 'project.workspace', token: t, project_id: projId });
  L('project.workspace', { ok: ws.ok, modules: ws.data && ws.data.counts.length, po_value: ws.data && ws.data.po_value });
  const fu = await p({ action: 'file.upload', token: t, project_id: projId, slot: 'site', fileName: 'test.png', mimeType: 'image/png', base64: PNG });
  L('file.upload', { ok: fu.ok, url: !!(fu.data && fu.data.url), err: fu.error && fu.error.code });
})();
