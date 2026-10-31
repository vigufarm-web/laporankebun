// Read-only compatibility for reports while local IDs and historical sources
// remain untouched. Missing catalog tables mean pre-migration behavior.
export function centralPlantings(db){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_gis_plantings'").get())return [];
 return db.prepare('SELECT * FROM _gis_plantings ORDER BY planted_on,id').all().map(p=>({...p,area_ha:p.commodity==='Pisang'&&p.population!=null?Number(p.population)/2000:p.area_ha,current_population:p.population==null?null:Number(p.population)+Number(p.replacement_plants||0)-Number(p.lost_plants||0)}));
}
export function overlayRiceSeasons(db,seasons,locations,today){
 const groups=centralPlantings(db).filter(p=>p.commodity==='Padi'),bySource=new Map(groups.filter(p=>p.source_key).map(p=>[p.source_key,p]));
 const result=seasons.map(r=>{const p=bySource.get('padi_tanam:'+r.id);return p?{...r,tgl_tanam:p.planted_on,luas_tanam_ha:p.area_ha,varietas:p.variety,gis_closed_on:p.closed_on}:r;});
 for(const p of groups.filter(p=>!p.source_key)){const b=locations.find(l=>l.id===p.block_id);if(!b)continue;const m=String(p.season||'').match(/(MT[123])\s+(\d{4})/);result.push({id:'gis:'+p.id,block_id:p.block_id,petak:b.nama,tgl_tanam:p.planted_on,luas_tanam_ha:p.area_ha,varietas:p.variety,musim:m?.[1]||p.season,tahun:m?.[2]||p.planted_on?.slice(0,4),gis_closed_on:p.closed_on});}
 return result.filter(r=>!r.gis_closed_on||r.gis_closed_on>today);
}
