import crypto from 'node:crypto';
import {planPlantingProgress} from './planting-progress-plan.js';

// Produces a preview only. The actual records, including dated source rows,
// stay in lahan_harian; GIS keeps one block-level planting group and history.
export function previewPlantingSync(db, registry, asOf) {
 const catalog=registry.catalog(asOf);
 const plan=planPlantingProgress(catalog.blocks,db.prepare('SELECT * FROM lahan_harian').all(),asOf);
 // A formerly managed block can have its final actual removed. Keep it in the
 // plan so its previously synchronized quantity cannot remain silently stale.
 const managed=db.prepare("SELECT k,v FROM _settings WHERE k LIKE 'planting-progress:%'").all();
 for(const item of managed){
  const id=item.k.slice('planting-progress:'.length),block=catalog.blocks.find(b=>b.id===id);
  if(!block)throw Object.assign(new Error('Blok GIS terkelola tidak ditemukan.'),{status:409});
  if(!block.active||block.commodity!=='Pisang')throw Object.assign(new Error('Blok GIS terkelola tidak aktif atau komoditasnya berubah.'),{status:409});
  if(plan.some(p=>p.id===block.id))continue;
  const prior=JSON.parse(item.v),group=block.plantings.find(p=>p.id===prior.id);
  if(!group)throw Object.assign(new Error('Kelompok GIS terkelola tidak ditemukan.'),{status:409});
  plan.push({id:block.id,name:block.name,gisHa:block.gis_area_ha,actual:[],actualHa:0,cappedHa:0,matchedDays:0,exceedsGIS:false});
 }
 const statements=[];
 for(const p of plan){
  const block=catalog.blocks.find(b=>b.id===p.id);
  const setting=db.prepare('SELECT v FROM _settings WHERE k=?').get('planting-progress:'+block.id);
  const state=setting?JSON.parse(setting.v):null;
  const group=state?block.plantings.find(x=>x.id===state.id):block.plantings.length===1?block.plantings[0]:null;
  let reason=null;
  if(p.issue)reason=p.issue;
  else if(!group && (state || block.plantings.length))reason='Kelompok tanam GIS tidak tunggal atau tidak ditemukan.';
  else if(state && (group.id!==state.id || (group.version!==state.version && (group.planted_on!==state.date || Number(group.population)!==state.population || group.closed_on))))reason='Kelompok GIS telah direvisi; perlu dicocokkan kembali.';
  else if(!state && group && (!/^pisang_blok:\d+$/.test(group.source_key||'') || group.version!==1))reason='Kelompok GIS bukan data awal yang dapat dicocokkan otomatis.';
  else if(!state && group?.planted_on && group.planted_on!==p.actual?.[0]?.date && Math.abs(Number(group.population)-p.cappedHa*2000)>1e-6)reason='Tanggal awal dan jumlah GIS berbeda dari realisasi.';
  else if(p.exceedsGIS)reason='Realisasi lebih besar dari batas GIS.';
  const population=Math.floor((p.cappedHa+1e-10)*2000);
  statements.push({block_id:block.id,name:block.name,group_id:group?.id||null,expected_version:group?.version||null,
   date:p.actual?.[0]?.date||null,population,actual_ha:p.actualHa,gis_ha:p.gisHa,
   original_population:group?.population??null,matched_days:p.matchedDays,reason});
 }
 statements.sort((a,b)=>a.name.localeCompare(b.name,'id',{numeric:true}));
 const token=crypto.createHash('sha256').update(JSON.stringify(statements)).digest('hex');
 return {token,statements};
}

// The caller must wrap this in the same transaction as its source change.
export function applyPlantingSync(db,registry,preview,token) {
 if(preview.token!==token)throw Object.assign(new Error('Data berubah sejak pemeriksaan. Muat ulang dan periksa lagi.'),{status:409});
 const blocked=preview.statements.filter(s=>s.reason);
 if(blocked.length)throw Object.assign(new Error('Sinkronisasi perlu pemeriksaan: '+blocked.map(s=>s.name+' — '+s.reason).join('; ')),{status:409});
 let changed=0;
 for(const s of preview.statements){
  const g=s.group_id?registry.plantings().find(x=>x.id===s.group_id):null;
  if(s.group_id&&(!g||g.version!==s.expected_version))throw Object.assign(new Error('Kelompok GIS berubah saat disimpan.'),{status:409});
  let saved=g;
  if(!g||g.planted_on!==s.date||Number(g.population)!==s.population){
   saved=registry.savePlanting({...g,block_id:s.block_id,commodity:'Pisang',label:g?.label||'Realisasi tanam',planted_on:s.date,population:s.population,...(g?{expected_version:g.version}:{}),reason:'Sinkronisasi realisasi Tanam admin'});changed++;
  }
  const k='planting-progress:'+s.block_id,v=JSON.stringify({id:saved.id,version:saved.version,date:saved.planted_on,population:saved.population});
  db.prepare('INSERT INTO _settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,v);
 }
 return {changed,blocks:preview.statements.length};
}

export function syncPendingLand(db,registry,statements,asOf,tx){
 if(!statements.some(x=>/\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*\blahan_harian\b/i.test(x.sql)))return null;
 if(db.prepare('SELECT v FROM _settings WHERE k=?').get('planting-sync-enabled')?.v!=='1')return null;
 const p=previewPlantingSync(db,registry,asOf);
 return tx(()=>applyPlantingSync(db,registry,p,p.token));
}
