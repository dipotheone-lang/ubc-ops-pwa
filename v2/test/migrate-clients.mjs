/** migrate-clients.mjs — import UBC's real client roster via admin.import.
 * Idempotent (keyField=client_code): re-runnable; skips the 7 seeded anchors.
 *   node v2/test/migrate-clients.mjs <execUrl>
 */
const exec = process.argv[2];
async function p(o, tries) {
  for (let i = 0; i < (tries || 5); i++) {
    try { const r = await fetch(exec, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(o) }); return JSON.parse(await r.text()); }
    catch (e) { await new Promise(s => setTimeout(s, 2000)); }
  }
  return { ok: false, err: 'network' };
}
// Real clients (from operational-archive analysis). sector is free text.
const CLIENTS = [
  ['GCE', 'Galaxy Chemicals Egypt', 'جالاكسي كيماويات مصر', 'chemicals'],
  ['SMNS', 'Siemens Energy', 'سيمنس للطاقة', 'energy'],
  ['ENOVA', 'ENOVA (Veolia)', 'إينوفا', 'facilities'],
  ['AIRL', 'Air Liquide', 'إير ليكيد', 'chemicals'],
  ['MSF', 'Masafi', 'مسافي', 'food'],
  ['EFIC', 'EFIC Suez Fertilizers', 'إيفيك للأسمدة', 'chemicals'],
  ['ARMA', 'ARMA Food Industries', 'أرما للصناعات الغذائية', 'food'],
  ['GHB', 'Ghabbour Auto', 'غبور أوتو', 'industrial'],
  ['IVL', 'IVL / Indorama', 'إندوراما', 'chemicals'],
  ['SAI', 'SA International', 'إس إيه إنترناشونال', 'construction'],
  ['SUST', 'Suez Steel', 'السويس للصلب', 'steel'],
  ['TITN', 'Titan Cement', 'تيتان للأسمنت', 'cement'],
  ['SVL', 'Savola', 'سافولا', 'food'],
  ['IFFCO', 'IFFCO Egypt', 'إيفكو مصر', 'food'],
  ['JSHI', 'Jushi Egypt (Fiberglass)', 'جوشي مصر', 'glass'],
  ['LFRG', 'Lafarge / Holcim', 'لافارچ', 'cement'],
  ['HYT', 'Hayat Egypt', 'حياة مصر', 'fmcg'],
  ['SGGE', 'Saint-Gobain Glass Egypt', 'سان جوبان للزجاج', 'glass'],
  ['EGS', 'Egypt Global Silicates (Kiran)', 'الشركة المصرية للسيليكات', 'mining'],
  ['EZZ', 'EZZ Steel', 'حديد عز', 'steel'],
  ['NSTL', 'Nestlé Waters', 'نستله ووترز', 'food'],
  ['ARBS', 'Arabian Steel', 'الصلب العربي', 'steel'],
  ['SUK', 'Centamin / Sukari Gold Mine', 'سنتامين - منجم السكري', 'mining'],
  ['KNF', 'KNAUF', 'كناوف', 'construction'],
  ['JHN', 'Juhayna', 'جهينة', 'food'],
  ['SILO', 'Silo Foods Egypt', 'سايلو فودز', 'food'],
  ['GSK', 'GSK', 'جلاكسو سميث كلاين', 'pharma'],
  ['CSU', 'Canal Sugar', 'القناة للسكر', 'sugar']
].map(c => ({ client_code: c[0], name_en: c[1], name_ar: c[2], sector: c[3], status: 'Active' }));

(async () => {
  const l = await p({ action: 'auth.login', email: 'admin@ubcsis.com', password: 'UbcAdmin#2026' });
  if (!l.data) { console.log('login failed', JSON.stringify(l)); return; }
  console.log('login ok, importing', CLIENTS.length, 'clients…');
  const r = await p({ action: 'admin.import', token: l.data.token, entity: 'clients', rows: CLIENTS, keyField: 'client_code' });
  console.log('import result:', JSON.stringify(r.data || r.error || r));
  const cl = await p({ action: 'list', token: l.data.token, entity: 'clients' });
  console.log('total clients now:', cl.data && cl.data.length);
})();
