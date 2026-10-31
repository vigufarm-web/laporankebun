import {isGeneralDailyLocation} from '../public/js/daily-locations.js';
import {groupWork,prepareActual,activityKey,parseGroups,workKind} from '../public/js/daily-work.js';
import {landStage} from '../public/js/daily-catalog.js';
const fail=message=>{const error=new Error(message);error.status=400;throw error;};
export function checkedHKGroups(items,values,{allowEmpty=false}={}){
 if(!Array.isArray(values))fail('Data total HK kegiatan. Muat ulang formulir.');
 const keys=new Set(items.map(r=>activityKey(r.aktivitas,r.satuan))),seen=new Set();
 for(const g of values){if(!g||!keys.has(g.key)||seen.has(g.key))fail('Kelompok HK tidak cocok dengan kegiatan.');seen.add(g.key);
  if((g.hk===''||g.hk==null)&&allowEmpty)continue;
  const hk=Number(g.hk);if(g.hk===''||g.hk==null||!Number.isFinite(hk)||hk<0||hk*1e6>Number.MAX_SAFE_INTEGER||Math.abs(hk*1e6-Math.round(hk*1e6))>1e-5)fail('HK kegiatan harus angka nol atau lebih, maksimal 6 desimal.');
 }
 if(seen.size!==keys.size)fail('Isi total HK setiap kegiatan.');return values.map(g=>({key:g.key,hk:g.hk??'',manual:g.manual===true,mode:g.mode==='gis'?'gis':'manual',times:Number(g.times??1),...(['rutin','target'].includes(g.jenis)?{jenis:g.jenis}:{})}));
}
export function checkWeeklyWorkflow(body,locations,previous=[]){
 if(!Array.isArray(body.items)||!body.items.length)fail('Rencana harus memiliki minimal satu baris blok/kegiatan.');
 const metadata=checkedHKGroups(body.items,body.hk_groups,{allowEmpty:true}),groups=new Map(metadata.map(g=>[g.key,g])),locs=new Map(locations.map(l=>[l.nama,l])),seen=new Set();
 for(const r of body.items){const key=activityKey(r.aktivitas,r.satuan),g=groups.get(key),unique=key+'|'+r.blok;
  if(seen.has(unique))fail('Blok dan kegiatan yang sama tercatat dua kali.');seen.add(unique);
  const old=previous.find(p=>Number(p.id)===Number(r.id)&&p.blok===r.blok),times=Number(g.times??1);
  if(!Number.isInteger(times)||times<1||times>7||(landStage(r.aktivitas)&&r.satuan==='ha'&&times!==1))fail('Jumlah pelaksanaan mingguan tidak valid.');
  if(g.mode==='gis'&&r.satuan!=='ha')fail('Target GIS hanya untuk satuan ha.');
  // Target wajib kecuali satuan HK dan kegiatan rutin pilihan mandor (mis. operasional alat, kirim air) — aturan sama dengan form (workKind).
  const blank=r.target===''||r.target==null,kind=workKind(body.divisi,r.aktivitas,r.satuan,g.jenis);
  if(!String(r.aktivitas||'').trim()||!String(r.satuan||'').trim()||(kind.targetRequired&&blank)||(r.satuan!=='HK'&&!blank&&(!Number.isFinite(Number(r.target))||Number(r.target)<0)))fail('Kegiatan, satuan, dan target setiap blok wajib diisi.');
  if(isGeneralDailyLocation(r.blok)&&landStage(r.aktivitas)&&r.satuan==='ha')fail('Progres lahan harus memakai blok GIS, bukan lokasi umum.');
  if(r.satuan==='ha'&&!isGeneralDailyLocation(r.blok)&&locs.has(r.blok)&&Number(r.target)>Number(locs.get(r.blok).luas_ha||0)*times+1e-6&&!(old&&Number(old.target)===Number(r.target)))fail('Target ha melebihi luas GIS dan jumlah pelaksanaan '+r.blok+'.');
  r.hk_rencana=null;if(r.satuan==='HK'||blank)r.target=null;
 }
 return metadata;
}
export function checkActualWorkflow(body,previous=[]){
 if(body.tanggal){const date=new Date(body.tanggal+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==body.tanggal)fail('Tanggal pekerjaan tidak valid.');}
 if(!Array.isArray(body.items)||!body.items.length)fail('Realisasi harus memiliki minimal satu baris blok/kegiatan.');
 const metadata=checkedHKGroups(body.items,body.hk_groups,{allowEmpty:body.status!=='Selesai'}),seen=new Set();
 for(const r of body.items){const key=activityKey(r.aktivitas,r.satuan)+'|'+r.blok;if(seen.has(key))fail('Blok dan kegiatan yang sama tercatat dua kali.');seen.add(key);
  if(isGeneralDailyLocation(r.blok)&&landStage(r.aktivitas)&&r.satuan==='ha')fail('Progres lahan harus memakai blok GIS, bukan lokasi umum.');
  if(!String(r.aktivitas||'').trim()||!String(r.satuan||'').trim())fail('Kegiatan dan satuan wajib diisi.');
  if(r.realisasi!==''&&r.realisasi!=null&&(!Number.isFinite(Number(r.realisasi))||Number(r.realisasi)<0))fail('Hasil pekerjaan harus angka nol atau lebih.');
  if(!previous.some(p=>Number(p.id)===Number(r.id)&&p.blok===r.blok))delete r.id;
 }
 const groups=groupWork(body.items,metadata);groups.forEach(g=>g.rows.forEach(r=>r.selected=true));
 try{const prepared=prepareActual(groups,{complete:body.status==='Selesai'});body.items=prepared.items;return prepared.hk_groups;}catch(e){fail(e.message);}
}
export function reallocateEffectiveHK(db,reportId,metadata,complete){
 const rows=db.prepare('SELECT * FROM daily_item WHERE report_id=? ORDER BY urutan,id').all(reportId),groups=groupWork(rows,metadata);groups.forEach(g=>g.rows.forEach(r=>r.selected=true));
 try{const result=prepareActual(groups,{complete});for(const r of result.items)db.prepare('UPDATE daily_item SET hk_realisasi=? WHERE id=?').run(r.hk_realisasi??null,r.id);}catch(e){fail('Setelah penyesuaian luas: '+e.message);}
}
