import {padiKey} from '../public/js/schema.js';
const n=v=>Number(v)||0;
const key=v=>String(v||'').trim().toLowerCase();
const eligible=(date,today)=>!date||date<=today;
function noteStatus(value){const s=String(value||'');if(/(?:belum|belom)\s+panen/i.test(s))return 'Sudah Tanam';if(/sudah\s+panen|terpanen|selesai\s+panen/i.test(s))return 'Sudah Panen';if(/olah\s+lahan/i.test(s))return 'Olah Lahan';if(/belum\s+tanam/i.test(s))return 'Belum Tanam';if(/perawatan|sudah\s+tanam/i.test(s))return 'Sudah Tanam';if(/\bbera\b/i.test(s))return 'Bera';return null;}
function noteDate(value){const m=String(value||'').match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)[a-z]*\s+(20\d{2})/i);return m?`${m[3]}-${String(['jan','feb','mar','apr','mei','jun','jul','agu','sep','okt','nov','des'].indexOf(m[2].toLowerCase())+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`:null;}
export function padiSummary(db,locations,today){
 const read=t=>db.prepare('SELECT * FROM '+t).all();
 const masters=read('padi_petak'),seasons=read('padi_tanam').filter(r=>eligible(r.tgl_tanam||r.tgl_semai,today)),harvest=read('padi_panen').filter(r=>eligible(r.tanggal,today)),milling=read('padi_giling').filter(r=>eligible(r.tanggal,today));
 const blocks=locations.filter(l=>l.divisi==='Padi').map(l=>{
  const matches=masters.filter(r=>key(r.nama_petak)===key(l.nama)),master=matches.sort((a,b)=>n(b.id)-n(a.id))[0]||{};
  const ss=seasons.filter(r=>key(r.petak)===key(l.nama)).sort((a,b)=>(b.tgl_tanam||b.tgl_semai||'').localeCompare(a.tgl_tanam||a.tgl_semai||'')||n(b.id)-n(a.id)),season=ss[0];
  const hs=harvest.filter(r=>key(r.petak)===key(l.nama)),lastHarvest=hs.map(r=>r.tanggal||'').sort().at(-1)||null;
  const harvestCurrent=hs.some(r=>season&&r.musim_tanam?key(r.musim_tanam)===key(padiKey(season)):!season?.tgl_tanam||!r.tanggal||r.tanggal>=season.tgl_tanam);
  const note=noteStatus(master.keterangan),noted=noteDate(master.keterangan);
  const replanted=season?.tgl_tanam&&lastHarvest&&season.tgl_tanam>lastHarvest&&(!note||noted&&season.tgl_tanam>noted);
  let status=harvestCurrent?'Sudah Panen':replanted?'Sudah Tanam':note||master.status||(season?.tgl_tanam?'Sudah Tanam':season?.tgl_semai?'Persemaian':'Belum tercatat');
  const area=Math.max(0,n(l.luas_ha)),planted=status==='Sudah Tanam'?Math.min(area,season?.luas_tanam_ha!=null?n(season.luas_tanam_ha):area):0,harvested=status==='Sudah Panen'?area:0;
  return {name:l.nama,area,status,plantedHa:planted,harvestedHa:harvested,otherHa:Math.max(0,area-planted-harvested),variety:season?.varietas||null,plantDate:season?.tgl_tanam||null,lastHarvest,season:season?padiKey(season):null};
 }).sort((a,b)=>a.name.localeCompare(b.name,'id',{numeric:true}));
 const seeds=read('padi_benih').filter(r=>eligible(r.tanggal,today)),varieties=new Map();
 for(const r of seeds){const k=key(r.varietas),s=varieties.get(k)||{name:r.varietas||'Belum diisi',incoming:0,used:0,rejected:0,balance:0,lastArrival:null};if(r.jenis==='Masuk'){s.incoming+=n(r.qty_kg);if(r.tanggal&&r.tanggal>(s.lastArrival||''))s.lastArrival=r.tanggal;}else if(r.jenis==='Pakai')s.used+=n(r.qty_kg);else if(r.jenis==='Afkir')s.rejected+=n(r.qty_kg);s.balance=s.incoming-s.used-s.rejected;varieties.set(k,s);}
 const months=[...new Set([...harvest.map(r=>r.tanggal?.slice(0,7)),...milling.map(r=>r.tanggal?.slice(0,7))].filter(Boolean))].sort().reverse().map(month=>{const h=harvest.filter(r=>r.tanggal?.startsWith(month)),g=milling.filter(r=>r.tanggal?.startsWith(month));return {month,gkg:h.reduce((s,r)=>s+n(r.gkg_kg),0),estimated:h.filter(r=>r.gkg_basis==='Estimasi').reduce((s,r)=>s+n(r.gkg_kg),0),rice:g.reduce((s,r)=>s+n(r.beras_kg),0),milledGabah:g.reduce((s,r)=>s+n(r.gabah_kg),0)};});
 return {today,area:blocks.reduce((s,b)=>s+b.area,0),plantedHa:blocks.reduce((s,b)=>s+b.plantedHa,0),harvestedHa:blocks.reduce((s,b)=>s+b.harvestedHa,0),otherHa:blocks.reduce((s,b)=>s+b.otherHa,0),blocks,seeds:{entries:seeds.length,varieties:[...varieties.values()],rows:seeds.map(r=>({date:r.tanggal,variety:r.varietas,type:r.jenis,kg:n(r.qty_kg)})).sort((a,b)=>(b.date||'').localeCompare(a.date||''))},months,undatedGkg:harvest.filter(r=>!r.tanggal).reduce((s,r)=>s+n(r.gkg_kg),0)};
}
