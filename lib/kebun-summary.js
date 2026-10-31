import {weeklyBlockBreakdown} from './weekly-blocks.js';
import {visibleActivityRows,hiddenActivity} from '../public/js/activity-visibility.js';
import {ownedParcelSummary} from './gis-ownership.js';
import {scopePlantingData} from './planting-scope.js';
import {weeklyLand} from './weekly-targets.js';
import {statusRencana,targetPeriode,lahanProgress} from '../public/js/schema.js';
const stages=['Cabut Ajir','Cabut Mulsa','Gulung Drip','Land Clearing','Bajak 1','Dolomite','Bajak 2','Stik Ridger','Ridger','Install Drip','Stik Tanam','Ecer Pupuk','Tanam'];
export function kebunSummary(db,locations,date,kom='Pisang'){
 const selectedStages=kom==='Padi'?db.prepare("SELECT aktivitas FROM lahan_aktivitas WHERE untuk IN ('Padi','Semua') ORDER BY urutan,id").all().map(r=>r.aktivitas):stages;
 const names=new Set(locations.map(x=>x.nama.toLowerCase()));const tables=['lahan_blok','lahan_harian','lahan_aktivitas','lahan_target','lahan_rencana','pisang_blok'];
 const original=Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM "'+t+'"').all()])),data=kom==='Pisang'?scopePlantingData(original,locations,date):original;
 data.lahan_harian=data.lahan_harian.filter(r=>!r.tanggal||r.tanggal<=date);
 const relevant=new Set([...data.lahan_harian,...data.lahan_target].map(x=>String(x.blok).toLowerCase()));
 const blocks=data.lahan_blok.filter(x=>(x.peruntukan||'Pisang')===kom&&names.has(String(x.blok).toLowerCase())&&relevant.has(String(x.blok).toLowerCase())).map(b=>{
  const area=Number(b.luas_ha)||0,prep=data.lahan_harian.some(r=>r.blok?.toLowerCase()===b.blok.toLowerCase()&&stages.slice(0,3).includes(r.aktivitas)&&!r.diganti_aktual);const activity=selectedStages.filter(s=>!hiddenActivity(s)).map((name,index)=>{const rows=data.lahan_harian.filter(x=>x.blok?.toLowerCase()===b.blok.toLowerCase()&&x.aktivitas===name&&!x.diganti_aktual);const raw=rows.reduce((s,x)=>s+Number(x.hasil_ha||0),0);return {name,applicable:kom==='Padi'||index>=3||prep,ha:rows.length?Math.min(area,raw):null,pct:rows.length&&area?Math.min(100,raw/area*100):null};});
  const applicable=activity.filter(x=>x.applicable);return {name:b.blok,area,activity,stageCount:applicable.length,pct:applicable.length?applicable.reduce((s,x)=>s+Number(x.pct||0),0)/applicable.length:0};
 }).sort((a,b)=>a.name.localeCompare(b.name,'id',{numeric:true}));
 const d=new Date(date+'T00:00:00Z');const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()-day+1);const from=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+6);const to=d.toISOString().slice(0,10);
 const ctx={rows:t=>(data[t]||[]).filter(x=>!x.diganti_aktual)};
 const weekly=weeklyLand(db,ctx,date).targets.map(x=>{const worked=weeklyBlockBreakdown(data.lahan_harian,{activity:x.a,from,to:date,names});return {name:x.a,target:x.bl.filter(b=>names.has(b.blok.toLowerCase())).reduce((s,b)=>s+b.ha,0),done:worked.reduce((s,b)=>s+b.ha,0),blocks:worked};}).filter(x=>x.target>0.000001||x.done>0.000001);
 return {date,from,to,stages:selectedStages.filter(s=>!hiddenActivity(s)),ownedBlocks:locations.length,ownedAreaHa:ownedParcelSummary(db).areaHa,blocks,weekly:visibleActivityRows(weekly),area:blocks.reduce((s,b)=>s+b.area,0)};
}
