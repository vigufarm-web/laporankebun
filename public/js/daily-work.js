import {activityKey} from './daily-catalog.js';
export {activityKey};
export function parseGroups(value){try{return Array.isArray(value)?value:JSON.parse(value||'[]');}catch{return [];}}
export function groupWork(items=[],totals=[],field='hk_realisasi'){
 const saved=new Map(parseGroups(totals).map(g=>[g.key,g])),map=new Map();
 for(const row of items){const key=activityKey(row.aktivitas,row.satuan);let g=map.get(key);if(!g){g={key,aktivitas:row.aktivitas,satuan:row.satuan,rows:[],hk:'',manual:field==='hk_realisasi'&&items.some(x=>x.id!=null)};map.set(key,g);}g.rows.push({...row});}
 for(const g of map.values()){const old=saved.get(g.key),values=g.rows.filter(x=>x[field]!==''&&x[field]!=null);g.hk=old?.hk??(values.length?values.reduce((s,x)=>s+Number(x[field]||0),0):'');g.manual=old?.manual??g.manual;g.mode=old?.mode||'manual';g.times=old?.times||1;}
 return [...map.values()];
}
export function allocateHK(total,weights){
 if(total===''||total==null)return weights.map(()=>null);
 const hk=Number(total);if(!Number.isFinite(hk)||hk<0)throw new Error('Total HK kegiatan harus nol atau lebih.');
 const ws=weights.map(Number);if(ws.some(w=>!Number.isFinite(w)||w<0))throw new Error('Hasil per blok harus nol atau lebih.');
 const sum=ws.reduce((s,w)=>s+w,0);if(!sum){if(hk===0)return ws.map(()=>0);throw new Error('Hasil masih nol. Pilih HK manual per blok dan isi catatan kendala.');}
 const ticks=Math.round(hk*1e6),parts=ws.map((w,i)=>{const raw=ticks*w/sum;return {i,value:Math.floor(raw),fraction:raw-Math.floor(raw)};});
 let rest=ticks-parts.reduce((s,p)=>s+p.value,0);const ordered=[...parts].sort((a,b)=>b.fraction-a.fraction||a.i-b.i);for(let i=0;i<rest;i++)ordered[i%ordered.length].value++;
 return parts.map(p=>p.value/1e6);
}
export function prepareActual(groups,{complete=false}={}){
 const items=[],hk_groups=[];
 for(let g of groups){const selected=g.rows.filter(r=>r.selected);if(!selected.length)continue;
  if(g.satuan==='HK'&&selected.length===1&&g.hk!==''&&g.hk!=null){g={...g,manual:true};selected[0]={...selected[0],hk_realisasi:Number(g.hk),realisasi:null};}
  if(complete&&(g.hk===''||g.hk==null))throw new Error('Isi total HK kegiatan '+g.aktivitas+'.');
  if(complete&&!g.manual&&selected.some(r=>r.realisasi===''||r.realisasi==null))throw new Error('Isi hasil tiap blok yang dicentang: '+g.aktivitas+'.');
  let allocations;
  if(g.manual){if(!complete&&selected.some(r=>r.hk_realisasi===''||r.hk_realisasi==null)){allocations=selected.map(r=>r.hk_realisasi===''||r.hk_realisasi==null?null:Number(r.hk_realisasi));}
  else {if(selected.some(r=>r.hk_realisasi===''||r.hk_realisasi==null||Number(r.hk_realisasi)<0||!Number.isFinite(Number(r.hk_realisasi))))throw new Error('Isi HK manual tiap blok.');
   const sum=selected.reduce((s,r)=>s+Number(r.hk_realisasi||0),0);if(g.hk!==''&&Math.abs(sum-Number(g.hk))>1e-6)throw new Error('Jumlah HK manual harus sama dengan total HK kegiatan '+g.aktivitas+'.');
   if(selected.some(r=>Number(r.hk_realisasi)>0&&!Number(r.realisasi)&&g.satuan!=='HK'&&!r.id&&!String(r.keterangan||'').trim()))throw new Error('Isi catatan kendala untuk HK tanpa hasil.');
   allocations=selected.map(r=>Number(r.hk_realisasi));}
  }else allocations=!complete&&selected.some(r=>r.realisasi===''||r.realisasi==null)?selected.map(()=>null):allocateHK(g.hk,selected.map(r=>r.realisasi===''||r.realisasi==null?0:r.realisasi));
  selected.forEach((r,i)=>items.push({...r,hk_realisasi:allocations[i]}));hk_groups.push({key:g.key,hk:g.manual?(g.hk===''?'':Number(g.hk)):g.hk,manual:g.manual});
 }
 return {items,hk_groups};
}
export function validatePlan(groups,locations){
 const items=[],hk_groups=[],seen=new Set(),activityKeys=new Set();const locs=new Map(locations.map(l=>[l.nama,l]));
 for(const g of groups){const groupKey=activityKey(g.aktivitas,g.satuan);if(activityKeys.has(groupKey))throw new Error('Gabungkan blok dengan kegiatan/satuan yang sama dalam satu kartu.');activityKeys.add(groupKey);if(!String(g.aktivitas||'').trim())throw new Error('Pilih kegiatan.');
  const rows=g.rows.filter(r=>r.selected);if(!rows.length)throw new Error('Centang blok untuk '+g.aktivitas+'.');
  if(g.hk!==''&&(!Number.isFinite(Number(g.hk))||Number(g.hk)<0))throw new Error('HK rencana harus nol atau lebih.');
  for(const row of rows){if(!locs.has(row.blok)&&!row.id)throw new Error('Pilih blok GIS aktif.');const key=activityKey(g.aktivitas,g.satuan)+'|'+row.blok;if(seen.has(key))throw new Error('Blok/kegiatan yang sama terpilih dua kali.');seen.add(key);
   if(g.satuan!=='HK'&&(row.target===''||row.target==null||!Number.isFinite(Number(row.target))||Number(row.target)<0))throw new Error('Isi target per blok '+row.blok+'.');
   if(g.satuan==='ha'&&Number(row.target)>Number(locs.get(row.blok)?.luas_ha||0)*Number(g.times||1)+1e-6&&locs.has(row.blok)&&!(row.id&&Number(row.target)===Number(row._originalTarget)))throw new Error('Target ha melebihi luas GIS dan jumlah pelaksanaan '+row.blok+'.');
   items.push({...row,aktivitas:g.aktivitas,satuan:g.satuan,target:g.satuan==='HK'?null:row.target,hk_rencana:null});
  }hk_groups.push({key:activityKey(g.aktivitas,g.satuan),hk:g.hk,manual:false,mode:g.mode,times:g.times});
 }
 if(items.length>200)throw new Error('Maksimal 200 baris blok/kegiatan per minggu.');
 return {items,hk_groups};
}
