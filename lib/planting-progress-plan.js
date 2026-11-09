// Read-only reconciliation: do not modify either the GIS master or the source.
// Baselines and Daily records have independent histories and are never dated here.
export function planPlantingProgress(blocks, rows, asOf = new Date().toISOString().slice(0,10)) {
 const norm = value => String(value ?? '').trim().toLowerCase();
 const targets = new Map(), ids = new Map();
 for (const block of blocks) {
  if (!block.active || norm(block.commodity) !== 'pisang') continue;
  for(const key of new Set([block.name,...(block.aliases||[])].map(norm))){
   if(targets.has(key)&&targets.get(key)!==block)targets.set(key,null);else if(!targets.has(key))targets.set(key,block);
  }
  for(const id of new Set([block.id,...(block.parents||[])].filter(Boolean))){
   if(ids.has(id)&&ids.get(id)!==block)ids.set(id,null);else if(!ids.has(id))ids.set(id,block);
  }
 }
 const grouped = new Map();
 for (const row of rows) {
  if (norm(row.aktivitas) !== 'tanam' || row.daily_report_id || row.diganti_aktual || String(row.source_key || '').startsWith('baseline:')) continue;
  const block = (row.block_id && ids.get(row.block_id)) || targets.get(norm(row.blok)), key=block&&norm(block.name);
  if (!block) continue;
  const ha = Number(row.hasil_ha);
  const date = String(row.tanggal || ''), parsed = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(ha) || ha <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10)!==date || date>asOf) continue;
  if (!grouped.has(key)) grouped.set(key, {block, dates:new Map()});
  const dates = grouped.get(key).dates;
  dates.set(row.tanggal, (dates.get(row.tanggal) || 0) + ha);
 }
 return [...grouped.values()].map(({block, dates}) => {
  const area = Number(block.gis_area_ha);
  if (!Number.isFinite(area) || area <= 0) return {name:block.name, issue:'Luas GIS tidak tersedia'};
  const actual = [...dates].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,ha])=>({date,ha}));
  const total = actual.reduce((sum, item)=>sum+item.ha, 0);
  const existing=(block.plantings || []).map(p=>({id:p.id,source:p.source_key,version:p.version,date:p.planted_on,population:p.population,replacements:p.replacement_plants,losses:p.lost_plants}));
  // Counts remain a comparison, never a reason to silently overwrite GIS.
  // A legacy group may already contain several dated progress entries.
  const legacy=existing.length===1&&/^pisang_blok:\d+$/.test(existing[0].source||'')&&existing[0].version===1?existing[0]:null;
  let covered=0, matchedDays=0;
  if (legacy?.population != null && actual[0]?.date===legacy.date) {
   for (const a of actual) { covered+=a.ha*2000; matchedDays++; if(Math.abs(covered-legacy.population)<1e-6) break; }
   if(Math.abs(covered-legacy.population)>=1e-6) matchedDays=0;
  }
  const issues=[];
  if(total > area + 1e-8)issues.push('Realisasi melebihi batas GIS');
  if(!legacy)issues.push('Kelompok GIS perlu dicocokkan secara manual');
  if(legacy && (legacy.replacements!=null||legacy.losses!=null))issues.push('Riwayat sulam atau kehilangan harus dipertahankan');
  if(legacy?.population!=null&&!matchedDays)issues.push('Jumlah GIS belum cocok dengan tanggal realisasi');
  return {name:block.name, gisHa:area, actual, actualHa:total, cappedHa:Math.min(area,total),
   exceedsGIS:total > area + 1e-8, existing, matchedDays, issues};
 });
}
