import {porsiRencana} from '../public/js/schema.js';
const key=v=>String(v||'').trim().toLowerCase();
const addDays=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
export function plantingWeeks(today){const day=new Date(today+'T00:00:00Z').getUTCDay()||7,from=addDays(today,1-day);return [{key:'this',label:'Minggu ini',from,to:addDays(from,6)},{key:'next',label:'Minggu depan',from:addDays(from,7),to:addDays(from,13)}];}
// Period membership comes from scheduled work OR dated effective actuals.
// Remaining hectares describe the block today, never a fabricated weekly quota.
export function plantingPeriod({plans,actual,activities,progress,from,to,today}){
 const blocks=new Map(progress.blocks.map(b=>[key(b.name),b]));
 return activities.map(a=>{
  const locations=new Map(),get=name=>{const k=key(name);if(!blocks.has(k))return null;if(!locations.has(k))locations.set(k,{name:blocks.get(k).name,planHa:0,actualHa:from>today?null:0});return locations.get(k);};
  for(const r of plans.filter(r=>r.aktivitas===a.aktivitas)){const ha=porsiRencana(r,r.a,from,to);if(ha>1e-6){const b=get(r.blok);if(b)b.planHa+=ha;}}
  for(const r of actual.filter(r=>r.aktivitas===a.aktivitas&&r.tanggal>=from&&r.tanggal<=to&&r.tanggal<=today&&!String(r.source_key||'').startsWith('baseline:')&&Number(r.hasil_ha)>1e-6)){const b=get(r.blok);if(b)b.actualHa+=Number(r.hasil_ha);}
  const rows=[...locations.values()].map(r=>{const b=blocks.get(key(r.name)),done=Math.min(b.area,Math.max(0,Number(b.activity.find(x=>x.name===a.aktivitas)?.ha)||0)),remainingHa=Math.max(0,b.area-done);return {...r,remainingHa,complete:remainingHa<=1e-6};}).sort((a,b)=>a.name.localeCompare(b.name,'id',{numeric:true}));
  return {name:a.aktivitas,planHa:rows.reduce((s,r)=>s+r.planHa,0),actualHa:from>today?null:rows.reduce((s,r)=>s+Number(r.actualHa||0),0),locations:rows};
 }).filter(a=>a.locations.length);
}
