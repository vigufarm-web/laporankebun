import {createParcelLocations} from './gis-ownership.js';
import {scopePlantingData} from './planting-scope.js';
import {susunRencana} from '../public/js/schema.js';
import crypto from 'node:crypto';
const norm=v=>String(v||'').trim().toLowerCase();
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const micro=x=>Math.round(Number(x||0)*1e6);
export const landStages=['Cabut Ajir','Cabut Mulsa','Gulung Drip','Land Clearing','Bajak 1','Dolomite','Bajak 2','Stik Ridger','Ridger','Install Drip','Stik Tanam','Ecer Pupuk','Tanam'];
export function landAreas(db){
 const areas=new Map();
 for(const layer of db.prepare("SELECT geojson FROM gis_layer WHERE nama='Blok Tanam'").all()){
  const fc=JSON.parse(layer.geojson||'{}');for(const f of fc.features||[]){const p=f.properties||{},name=p.Nama_Blok||p.nama_blok;const area=Number(p.Shape_Area||p.Area_New||0)/10000;if(name&&area>0)areas.set(norm(name),(areas.get(norm(name))||0)+area);}
 }
 try{for(const b of db.prepare('SELECT nama,luas_ha FROM _blocks WHERE active=1').all())if(!areas.has(norm(b.nama))&&Number(b.luas_ha)>0)areas.set(norm(b.nama),Number(b.luas_ha));}catch{}
 for(const b of db.prepare('SELECT blok,luas_ha FROM lahan_blok').all())if(!areas.has(norm(b.blok)))areas.set(norm(b.blok),Number(b.luas_ha)||0);
 return areas;
}
export function capLandRows(db,now){
 const areas=landAreas(db),used=new Map();let adjusted=0;
 for(const b of db.prepare('SELECT * FROM lahan_blok').all()){const area=areas.get(norm(b.blok));if(area>0&&micro(area)!==micro(b.luas_ha)){db.prepare('INSERT INTO _import_revisions(table_name,row_id,before_json,created_at) VALUES(?,?,?,?)').run('lahan_blok',b.id,JSON.stringify(b),now());db.prepare('UPDATE lahan_blok SET luas_ha=?,updated_at=? WHERE id=?').run(area,now(),b.id);}}
 for(const r of db.prepare('SELECT * FROM lahan_harian ORDER BY CASE WHEN daily_report_id IS NULL THEN 0 ELSE 1 END,tanggal,id').all()){
  const raw=r.hasil_input_ha==null?Number(r.hasil_ha||0):Number(r.hasil_input_ha),key=norm(r.blok)+'|'+norm(r.aktivitas),limit=micro(areas.get(norm(r.blok))||0),prior=used.get(key)||0;
  const effective=r.diganti_aktual?0:limit>0?Math.min(micro(raw),Math.max(0,limit-prior)):micro(raw);
  if(!r.diganti_aktual)used.set(key,prior+effective);
  if(r.hasil_input_ha==null||micro(r.hasil_ha)!==effective){db.prepare('UPDATE lahan_harian SET hasil_input_ha=?,hasil_ha=?,updated_at=? WHERE id=?').run(raw,effective/1e6,now(),r.id);if(micro(raw)!==effective)adjusted++;}
 }
 for(const source of db.prepare('SELECT * FROM lahan_harian WHERE daily_report_id IS NOT NULL AND COALESCE(diganti_aktual,0)=0 ORDER BY tanggal,id').all()){
  let remaining=Math.min(micro(areas.get(norm(source.blok))||Infinity),micro(source.hasil_ha)+micro(coveredLand(db,source.daily_report_id,source.blok,source.aktivitas)));const items=db.prepare('SELECT * FROM daily_item WHERE report_id=? ORDER BY urutan,id').all(source.daily_report_id).filter(r=>r.satuan==='ha'&&stageForDaily(r.aktivitas)===source.aktivitas&&norm(r.blok)===norm(source.blok));
  for(const r of items){const raw=Number(r.realisasi_input??r.realisasi),value=Math.min(micro(raw),remaining);remaining-=value;if(r.realisasi_input==null||micro(r.realisasi)!==value)db.prepare('UPDATE daily_item SET realisasi_input=?,realisasi=? WHERE id=?').run(raw,value/1e6,r.id);}
 }
 return {adjusted};
}
export function importLand({db,tx,blocks,insertRow,now,actor},body){
 const source=body.payload;if(!source||!Array.isArray(source.rows)||source.rows.length<1||source.rows.length>2000)throw new Error('Paket aktual tidak valid');
 const rows=source.rows.map((x,i)=>{
  const r={tanggal:String(x.tanggal||''),aktivitas:String(x.aktivitas||''),blok:String(x.blok||''),hasil_ha:Number(x.hasil_ha),source_row:Number(x.row)||i+1,record_kind:x.record_kind==='baseline'?'baseline':'actual',date_basis:x.date_basis?String(x.date_basis).slice(0,500):null};
  if((!/^\d{4}-\d{2}-\d{2}$/.test(r.tanggal)||!Number.isFinite(Date.parse(r.tanggal)))||!landStages.includes(r.aktivitas)||!r.blok||!Number.isFinite(r.hasil_ha)||r.hasil_ha<0)throw new Error('Aktual baris '+r.source_row+' tidak valid');return r;
 });
 const old=db.prepare('SELECT * FROM lahan_harian ORDER BY id').all(),areaState=[...landAreas(db)],plans=db.prepare('SELECT * FROM lahan_rencana ORDER BY id').all(),fingerprint=hash(rows),token=hash({rows,old,areaState,plans});
 db.exec('CREATE TABLE IF NOT EXISTS _land_actual_batches(fingerprint TEXT PRIMARY KEY,created_at TEXT,actor TEXT,source_json TEXT,result_json TEXT)');
 const prior=db.prepare('SELECT result_json FROM _land_actual_batches WHERE fingerprint=?').get(fingerprint);if(prior)return {...JSON.parse(prior.result_json),already_applied:true};
 const key=r=>r.tanggal+'|'+norm(r.blok)+'|'+norm(r.aktivitas),available=new Map();for(const r of old.filter(x=>!x.diganti_aktual)){const k=key(r);available.set(k,[...(available.get(k)||[]),r]);}
 const matched=new Set(),actions=[];
 for(const r of rows){const candidates=(available.get(key(r))||[]).filter(x=>String(x.source_key||'').startsWith('baseline:')===(r.record_kind==='baseline'));let match=candidates.find(x=>!matched.has(x.id)&&micro(x.hasil_input_ha??x.hasil_ha)===micro(r.hasil_ha));match ||= candidates.find(x=>!matched.has(x.id));if(match)matched.add(match.id);actions.push({row:r,old:match||null,action:!match?'Tambah':micro(match.hasil_input_ha??match.hasil_ha)!==micro(r.hasil_ha)?'Perbarui':'Sama'});}
 const blocksInSource=new Set(rows.map(x=>norm(x.blok))),through=rows.map(x=>x.tanggal).sort().at(-1);
 const includesBaseline=rows.some(r=>r.record_kind==='baseline');
 const superseded=old.filter(r=>(includesBaseline||!String(r.source_key||'').startsWith('baseline:'))&&!r.diganti_aktual&&!matched.has(r.id)&&r.tanggal<=through&&blocksInSource.has(norm(r.blok))&&landStages.includes(r.aktivitas));
 const result={sourceRows:rows.length,actualRows:rows.filter(r=>r.record_kind==='actual').length,baselineRows:rows.filter(r=>r.record_kind==='baseline').length,added:actions.filter(x=>x.action==='Tambah').length,updated:actions.filter(x=>x.action==='Perbarui').length,unchanged:actions.filter(x=>x.action==='Sama').length,superseded:superseded.length,through};
 if(body.mode!=='apply')return {token,result,preview:actions.filter(x=>x.action!=='Sama').map(x=>({...x.row,action:x.action}))};
 if(body.token!==token){const e=new Error('Data berubah. Periksa ulang sebelum menerapkan.');e.status=409;throw e;}
 tx(()=>{
  db.exec('CREATE TABLE IF NOT EXISTS _import_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT,row_id INTEGER,before_json TEXT,created_at TEXT)');
  const save=r=>db.prepare('INSERT INTO _import_revisions(table_name,row_id,before_json,created_at) VALUES(?,?,?,?)').run('lahan_harian',r.id,JSON.stringify(r),now());
  for(const stage of landStages.slice(0,3))if(!db.prepare('SELECT 1 FROM lahan_aktivitas WHERE aktivitas=?').get(stage))insertRow('lahan_aktivitas',{aktivitas:stage,untuk:'Persiapan',urutan:landStages.indexOf(stage)+1},false);
  for(const a of actions){const r=a.row;if(a.old){if(a.action==='Perbarui'){save(a.old);db.prepare('UPDATE lahan_harian SET hasil_input_ha=?,hasil_ha=?,source_key=?,diganti_aktual=0,updated_at=? WHERE id=?').run(r.hasil_ha,r.hasil_ha,r.record_kind+':'+fingerprint+':'+r.source_row,now(),a.old.id);}else db.prepare('UPDATE lahan_harian SET source_key=?,diganti_aktual=0,updated_at=? WHERE id=?').run(r.record_kind+':'+fingerprint+':'+r.source_row,now(),a.old.id);}else insertRow('lahan_harian',{tanggal:r.tanggal,aktivitas:r.aktivitas,blok:r.blok,hasil_ha:r.hasil_ha,hasil_input_ha:r.hasil_ha,source_key:r.record_kind+':'+fingerprint+':'+r.source_row,diganti_aktual:0,keterangan:r.date_basis},false);}
  for(const r of superseded){save(r);db.prepare('UPDATE lahan_harian SET hasil_input_ha=?,hasil_ha=0,diganti_aktual=1,updated_at=? WHERE id=?').run(r.hasil_input_ha??r.hasil_ha,now(),r.id);}
  for(const [name,area] of areaState){const b=db.prepare('SELECT * FROM lahan_blok WHERE lower(trim(blok))=?').get(name);if(b&&micro(b.luas_ha)!==micro(area)){db.prepare('INSERT INTO _import_revisions(table_name,row_id,before_json,created_at) VALUES(?,?,?,?)').run('lahan_blok',b.id,JSON.stringify(b),now());db.prepare('UPDATE lahan_blok SET luas_ha=?,updated_at=? WHERE id=?').run(area,now(),b.id);}}
  capLandRows(db,now);blocks.linkTable('lahan_harian');
  const next=new Date(through+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);const today=new Date(Date.parse(now())+7*3600e3).toISOString().slice(0,10);rebuildLandSchedule(db,insertRow,now,[next.toISOString().slice(0,10),today].sort().at(-1));
  db.prepare('INSERT OR REPLACE INTO _settings(k,v) VALUES(?,?)').run('land-prep:actual-through',through);
  db.prepare('INSERT INTO _land_actual_batches VALUES(?,?,?,?,?)').run(fingerprint,now(),actor,JSON.stringify(source),JSON.stringify(result));
 });return result;
}
const stageKey=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function stageForDaily(value){const key=stageKey(value),stage=landStages.find(s=>stageKey(s)===key);return stage||({lc:'Land Clearing',landclearance:'Land Clearing',bajakridger:'Ridger',dolomit:'Dolomite',bajakdiscploughtahap1:'Bajak 1',bajakdiscploughtahap2:'Bajak 2',pasangstikridger:'Stik Ridger',pasangstiktanam:'Stik Tanam',bedder:'Ridger',instalasiirigasi:'Install Drip',instalasidrip:'Install Drip'})[key]||null;}
export function saveDailyLand(db,reportId,now,insertRow){
 const report=db.prepare('SELECT * FROM daily_report WHERE id=?').get(reportId);
 if(!report||report.divisi==='Padi')return {adjusted:0};
 const all=db.prepare('SELECT * FROM daily_item WHERE report_id=? ORDER BY urutan,id').all(reportId),groups=new Map(),availableAreas=landAreas(db);
 for(const r of report.status==='Selesai'?all:[]){const stage=stageForDaily(r.aktivitas);if(!stage||r.satuan!=='ha'||!r.blok||r.blok.includes(',')||r.realisasi==null)continue;if(!(availableAreas.get(norm(r.blok))>0)){const e=new Error('Luas blok GIS belum valid. Perbaiki luas blok sebelum mencatat hasil ha.');e.status=400;throw e;}const key=norm(r.blok)+'|'+stage;if(!groups.has(key))groups.set(key,{stage,blok:r.blok,items:[]});groups.get(key).items.push(r);}
 if(!groups.size&&!db.prepare('SELECT 1 FROM lahan_harian WHERE daily_report_id=? LIMIT 1').get(reportId))return {adjusted:0};
 db.prepare('UPDATE lahan_harian SET diganti_aktual=1,hasil_ha=0 WHERE daily_report_id=?').run(reportId);
 for(const g of groups.values()){
  const input=g.items.reduce((s,r)=>s+Number(r.realisasi_input??r.realisasi),0),covered=coveredLand(db,reportId,g.blok,g.stage),raw=Math.max(0,input-covered),prior=db.prepare('SELECT id FROM lahan_harian WHERE daily_report_id=? AND blok=? AND aktivitas=? ORDER BY id LIMIT 1').get(reportId,g.blok,g.stage);
  if(prior)db.prepare('UPDATE lahan_harian SET tanggal=?,hasil_input_ha=?,hasil_ha=?,diganti_aktual=0,updated_at=? WHERE id=?').run(report.tanggal,raw,raw,now(),prior.id);
  else if(raw>0)db.prepare('INSERT INTO lahan_harian(created_at,updated_at,tanggal,aktivitas,blok,hasil_ha,hasil_input_ha,daily_report_id,diganti_aktual) VALUES(?,?,?,?,?,?,?,?,0)').run(now(),now(),report.tanggal,g.stage,g.blok,raw,raw,reportId);
 }
 capLandRows(db,now);let adjusted=0;
 for(const g of groups.values()){
  const saved=db.prepare('SELECT hasil_ha FROM lahan_harian WHERE daily_report_id=? AND blok=? AND aktivitas=? AND COALESCE(diganti_aktual,0)=0').get(reportId,g.blok,g.stage);let left=Math.min(micro(availableAreas.get(norm(g.blok))),micro(saved?.hasil_ha)+micro(coveredLand(db,reportId,g.blok,g.stage)));
  for(const r of g.items){const raw=Number(r.realisasi_input??r.realisasi),value=Math.min(micro(raw),left)/1e6;left-=micro(value);if(micro(value)!==micro(raw))adjusted++;db.prepare('UPDATE daily_item SET realisasi_input=?,realisasi=? WHERE id=?').run(raw,value,r.id);}
 }
 if(insertRow){const next=new Date(report.tanggal+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);const today=new Date(Date.parse(now())+7*3600e3).toISOString().slice(0,10);rebuildLandSchedule(db,insertRow,now,[next.toISOString().slice(0,10),today].sort().at(-1));}
 return {adjusted};
}
export function rebuildLandSchedule(db,insertRow,now,from){
 let locations=null;
 if(db.prepare("SELECT 1 FROM gis_layer WHERE nama LIKE 'Persil Lahan%' LIMIT 1").get()){
  const registry={list:()=>db.prepare('SELECT id,nama,aliases,divisi,ownership,active,layer_id,luas_ha,updated_at FROM _blocks').all().map(r=>({...r,aliases:JSON.parse(r.aliases||'[]')}))};locations=createParcelLocations(db,registry,{includePartial:true})();
 }
 const tables=['lahan_blok','lahan_harian','lahan_aktivitas','lahan_target','lahan_rencana','pisang_blok','gis_layer'],data=Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM "'+t+'"').all()]));
 const today=new Date(Date.parse(now())+7*3600e3).toISOString().slice(0,10),scoped=locations?scopePlantingData(data,locations,today):data,ctx={rows:t=>(scoped[t]||[]).filter(r=>t!=='lahan_harian'||!r.diganti_aktual)};
 const next=susunRencana(ctx,from),previous=data.lahan_rencana;
 const week=new Date(from+'T00:00:00Z');week.setUTCDate(week.getUTCDate()-(week.getUTCDay()||7)+1);db.exec('CREATE TABLE IF NOT EXISTS _land_week_plan_snapshots(week_start TEXT PRIMARY KEY,created_at TEXT,rows_json TEXT)');db.prepare('INSERT OR IGNORE INTO _land_week_plan_snapshots VALUES(?,?,?)').run(week.toISOString().slice(0,10),now(),JSON.stringify(previous));
 const keys=['urutan','blok','aktivitas','luas_ha','mulai','selesai','keterangan'],plain=rows=>rows.map(r=>Object.fromEntries(keys.map(k=>[k,r[k]??null])));
 if(JSON.stringify(plain(next))===JSON.stringify(plain(previous)))return;
 db.exec('CREATE TABLE IF NOT EXISTS _land_schedule_revisions(id INTEGER PRIMARY KEY,created_at TEXT,from_date TEXT,rows_json TEXT)');
 db.prepare('INSERT INTO _land_schedule_revisions(created_at,from_date,rows_json) VALUES(?,?,?)').run(now(),from,JSON.stringify(previous));
 db.exec('DELETE FROM lahan_rencana');for(const row of next)insertRow('lahan_rencana',row,false);
}
function coveredLand(db,reportId,blok,aktivitas){try{return Number(db.prepare('SELECT covered_ha FROM _land_daily_covered WHERE report_id=? AND blok=? AND aktivitas=?').get(reportId,norm(blok),aktivitas)?.covered_ha||0);}catch{return 0;}}
export function registerHistoricalDailyCoverage(db,now,reportIds=null){
 if(!reportIds&&db.prepare("SELECT v FROM _settings WHERE k='land-prep:daily-covered-init'").get())return;
 db.exec('CREATE TABLE IF NOT EXISTS _land_daily_covered(report_id INTEGER,blok TEXT,aktivitas TEXT,covered_ha REAL,created_at TEXT,PRIMARY KEY(report_id,blok,aktivitas))');
 const through=db.prepare("SELECT v FROM _settings WHERE k='land-prep:actual-through'").get()?.v||'2026-10-23',areas=landAreas(db),source=db.prepare('SELECT * FROM lahan_harian WHERE COALESCE(diganti_aktual,0)=0 AND daily_report_id IS NULL').all(),groups=new Map();
 for(const r of db.prepare("SELECT r.id report_id,r.tanggal,i.* FROM daily_report r JOIN daily_item i ON i.report_id=r.id WHERE r.tanggal<=? AND r.divisi IN ('Pisang','Infra') AND r.status='Selesai' AND i.satuan='ha' AND i.realisasi>0").all(through)){
  if(reportIds&&!reportIds.includes(Number(r.report_id)))continue;const stage=stageForDaily(r.aktivitas);if(!stage)continue;const key=r.report_id+'|'+norm(r.blok)+'|'+stage,g=groups.get(key)||{id:r.report_id,blok:r.blok,stage,date:r.tanggal,ha:0};g.ha+=Number(r.realisasi);groups.set(key,g);
 }
 for(const g of groups.values()){
  const matching=source.filter(s=>norm(s.blok)===norm(g.blok)&&s.aktivitas===g.stage),total=matching.reduce((s,r)=>s+Number(r.hasil_ha||0),0),sameDay=matching.filter(r=>r.tanggal===g.date).reduce((s,r)=>s+Number(r.hasil_ha||0),0),area=areas.get(norm(g.blok))||0;
  const covered=area>0&&total>=area-.000001?Math.min(g.ha,area):Math.min(g.ha,sameDay);
  if(covered>0)db.prepare('INSERT OR REPLACE INTO _land_daily_covered VALUES(?,?,?,?,?)').run(g.id,norm(g.blok),g.stage,covered,now());
 }
 if(!reportIds)db.prepare("INSERT OR REPLACE INTO _settings(k,v) VALUES('land-prep:daily-covered-init',?)").run(now());
}
