import {centralPlantings} from './gis-planting-read.js';
import {nurserySummary} from './nursery-summary.js';
const n=v=>Number(v)||0;
const key=v=>String(v||'').trim().toLowerCase();
export function bananaDetail(db,locations,progress,today){
 const masters=db.prepare('SELECT * FROM pisang_blok').all(),byName=new Map(),plants=centralPlantings(db).filter(p=>p.commodity==='Pisang');
 for(const r of masters){const k=key(r.nama_blok);if(!byName.has(k))byName.set(k,[]);byName.get(k).push(r);}
 const stages=new Map(progress.blocks.map(b=>[key(b.name),b]));
 const blocks=locations.filter(l=>l.divisi==='Pisang'||!l.divisi).map(l=>{
  const rows=(byName.get(key(l.nama))||[]).filter(r=>!r.tanggal_tanam||r.tanggal_tanam<=today),area=n(l.luas_ha);
  // Master rows describe a block, not additional hectares. Reconcile with stage actuals once.
  const masterHa=Math.max(0,...rows.filter(r=>r.tanggal_tanam||n(r.pokok_tanam)>0).map(r=>n(r.luas_ha)));
  const stageHa=n(stages.get(key(l.nama))?.activity.find(a=>a.name==='Tanam')?.ha);
  const catalog=plants.filter(p=>p.block_id===l.id),active=catalog.filter(p=>(!p.planted_on||p.planted_on<=today)&&(!p.closed_on||p.closed_on>today));
  if(catalog.length){const planted=active.some(p=>p.area_ha!=null)?active.reduce((s,p)=>s+n(p.area_ha),0):active.length?masterHa:0,pokok=active.reduce((s,p)=>s+n(p.population),0),loss=Math.max(0,...rows.map(r=>n(r.kehilangan)-n(r.sulam)));return {name:l.nama,area,plantedHa:Math.min(area,planted),plantedPokok:pokok,population:Math.max(0,pokok-loss),pokokRecorded:active.some(p=>p.population!=null)};}
  return {name:l.nama,area,plantedHa:Math.min(area,Math.max(masterHa,stageHa)),plantedPokok:Math.max(0,...rows.map(r=>n(r.pokok_tanam))),population:Math.max(0,...rows.map(r=>n(r.pokok_tanam)-n(r.kehilangan)+n(r.sulam))),pokokRecorded:rows.some(r=>r.pokok_tanam!=null)};
 }).sort((a,b)=>a.name.localeCompare(b.name,'id',{numeric:true}));
 const nursery=nurserySummary(db);
 nursery.rows=db.prepare('SELECT * FROM pisang_bibit ORDER BY tanggal_datang,id').all().map(r=>({date:r.tanggal_datang,batch:r.batch||'',description:r.keterangan||'',clone:r.klon||'Belum diisi',incoming:n(r.qty_datang),splitting:n(r.splitting),rejected:n(r.afkir),mortality:n(r.mortal),planted:n(r.ditanam),balance:n(r.qty_datang)+n(r.splitting)-n(r.afkir)-n(r.mortal)-n(r.ditanam)}));
 const estimates=db.prepare('SELECT * FROM pisang_estimasi').all(),actual=db.prepare('SELECT * FROM pisang_box').all().filter(r=>r.tanggal<=today);
 const months=[...new Set([...estimates.map(r=>r.bulan?.slice(0,7)),...actual.map(r=>r.tanggal?.slice(0,7))].filter(Boolean))].sort().reverse().map(month=>{const plans=estimates.filter(r=>r.bulan?.slice(0,7)===month),rows=actual.filter(r=>r.tanggal?.slice(0,7)===month),plan=plans.length?plans.reduce((s,r)=>s+n(r.box),0):null,boxes=rows.reduce((s,r)=>s+n(r.jumlah_box),0);return {month,plan,actual:month>today.slice(0,7)?null:boxes,remaining:plan==null?null:Math.max(0,plan-boxes),achievement:plan>0?boxes/plan*100:null};});
 return {area:blocks.reduce((s,b)=>s+b.area,0),plantedHa:blocks.reduce((s,b)=>s+b.plantedHa,0),plantedPokok:blocks.reduce((s,b)=>s+b.plantedPokok,0),population:blocks.reduce((s,b)=>s+b.population,0),missingPokok:blocks.filter(b=>b.plantedHa>0&&!b.pokokRecorded).length,blocks,nursery,harvestMonths:months};
}
