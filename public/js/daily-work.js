import {isRepeatedArea,isNurseryPopulation,isDryingWork} from './work-measures.js';
import {activityKey,landStage} from './daily-catalog.js';
export {activityKey};
export function parseGroups(value){try{return Array.isArray(value)?value:JSON.parse(value||'[]');}catch{return [];}}
// Jenis kegiatan rencana: 'rutin' (berulang, acuan per pelaksanaan, tidak habis) · 'target' (sisa berkurang sampai selesai) · 'hk' (tanpa target).
// Cakupan luas berulang (siram/spray/pupuk … ha, bibit) selalu rutin dan persiapan lahan selalu target: perhitungan cakupan,
// progres lahan GIS dan laporan owner bergantung padanya. Selain itu dipilih mandor (choice); rencana lama tanpa pilihan = target.
export function workKind(division,activity,unit,choice){
 const u=String(unit||'').trim();
 if(u==='HK')return {kind:'hk',locked:true,targetRequired:false};
 if(isRepeatedArea(division,activity,u)||isNurseryPopulation(division,activity,u))return {kind:'rutin',locked:true,targetRequired:true};
 if(u.toLowerCase()==='ha'&&landStage(activity))return {kind:'target',locked:true,targetRequired:true};
 const kind=choice==='rutin'?'rutin':'target';return {kind,locked:false,targetRequired:kind==='target'};
}
// Pilihan awal untuk kegiatan baru di form; kegiatan rutin Infra (operasional alat, mobil support, air, kontrol irigasi).
export const defaultKind=(division,activity)=>division==='Infra'&&/operasional|mobil support|pengiriman air|pengisian air|kontrol irigasi/i.test(String(activity||''))?'rutin':'target';
export function groupWork(items=[],totals=[],field='hk_realisasi'){
 const saved=new Map(parseGroups(totals).map(g=>[g.key,g])),map=new Map();
 for(const row of items){const key=activityKey(row.aktivitas,row.satuan);let g=map.get(key);if(!g){g={key,aktivitas:row.aktivitas,satuan:row.satuan,rows:[],hk:'',manual:field==='hk_realisasi'&&items.some(x=>x.id!=null)};map.set(key,g);}g.rows.push({...row});}
 for(const g of map.values()){const old=saved.get(g.key),values=g.rows.filter(x=>x[field]!==''&&x[field]!=null);g.hk=old?.hk??(values.length?values.reduce((s,x)=>s+Number(x[field]||0),0):'');g.manual=old?.manual??g.manual;g.mode=old?.mode||'manual';g.times=old?.times||1;if(old?.jenis)g.jenis=old.jenis;}
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
 // error.group = urutan kartu kegiatan yang bermasalah, agar form bisa menyorotnya.
 for(const [gi,group] of groups.entries())try{let g=group;const selected=g.rows.filter(r=>r.selected);if(!selected.length)continue;
  if(g.satuan==='HK'&&selected.length===1&&g.hk!==''&&g.hk!=null){g={...g,manual:true};selected[0]={...selected[0],hk_realisasi:Number(g.hk),realisasi:null};}
  if(complete&&(g.hk===''||g.hk==null))throw Object.assign(new Error('Isi total HK kegiatan '+g.aktivitas+'.'),{field:'hk'});
  if(complete&&!g.manual&&selected.some(r=>r.realisasi===''||r.realisasi==null))throw Object.assign(new Error('Isi hasil tiap blok yang dicentang: '+g.aktivitas+'.'),{field:'result'});
  let allocations;
  if(g.manual){if(!complete&&selected.some(r=>r.hk_realisasi===''||r.hk_realisasi==null)){allocations=selected.map(r=>r.hk_realisasi===''||r.hk_realisasi==null?null:Number(r.hk_realisasi));}
  else {if(selected.some(r=>r.hk_realisasi===''||r.hk_realisasi==null||Number(r.hk_realisasi)<0||!Number.isFinite(Number(r.hk_realisasi))))throw new Error('Isi HK manual tiap blok.');
   const sum=selected.reduce((s,r)=>s+Number(r.hk_realisasi||0),0);if(g.hk!==''&&Math.abs(sum-Number(g.hk))>1e-6)throw new Error('Jumlah HK manual harus sama dengan total HK kegiatan '+g.aktivitas+'.');
   if(selected.some(r=>Number(r.hk_realisasi)>0&&!Number(r.realisasi)&&g.satuan!=='HK'&&!r.id&&!String(r.keterangan||'').trim()))throw new Error('Isi catatan kendala untuk HK tanpa hasil.');
   allocations=selected.map(r=>Number(r.hk_realisasi));}
  }else allocations=!complete&&selected.some(r=>r.realisasi===''||r.realisasi==null)?selected.map(()=>null):allocateHK(g.hk,selected.map(r=>r.realisasi===''||r.realisasi==null?0:r.realisasi));
  selected.forEach((r,i)=>items.push({...r,hk_realisasi:allocations[i]}));hk_groups.push({key:g.key,hk:g.manual?(g.hk===''?'':Number(g.hk)):g.hk,manual:g.manual});
 }catch(e){e.group??=gi;throw e;}
 return {items,hk_groups};
}
// Semua kekurangan dikumpulkan sekaligus (error.problems = [{group, field, blok, message}]) agar form bisa menandai setiap isian yang kurang.
export function validatePlan(groups,locations,division){
 const items=[],hk_groups=[],seen=new Set(),activityKeys=new Set(),problems=[];const locs=new Map(locations.map(l=>[l.nama,l]));
 const bad=(group,field,message,blok)=>{problems.push({group,field,message,...(blok!=null?{blok}:{})});};
 groups.forEach((g,gi)=>{const name=String(g.aktivitas||'').trim();
  if(!name)return bad(gi,'aktivitas',`Kegiatan ke-${gi+1}: pilih nama kegiatan.`);
  const groupKey=activityKey(g.aktivitas,g.satuan);if(activityKeys.has(groupKey))return bad(gi,'aktivitas',`Gabungkan blok dengan kegiatan/satuan yang sama dalam satu kartu (${name}).`);activityKeys.add(groupKey);
  const rows=g.rows.filter(r=>r.selected);if(!rows.length)return bad(gi,'blok',`${name}: centang minimal satu blok.`);
  const kind=workKind(division,g.aktivitas,g.satuan,g.jenis),blank=v=>v===''||v==null;
  if(g.hk!==''&&g.hk!=null&&(!Number.isFinite(Number(g.hk))||Number(g.hk)<0))bad(gi,'hk',`${name}: total HK rencana harus angka nol atau lebih.`);
  for(const row of rows){if(!locs.has(row.blok)&&!row.id){bad(gi,'blok',`${name}: blok ${row.blok} tidak ada di GIS aktif.`,row.blok);continue;}const key=groupKey+'|'+row.blok;if(seen.has(key)){bad(gi,'blok',`${name}: blok ${row.blok} terpilih dua kali.`,row.blok);continue;}seen.add(key);
   if(kind.targetRequired&&blank(row.target)){bad(gi,'target',`${name}: isi target blok ${row.blok}.`,row.blok);continue;}
   if(g.satuan!=='HK'&&!blank(row.target)&&(!Number.isFinite(Number(row.target))||Number(row.target)<0)){bad(gi,'target',`${name}: target blok ${row.blok} harus angka nol atau lebih.`,row.blok);continue;}
   if(g.satuan==='ha'&&Number(row.target)>Number(locs.get(row.blok)?.luas_ha||0)*Number(g.times||1)+1e-6&&locs.has(row.blok)&&!(row.id&&Number(row.target)===Number(row._originalTarget))){bad(gi,'target',`${name}: target ha blok ${row.blok} melebihi luas GIS × jumlah pelaksanaan.`,row.blok);continue;}
   items.push({...row,aktivitas:g.aktivitas,satuan:g.satuan,target:g.satuan==='HK'||blank(row.target)?null:row.target,hk_rencana:null});
  }hk_groups.push({key:groupKey,hk:g.hk,manual:false,mode:g.mode,times:g.times,...(kind.locked?{}:{jenis:kind.kind})});
 });

 if(problems.length){const e=new Error(problems.length===1?problems[0].message:`${problems.length} isian belum lengkap. Pertama: ${problems[0].message}`);e.problems=problems;throw e;}
 return {items,hk_groups};
}

// Daily execution targets must not exhaust the same recurring area/population.
export function dailyWorkTarget({row,division,plan,previousItems=[]}){
 const group=parseGroups(plan?.hk_kegiatan).find(g=>g.key===activityKey(row.aktivitas,row.satuan)),repeat=workKind(division,row.aktivitas,row.satuan,group?.jenis).kind==='rutin';
 const planned=plan?.items?.find(p=>row.plan_item_id!=null&&Number(p.id)===Number(row.plan_item_id))||plan?.items?.find(p=>p.blok===row.blok&&activityKey(p.aktivitas,p.satuan)===activityKey(row.aktivitas,row.satuan));
 const raw=planned?.target??row.target;if(raw==null||raw===''||!Number.isFinite(Number(raw))||isDryingWork(division,row.aktivitas))return {remaining:null,repeat};
 const target=Number(raw);
 if(repeat){const times=Math.max(1,Number(group?.times)||1);return {remaining:Math.max(0,planned?target/times:target),repeat};}
 const prior=previousItems.filter(p=>p.blok===row.blok&&activityKey(p.aktivitas,p.satuan)===activityKey(row.aktivitas,row.satuan)).reduce((s,p)=>s+Number(p.realisasi||0),0);
 return {remaining:Math.max(0,target-prior),repeat};
}
