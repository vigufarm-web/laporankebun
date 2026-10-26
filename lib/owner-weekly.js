import {activityKey,parseGroups} from '../public/js/daily-work.js';
import {stageForDaily} from './land-actual.js';
import {photoExpired} from './photo-retention.js';
const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,'');
const present=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const hidden=new Set(['Cabut Ajir','Cabut Mulsa','Gulung Drip']);
const fmt=v=>v==null?'Belum tercatat':Number(v).toLocaleString('id-ID',{maximumFractionDigits:2});

export function ownerWeeklyWork({db,from,to,reports,landTargets=[]}){
 const completed=reports.filter(r=>r.status==='Selesai'&&r.tanggal>=from&&r.tanggal<=to).sort((a,b)=>a.tanggal.localeCompare(b.tanggal)||a.id-b.id),groups=new Map(),landHK=new Map();
 for(const r of completed)for(const item of r.items||[]){
  const rawUnit=norm(item.satuan),unit=present(item.realisasi)||present(item.target)?rawUnit:'',stage=rawUnit==='ha'?stageForDaily(item.aktivitas):null;
  if(stage){if(hidden.has(stage))continue;const h=landHK.get(stage)||{actual:null,plans:new Map()};if(present(item.hk_realisasi))h.actual=(h.actual??0)+Number(item.hk_realisasi);if(present(item.target_hk_minggu))h.plans.set(item.block_id||norm(item.blok),Number(item.target_hk_minggu));landHK.set(stage,h);continue;}
  if(!present(item.realisasi)&&!present(item.hk_realisasi))continue;
  const id=[r.divisi,norm(item.aktivitas),unit].join('|'),g=groups.get(id)||{division:r.divisi,activity:item.aktivitas,unit:unit?(item.satuan||''):'',actual:null,hk:null,blocks:new Map()};
  if(present(item.realisasi))g.actual=(g.actual??0)+Number(item.realisasi);
  if(present(item.hk_realisasi))g.hk=(g.hk??0)+Number(item.hk_realisasi);
  // Weekly targets repeat in each day's payload. Keep one latest target for
  // each block; never sum repeated targets or already cumulative SDHI values.
  const block=item.block_id||norm(item.blok),p=g.blocks.get(block)||{target:null,hk:null};
  if(present(item.target))p.target=Number(item.target);
  if(present(item.target_hk_minggu))p.hk=Number(item.target_hk_minggu);
  g.blocks.set(block,p);groups.set(id,g);
 }
 for(const [id,g] of groups)if(!g.unit){const measured=[...groups.values()].filter(x=>x.division===g.division&&norm(x.activity)===norm(g.activity)&&x.unit);if(measured.length===1){const x=measured[0];if(g.hk!=null)x.hk=(x.hk??0)+g.hk;for(const [block,p] of g.blocks){const q=x.blocks.get(block);if(!q)x.blocks.set(block,p);else if(q.hk==null&&p.hk!=null)q.hk=p.hk;}groups.delete(id);}}
 const values=[...groups.values()].map(g=>{const plans=[...g.blocks.values()],target=plans.some(p=>p.target!=null)?plans.reduce((s,p)=>s+(p.target??0),0):null,targetPartial=target!=null&&plans.some(p=>p.target==null);return {...g,blocks:undefined,target,targetPartial,hkPlan:plans.some(p=>p.hk!=null)?plans.reduce((s,p)=>s+(p.hk??0),0):null};});
 const land=db.prepare("SELECT aktivitas,sum(hasil_ha) actual FROM lahan_harian WHERE tanggal BETWEEN ? AND ? AND coalesce(diganti_aktual,0)=0 AND coalesce(source_key,'') NOT LIKE 'baseline:%' GROUP BY aktivitas").all(from,to);
 for(const row of land){const stage=stageForDaily(row.aktivitas);if(!stage||hidden.has(stage)||!(Number(row.actual)>0))continue;const h=landHK.get(stage),target=landTargets.find(t=>t.a===stage);values.push({division:'Progres lahan',activity:stage,unit:'ha',actual:Number(row.actual),target:target?Number(target.target):null,targetPartial:false,hk:h?.actual??null,hkPlan:h?.plans.size?[...h.plans.values()].reduce((s,v)=>s+v,0):null});}
 // A completed land activity with recorded HK but no measured area must not be
 // presented as zero hectares. Retain it with its unknown area marked clearly.
 for(const [stage,h] of landHK)if(!values.some(v=>v.division==='Progres lahan'&&v.activity===stage)&&h.actual!=null)values.push({division:'Progres lahan',activity:stage,unit:'ha',actual:null,target:null,targetPartial:false,hk:h.actual,hkPlan:h.plans.size?[...h.plans.values()].reduce((s,v)=>s+v,0):null});
 const totalPlans=new Map();for(const r of completed)for(const g of parseGroups(r.hk_kegiatan_rencana)){if(g.hk!==''&&g.hk!=null)totalPlans.set([r.divisi,r.tanggal.slice(0,10),g.key].join('|'),{division:r.divisi,key:g.key,hk:Number(g.hk)});}
 // The owner report covers one week: each activity total is repeated in daily payloads, count it once.
 const latestPlans=new Map();for(const g of totalPlans.values())latestPlans.set(g.division+'|'+g.key,g);
 for(const row of values){const matches=[...latestPlans.values()].filter(g=>row.division==='Progres lahan'?row.unit==='ha'&&stageForDaily(g.key.slice(0,g.key.lastIndexOf('|')))===row.activity:g.division===row.division&&(row.unit?g.key===activityKey(row.activity,row.unit):g.key.startsWith(activityKey(row.activity,''))));if(matches.length&&(row.unit||matches.length===1))row.hkPlan=matches.reduce((s,g)=>s+g.hk,0);}
 return values.map(g=>({...g,variance:g.actual!=null&&g.target!=null&&!g.targetPartial?g.actual-g.target:null,percent:g.actual!=null&&g.target>0&&!g.targetPartial?100*g.actual/g.target:null})).sort((a,b)=>a.division.localeCompare(b.division)||a.activity.localeCompare(b.activity,'id')||a.unit.localeCompare(b.unit));
}
export function weeklyWorkSections(work){
 return ['Pisang','Padi','Infra','Progres lahan'].map(division=>({title:division==='Progres lahan'?division:'Pekerjaan mingguan - '+division,headers:['Kegiatan','Target hasil','Hasil minggu','Selisih','Capaian','HK rencana','HK aktual'],weights:[29,15,15,12,10,11,11],rows:work.filter(g=>g.division===division).map(g=>[g.activity,g.target==null?'Belum ada':fmt(g.target)+' '+g.unit+(g.targetPartial?' (sebagian)':''),g.actual==null?'Belum tercatat':fmt(g.actual)+' '+g.unit,g.variance==null?'-':(g.variance>0?'+':'')+fmt(g.variance)+' '+g.unit,g.percent==null?'-':fmt(g.percent)+'%',fmt(g.hkPlan),fmt(g.hk)]),note:'Target mingguan tiap blok dihitung satu kali. Hasil adalah jumlah realisasi harian; SDHI tidak dijumlahkan. Selisih = hasil - target. Target belum ada tidak dianggap nol; capaian tidak dihitung bila target hanya mencakup sebagian blok.'})).filter(s=>s.rows.length);
}
export function selectOwnerPhotos(reports,{maxTotal=21,maxPerDate=3}={}){
 const available=reports.filter(r=>r.status==='Selesai').flatMap(r=>(r.photos||[]).filter(p=>!p.deleted_at&&!photoExpired(p)).map(p=>({report:r,photo:p})));
 const dates=[...new Set(available.map(x=>x.report.tanggal))].sort(),selected=[],used=new Set();
 for(const date of dates){
  const prior=[];
  for(let i=0;i<maxPerDate&&selected.length<maxTotal;i++){
   const candidates=available.filter(x=>x.report.tanggal===date&&!used.has(x.photo.id));
   const score=x=>(norm(x.photo.jenis)==='kegiatan'?100:0)+(prior.every(p=>p.report.divisi!==x.report.divisi)?30:0)+(!/^kegiatan\s*(pisang|padi|infra)?$/i.test(x.photo.caption||'')&&x.photo.caption?15:0)+(prior.every(p=>norm(p.photo.caption)!==norm(x.photo.caption))?10:0);
   candidates.sort((a,b)=>score(b)-score(a)||a.photo.id-b.photo.id);
   if(!candidates.length)break;selected.push(candidates[0]);prior.push(candidates[0]);used.add(candidates[0].photo.id);
  }
 }
 const ids=new Set(selected.map(x=>x.photo.id));return reports.map(r=>({...r,photos:(r.photos||[]).filter(p=>ids.has(p.id))})).filter(r=>r.photos.length).sort((a,b)=>a.tanggal.localeCompare(b.tanggal)||a.divisi.localeCompare(b.divisi));
}
export function ownerWeeklyNotes(reports){
 const rows=[];for(const r of reports.filter(r=>r.status==='Selesai'))for(const [field,label] of [['kendala','Kendala'],['tindak_lanjut','Tindak lanjut']])if(r[field]?.trim()&&!rows.some(x=>x.division===r.divisi&&x.label===label&&norm(x.text)===norm(r[field])))rows.push({division:r.divisi,label,text:r[field].trim()});return rows;
}
