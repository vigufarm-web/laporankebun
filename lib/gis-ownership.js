import clipping from 'polygon-clipping';
const ownedStatuses=new Set(['Sudah Bayar','Lahan Terpisah','Serah Terima']);
const multi=g=>(g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[]).map(p=>p.map(r=>r.map(c=>c.slice(0,2).map(v=>Math.round(v*1e8)/1e8))));
const ringArea=r=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+(p[0]-r[0][0])*(q[1]-r[0][1])-(q[0]-r[0][0])*(p[1]-r[0][1]);},0)/2);
const area=polygons=>polygons.reduce((s,p)=>s+Math.max(0,ringArea(p[0])-p.slice(1).reduce((a,r)=>a+ringArea(r),0)),0);
export function parcelCoverage(geometry,ownedUnion){
 const block=multi(geometry),total=area(block);if(!total||!ownedUnion.length)return 0;
 return Math.min(1,area(clipping.intersection(block,ownedUnion))/total);
}
// This approved parcel layer supplies ownership, while the block registry supplies stable IDs/names.
// Cache derived geometry on the server; mobile clients receive only the small choice list.
export function createParcelLocations(db,blocks){
 let signature='',cached=[];
 return ()=>{
  const candidates=db.prepare("SELECT id,nama,updated_at FROM gis_layer WHERE nama LIKE 'Persil Lahan%' ORDER BY id DESC").all().filter(x=>/^Persil Lahan(?: \d{2}-\d{2}-\d{4})?$/.test(x.nama));
  const parcelDate=x=>{const m=x.nama.match(/(\d{2})-(\d{2})-(\d{4})$/);return m?m[3]+m[2]+m[1]:'00000000';};
  const layer=candidates.sort((a,b)=>parcelDate(b).localeCompare(parcelDate(a))||b.id-a.id)[0];
  const active=blocks.list().filter(b=>b.active);
  const blockLayers=db.prepare("SELECT id,updated_at,field_nama FROM gis_layer WHERE nama='Blok Tanam' ORDER BY id").all();
  const key=JSON.stringify([layer,blockLayers,active]);if(key===signature)return cached;
  let ownedUnion=[];
  if(layer){const source=db.prepare('SELECT geojson FROM gis_layer WHERE id=?').get(layer.id);const fc=JSON.parse(source.geojson||'{}');const polygons=(fc.features||[]).filter(f=>ownedStatuses.has(f.properties?.Status)).map(f=>multi(f.geometry)).filter(x=>x.length);if(polygons.length){try{ownedUnion=clipping.union(...polygons);}catch{ownedUnion=[];}}}
  const geometries=new Map(),divisions=new Map();
  for(const source of blockLayers){const fc=JSON.parse(db.prepare('SELECT geojson FROM gis_layer WHERE id=?').get(source.id).geojson||'{}');for(const f of fc.features||[]){const p=f.properties||{},name=String(p[source.field_nama]||p.Nama_Blok||'').trim();const b=active.find(b=>b.id===(p.blok_id||p.block_id)||b.nama===name||(b.aliases||[]).includes(name));if(!b)continue;geometries.set(b.id,[...(geometries.get(b.id)||[]),...multi(f.geometry)]);divisions.set(b.id,p.Lahan||b.divisi);}}
  const result=[];
  for(const b of active){
   if(!b.layer_id&&!geometries.has(b.id))continue;
   let allowed=b.ownership==='Sudah milik kebun';
   // Explicit block ownership always wins; infer only previously unverified blocks.
   if(b.ownership==='Belum diverifikasi'&&ownedUnion.length){try{const row=geometries.has(b.id)?{type:'MultiPolygon',coordinates:geometries.get(b.id)}:JSON.parse(db.prepare('SELECT geometry FROM _blocks WHERE id=?').get(b.id).geometry||'null');allowed=parcelCoverage(row,ownedUnion)>=0.999;}catch{allowed=false;}}
   if(allowed)result.push({id:b.id,blok_id:b.id,nama:b.nama,divisi:divisions.get(b.id)||b.divisi,jenis:'Blok GIS milik kebun',sumber:'GIS',rank:0});
  }
  signature=key;cached=result;return cached;
 };
}
