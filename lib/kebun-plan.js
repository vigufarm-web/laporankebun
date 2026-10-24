import {statusRencana,porsiRencana} from '../public/js/schema.js';
import {kebunSummary} from './kebun-summary.js';
import {scopePlantingData} from './planting-scope.js';
import {plantingPeriod,plantingWeeks} from './planting-period.js';
const key=v=>String(v||'').trim().toLowerCase();
const hidden=new Set(['Cabut Ajir','Cabut Mulsa','Gulung Drip']);
export function kebunPlan(db,locations,today){
 const year=Number(today.slice(0,4)),yearEnd=year+'-12-31',owned=new Set(locations.map(b=>key(b.nama)));
 const names=['lahan_blok','lahan_harian','lahan_aktivitas','lahan_target','lahan_rencana','pisang_blok'];
 const data=scopePlantingData(Object.fromEntries(names.map(t=>[t,db.prepare('SELECT * FROM '+t).all()])),locations,today);
 const masters=data.lahan_blok.filter(b=>owned.has(key(b.blok))&&(b.peruntukan||'Pisang')==='Pisang'),master=new Map(masters.map(b=>[key(b.blok),b]));
 const actual=data.lahan_harian.filter(r=>!r.diganti_aktual&&r.tanggal<=today&&master.has(key(r.blok)));
 const ctx={rows:t=>t==='lahan_harian'?actual:t==='lahan_blok'?masters:t==='lahan_rencana'?data[t].filter(r=>master.has(key(r.blok))):data[t]||[]};
 const plans=statusRencana(ctx),targets=new Map();
 for(const t of data.lahan_target){const b=master.get(key(t.blok));if(b&&String(t.bulan).slice(0,4)===String(year))targets.set(key(t.blok),{...t,area:Number(b.luas_ha)||0});}
 const sum=(rows,field)=>rows.reduce((s,r)=>s+Number(r[field]||0),0);
 const planted=(name,through=today)=>Math.min(Number(master.get(name)?.luas_ha||0),sum(actual.filter(r=>key(r.blok)===name&&r.aktivitas==='Tanam'&&r.tanggal<=through),'hasil_ha'));
 const selected=new Set(targets.keys()),targetHa=[...targets.values()].reduce((s,t)=>s+t.area,0),plantedHa=[...selected].reduce((s,k)=>s+planted(k),0);
 const firstMonth=Math.min(Number(today.slice(5,7)),...[...targets.values()].map(t=>Number(String(t.bulan).slice(5,7))));
 const progress=kebunSummary(db,locations,today),workActivities=data.lahan_aktivitas.filter(a=>!hidden.has(a.aktivitas)&&['Pisang','Semua'].includes(a.untuk||'Pisang'));
 const period=(from,to)=>plantingPeriod({plans,actual,activities:workActivities,progress,from,to,today});
 const weeks=plantingWeeks(today).map(w=>({...w,activities:period(w.from,w.to)}));
 const months=[];for(let month=firstMonth;month<=12;month++){
  const ym=year+'-'+String(month).padStart(2,'0'),from=ym+'-01',to=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),future=from>today;
  const planned=plans.filter(r=>selected.has(key(r.blok))&&r.aktivitas==='Tanam');
  const rows=actual.filter(r=>selected.has(key(r.blok))&&r.aktivitas==='Tanam'&&!String(r.source_key||'').startsWith('baseline:')&&r.tanggal>=from&&r.tanggal<=to);
  const activities=period(from,to);
  months.push({month:ym,targetHa:[...targets.values()].filter(t=>String(t.bulan).slice(0,7)===ym).reduce((s,t)=>s+t.area,0),planHa:planned.reduce((s,r)=>s+porsiRencana(r,r.a,from,to),0),actualHa:future?null:sum(rows,'hasil_ha'),cumulativeHa:future?null:[...selected].reduce((s,k)=>s+planted(k,to<today?to:today),0),activities});
 }
 const timeline=plans.filter(r=>!hidden.has(r.aktivitas)&&r.kurang>1e-6&&r.mulai<=yearEnd).map(r=>({block:r.blok,activity:r.aktivitas,from:r.mulai,to:r.selesai,ha:r.kurang,machine:r.a.alat||(/^(Bajak 1|Bajak 2|Ridger)$/.test(r.aktivitas)?'Traktor bersama':r.aktivitas==='Land Clearing'?'LC':'Tim manual')})).sort((a,b)=>a.from.localeCompare(b.from)||a.block.localeCompare(b.block));
 const blocks=[...targets].map(([k,t])=>{const plantedArea=planted(k),forecast=plans.filter(r=>key(r.blok)===k&&r.aktivitas==='Tanam').map(r=>r.selesai).sort().at(-1)||null,targetMonth=String(t.bulan).slice(0,7),complete=plantedArea>=t.area-1e-6;return {name:master.get(k).blok,area:t.area,targetMonth,plantedHa:plantedArea,remainingHa:Math.max(0,t.area-plantedArea),forecast,complete,late:!complete&&!!forecast&&forecast.slice(0,7)>targetMonth};});
 const inventory=new Map();for(const layer of db.prepare("SELECT geojson FROM gis_layer WHERE nama='Blok Tanam'").all())for(const f of JSON.parse(layer.geojson||'{}').features||[]){const p=f.properties||{};if(p.Lahan!=='Pisang')continue;const status=p.Status||'Belum berstatus',g=inventory.get(status)||{status,gisHa:0};g.gisHa+=Number(p.Shape_Area||p.Area_New||0)/10000;inventory.set(status,g);}
 return {today,year,yearEnd,targetHa,plantedHa,remainingHa:Math.max(0,targetHa-plantedHa),openingHa:[...selected].reduce((s,k)=>s+planted(k,new Date(Date.UTC(year,firstMonth-1,0)).toISOString().slice(0,10)),0),forecastEnd:plans.filter(r=>selected.has(key(r.blok))&&r.kurang>1e-6).map(r=>r.selesai).sort().at(-1)||null,months,weeks,blocks,timeline,inventory:[...inventory.values()],ownedBananaHa:locations.filter(l=>l.divisi==='Pisang').reduce((s,l)=>s+Number(l.luas_ha||0),0),progress};
}
