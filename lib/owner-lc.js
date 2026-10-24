// The operator's division (Infra) is not the crop. Resolve the crop from the
// block master and retain an explicit unknown bucket rather than guessing.
const key=v=>String(v||'').trim().toLowerCase();
export function ownerLandClearing(db,from,to){
 const crops=new Map(db.prepare('SELECT blok,peruntukan FROM lahan_blok').all().map(b=>[key(b.blok),b.peruntukan]));
 const groups=new Map();
 for(const r of db.prepare("SELECT blok,aktivitas,hasil_ha FROM lahan_harian WHERE tanggal BETWEEN ? AND ? AND coalesce(diganti_aktual,0)=0 AND coalesce(source_key,'') NOT LIKE 'baseline:%'").all(from,to)){
  if(!/^(land clearing|lc)$/i.test(String(r.aktivitas||'').trim())||!(Number(r.hasil_ha)>0))continue;
  const crop=crops.get(key(r.blok)),label=crop==='Pisang'?'LC Pisang':crop==='Padi'?'LC Padi':'LC · komoditas belum ditentukan';groups.set(label,(groups.get(label)||0)+Number(r.hasil_ha));
 }
 return [...groups].map(([label,ha])=>({label,ha}));
}
