import {createHash} from 'node:crypto';
import {hariPerHa,susunRencana,alatDefault} from '../public/js/schema.js';
import {scopePlantingData} from './planting-scope.js';
import {rebuildLandSchedule} from './land-actual.js';
const key=v=>String(v||'').trim().toLowerCase(),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function plantingGISReview({db,locations,today}){
 const tables=['lahan_blok','lahan_harian','lahan_aktivitas','lahan_target','lahan_rencana','pisang_blok','gis_layer'],data=Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM '+t).all()])),owned=new Map(locations.filter(x=>x.divisi==='Pisang').map(x=>[key(x.nama),x])),groups=new Map();
 for(const layer of data.gis_layer.filter(l=>l.nama==='Blok Tanam'))for(const f of JSON.parse(layer.geojson||'{}').features||[]){const p=f.properties||{};if(p.Lahan!=='Pisang')continue;const name=String(p.Nama_Blok||'').trim();if(!name)continue;const b=groups.get(key(name))||{name,id:p.blok_id||p.block_id||null,status:p.Status||'',gisHa:0};b.gisHa+=Number(p.Shape_Area||p.Area_New||0)/10000;groups.set(key(name),b);}
 const totals={gisHa:0,plantedGISHa:0,inProgressGISHa:0,nextGISHa:0,newGISHa:0,nextOwnedHa:0};
 const changes=[],nextBlocks=[];
 for(const b of groups.values()){
  totals.gisHa+=b.gisHa;if(b.status==='Sudah Tanam')totals.plantedGISHa+=b.gisHa;if(/^On Progress/.test(b.status))totals.inProgressGISHa+=b.gisHa;if(b.status==='Lahan Baru')totals.newGISHa+=b.gisHa;
  if(b.status!=='Next Progress')continue;
  const loc=owned.get(key(b.name)),master=data.lahan_blok.find(r=>key(r.blok)===key(b.name)),existing=data.lahan_target.find(r=>r.block_id&&r.block_id===b.id)||data.lahan_target.find(r=>key(r.blok)===key(b.name)),eligible=!!loc&&loc.luas_ha>0&&!!master;
  totals.nextGISHa+=b.gisHa;if(eligible)totals.nextOwnedHa+=Math.min(master.luas_ha,loc.luas_ha);
  const row={name:b.name,gisHa:b.gisHa,ownedHa:eligible?Math.min(master.luas_ha,loc.luas_ha):0,eligible,targetMonth:existing?.bulan?.slice(0,7)||today.slice(0,4)+'-12',earliest:existing?.mulai_persiapan||today,existing:!!existing};nextBlocks.push(row);
  if(eligible&&!existing)changes.push({id:null,blok:b.name,block_id:loc.id,block_name_snapshot:b.name,bulan:today.slice(0,4)+'-12-01',mulai_persiapan:null,prioritas:null,keterangan:'Tambahan Next Progress dari GIS; target tanam Desember, persiapan dapat dimulai lebih awal.'});
 }
 const revisedTargets=data.lahan_target.map(t=>{const edit=changes.find(c=>c.id===t.id);return edit?{...t,...edit}:t;}).concat(changes.filter(c=>c.id==null)),scoped=scopePlantingData({...data,lahan_target:revisedTargets},locations,today),ctx={rows:t=>scoped[t]||[]};
 const speeds=scoped.lahan_aktivitas.filter(a=>(a.untuk||'Pisang')==='Pisang').map(a=>({activity:a.aktivitas,daysPerHa:hariPerHa(ctx,a),teams:Number(a.tim)||1,machine:alatDefault(a.aktivitas)||a.alat||'Tim manual',basis:Number(a.hari_per_ha)>0?'Isian kecepatan':'Hari kerja aktif / hasil historis, tanpa saldo awal'}));
 const schedule=susunRencana(ctx,today),missingSpeeds=speeds.filter(s=>s.daysPerHa<=0&&schedule.some(r=>r.aktivitas===s.activity&&!/Sudah dikerjakan/.test(r.keterangan||''))).map(s=>s.activity);
 const heldTargets=data.lahan_target.filter(t=>!groups.has(key(t.blok))).map(t=>({name:t.blok,reason:'Belum ada padanan nama/ID pada GIS aktif; riwayat dipertahankan.'}));
 return {today,token:hash({today,data,locations}),totals,nextBlocks,changes,heldTargets,speeds,missingSpeeds,forecastEnd:schedule.map(r=>r.selesai).sort().at(-1)||null,scheduleRows:schedule.length,schedule};
}
export function reconcilePlanting({db,tx,locations,insertRow,now,log},body){
 const today=new Date(Date.parse(now())+7*3600e3).toISOString().slice(0,10),review=plantingGISReview({db,locations,today});
 if(body.mode!=='apply')return {...review,schedule:undefined};
 if(body.token!==review.token){const e=new Error('Data GIS, aktual atau rencana berubah. Tinjau ulang sebelum menerapkan.');e.status=409;throw e;}
 if(review.missingSpeeds.length)throw new Error('Kecepatan pekerjaan belum memiliki dasar: '+review.missingSpeeds.join(', '));
 const fields=['urutan','blok','aktivitas','luas_ha','mulai','selesai','keterangan'],plain=rows=>rows.map(r=>Object.fromEntries(fields.map(k=>[k,r[k]??null])));
 if(!review.changes.length&&JSON.stringify(plain(review.schedule))===JSON.stringify(plain(db.prepare('SELECT * FROM lahan_rencana').all())))return {applied:true,unchanged:true,...review,schedule:undefined};
 tx(()=>{
  db.exec('CREATE TABLE IF NOT EXISTS _planting_target_revisions(id INTEGER PRIMARY KEY,created_at TEXT,rows_json TEXT)');db.prepare('INSERT INTO _planting_target_revisions(created_at,rows_json) VALUES(?,?)').run(now(),JSON.stringify(db.prepare('SELECT * FROM lahan_target').all()));
  for(const row of review.changes){if(row.id){db.prepare('UPDATE lahan_target SET mulai_persiapan=?,updated_at=? WHERE id=?').run(row.mulai_persiapan,now(),row.id);}else{const {id,...record}=row;insertRow('lahan_target',record,false);}}
  rebuildLandSchedule(db,insertRow,now,today);log('sesuaikan target dan jadwal GIS','lahan_target',null,{nextGISHa:review.totals.nextGISHa,nextOwnedHa:review.totals.nextOwnedHa,targetsChanged:review.changes.length,heldTargets:review.heldTargets.map(x=>x.name)});
 });
 return {applied:true,...plantingGISReview({db,locations,today}),schedule:undefined};
}
