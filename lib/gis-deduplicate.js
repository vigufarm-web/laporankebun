export function removeDuplicateParcelLayer(db){
 const old=db.prepare("SELECT id,geojson FROM gis_layer WHERE nama='Persil Lahan' ORDER BY id LIMIT 1").get();
 const latest=db.prepare("SELECT id,geojson FROM gis_layer WHERE nama='Persil Lahan 21-10-2026' ORDER BY id DESC LIMIT 1").get();
 if(!old||!latest)return null;
 const normalize=x=>Array.isArray(x)?x.map(normalize):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).filter(k=>k!=='bbox').sort().map(k=>[k,normalize(x[k])])):typeof x==='number'?Math.round(x*1e10)/1e10:x;
 try{
  const a=JSON.parse(old.geojson),b=JSON.parse(latest.geojson);
  if(a.type!==b.type||JSON.stringify(normalize(a.features))!==JSON.stringify(normalize(b.features)))return null;
  if(db.prepare('SELECT 1 FROM _blocks WHERE layer_id=? LIMIT 1').get(old.id))return null;
  db.prepare('DELETE FROM gis_layer WHERE id=?').run(old.id);
  return {removed:old.id,kept:latest.id,features:b.features.length};
 }catch{return null;}
}
