const key=v=>String(v||'').trim().toLowerCase();
// Read projection only: historical measured hectares remain untouched in storage.
// Each stage's recognized area is bounded by the owned part of its GIS block.
export function scopePlantingData(data,locations,today){
 const owned=new Map(locations.filter(l=>l.divisi==='Pisang'||!l.divisi).map(l=>[key(l.nama),l]));
 const masters=data.lahan_blok.filter(b=>(b.peruntukan||'Pisang')==='Pisang'&&owned.has(key(b.blok))).map(b=>({...b,luas_ha:owned.get(key(b.blok)).luas_ha>0?Math.min(Number(b.luas_ha)||Infinity,owned.get(key(b.blok)).luas_ha):Number(b.luas_ha)||0}));
 const areas=new Map(masters.map(b=>[key(b.blok),b.luas_ha])),used=new Map();
 const actual=data.lahan_harian.filter(r=>!r.diganti_aktual&&r.tanggal<=today&&areas.has(key(r.blok))).sort((a,b)=>a.tanggal.localeCompare(b.tanggal)||a.id-b.id).map(r=>{const k=key(r.blok)+'|'+key(r.aktivitas),before=used.get(k)||0,ha=Math.min(Math.max(0,Number(r.hasil_ha)||0),Math.max(0,areas.get(key(r.blok))-before));used.set(k,before+ha);return {...r,hasil_ha:ha};});
 return {...data,lahan_blok:masters,lahan_harian:actual,lahan_target:data.lahan_target.filter(t=>areas.has(key(t.blok))),lahan_rencana:data.lahan_rencana.filter(r=>areas.has(key(r.blok))),lahan_aktivitas:data.lahan_aktivitas.map(a=>['Stik Tanam','Tanam'].includes(a.aktivitas)&&a.tim==null?{...a,tim:2}:a)};
}
