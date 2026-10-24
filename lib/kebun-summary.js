import {statusRencana,targetPeriode,lahanProgress} from '../public/js/schema.js';
const stages=['Cabut Ajir','Cabut Mulsa','Gulung Drip','Land Clearing','Bajak 1','Dolomite','Bajak 2','Stik Ridger','Ridger','Install Drip','Stik Tanam','Ecer Pupuk','Tanam'];
export function kebunSummary(db,locations,date){
 const names=new Set(locations.map(x=>x.nama.toLowerCase()));const tables=['lahan_blok','lahan_harian','lahan_aktivitas','lahan_target','lahan_rencana','pisang_blok'];
 const data=Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM "'+t+'"').all()]));
 const relevant=new Set([...data.lahan_harian,...data.lahan_target].map(x=>String(x.blok).toLowerCase()));
 const blocks=data.lahan_blok.filter(x=>names.has(String(x.blok).toLowerCase())&&relevant.has(String(x.blok).toLowerCase())).map(b=>{
  const area=Number(b.luas_ha)||0;const activity=stages.map(name=>{const rows=data.lahan_harian.filter(x=>x.blok?.toLowerCase()===b.blok.toLowerCase()&&x.aktivitas===name&&!x.diganti_aktual);const raw=rows.reduce((s,x)=>s+Number(x.hasil_ha||0),0);return {name,kg:null,ha:rows.length?Math.min(area,raw):null,pct:rows.length&&area?Math.min(100,raw/area*100):null};});
  const present=activity.filter(x=>x.ha!=null);return {name:b.blok,area,activity,pct:present.length?present.reduce((s,x)=>s+x.pct,0)/stages.length:0};
 }).sort((a,b)=>a.name.localeCompare(b.name,'id',{numeric:true}));
 const d=new Date(date+'T00:00:00Z');const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()-day+1);const from=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+6);const to=d.toISOString().slice(0,10);
 const ctx={rows:t=>(data[t]||[]).filter(x=>!x.diganti_aktual)};
 const weekly=targetPeriode(ctx,statusRencana(ctx),from,to,date).map(x=>({name:x.a,target:x.target,done:x.selesai}));
 return {date,from,to,stages,blocks,weekly,area:blocks.reduce((s,b)=>s+b.area,0)};
}
