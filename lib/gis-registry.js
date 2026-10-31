import crypto from 'node:crypto';

const parse=(s,f=null)=>{try{return JSON.parse(s);}catch{return f;}};
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const date=value=>{if(!value)return null;const s=String(value),time=Date.parse(s+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==s)fail('Tanggal tidak valid.');return s;};
const number=(v,label)=>{if(v==null||v==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<0)fail(label+' harus nol atau lebih.');return n;};
export const CYCLES=[['PC',0,52],['R1',53,91],['R2',92,130],['R3',131,169],['R4',170,null]];
export function plantState(p,at){
 const planted=date(p.planted_on),asOf=date(at),weeks=planted&&asOf>=planted?Math.floor((Date.parse(asOf)-Date.parse(planted))/604800000):null;
 const overrides=(p.cycle_overrides||[]).filter(x=>x.from<=at).sort((a,b)=>a.from.localeCompare(b.from)),override=overrides.at(-1);
 const isBanana=p.commodity==='Pisang',initial=p.population==null?null:Number(p.population),replacement=p.replacement_plants==null?null:Number(p.replacement_plants),lost=p.lost_plants==null?null:Number(p.lost_plants);
 return {...p,area_ha:isBanana&&initial!=null?initial/2000:p.area_ha,area_from_plants_ha:isBanana&&initial!=null?initial/2000:null,current_population:isBanana&&initial!=null?initial+(replacement||0)-(lost||0):null,age_weeks:weeks,cycle:p.commodity==='Pisang'?(override?.cycle||CYCLES.find(([,from,to])=>weeks!=null&&weeks>=from&&(to==null||weeks<=to))?.[0]||null):null};
}

// Central catalog shares the existing durable connection; it never reads wages,
// passwords, tokens or photos. A separate UI can consume this bounded contract.
export function createGISRegistry({db,blocks,clock=()=>new Date().toISOString(),actor=()=>''}){
 const today=()=>new Date(Date.parse(clock())+7*3600000).toISOString().slice(0,10);
 function migrate(){
  for(const sql of `CREATE TABLE IF NOT EXISTS _gis_block_versions(block_id TEXT,version INTEGER,payload TEXT NOT NULL,reason TEXT,actor TEXT,recorded_at TEXT,PRIMARY KEY(block_id,version));
  CREATE TABLE IF NOT EXISTS _gis_plantings(id TEXT PRIMARY KEY,block_id TEXT NOT NULL,commodity TEXT NOT NULL,label TEXT,planted_on TEXT,area_ha REAL,population REAL,variety TEXT,season TEXT,closed_on TEXT,cycle_overrides TEXT NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1,source_key TEXT UNIQUE,updated_at TEXT);
  CREATE TABLE IF NOT EXISTS _gis_planting_revisions(id INTEGER PRIMARY KEY,planting_id TEXT,version INTEGER,before_json TEXT,after_json TEXT,reason TEXT,actor TEXT,recorded_at TEXT);
  CREATE INDEX IF NOT EXISTS gis_plantings_block ON _gis_plantings(block_id);
  CREATE TABLE IF NOT EXISTS _gis_commodities(name TEXT PRIMARY KEY,created_at TEXT);
  CREATE TABLE IF NOT EXISTS _gis_reference_tokens(hash TEXT PRIMARY KEY,app TEXT,expires TEXT,actor TEXT,created_at TEXT);`.split(';').map(s=>s.trim()).filter(Boolean))db.exec(sql);
  const columns=new Set(db.prepare('PRAGMA table_info(_gis_plantings)').all().map(c=>c.name));for(const [name,type]of [['replacement_plants','INTEGER'],['lost_plants','INTEGER'],['reported_area_ha','REAL'],['notes','TEXT']])if(!columns.has(name))db.exec('ALTER TABLE _gis_plantings ADD COLUMN '+name+' '+type);
 }
 const current=id=>{const r=db.prepare('SELECT id,nama,aliases,divisi,ownership,active,layer_id,geometry,parents,luas_ha FROM _blocks WHERE id=?').get(id);if(!r)fail('Blok GIS tidak ditemukan.',404);return r;};
 function recordBlock(id,reason='Referensi GIS',ownedArea){
  const old=db.prepare('SELECT * FROM _gis_block_versions WHERE block_id=? ORDER BY version DESC LIMIT 1').get(id),prior=old?parse(old.payload):null;
  const raw=current(id),{geometry,...attributes}=raw;
  const payload=JSON.stringify({...attributes,geometry_sha256:geometry?crypto.createHash('sha256').update(geometry).digest('hex'):null,...(ownedArea!==undefined?{owned_area_ha:ownedArea}:prior&&'owned_area_ha' in prior?{owned_area_ha:prior.owned_area_ha}:{})});
  if(old?.payload===payload)return old.version;
  const version=(old?.version||0)+1;db.prepare('INSERT INTO _gis_block_versions VALUES(?,?,?,?,?,?)').run(id,version,payload,reason,actor(),clock());return version;
 }
 function snapshot(id){const b=current(id),v=db.prepare('SELECT version FROM _gis_block_versions WHERE block_id=? ORDER BY version DESC LIMIT 1').get(id);return {gis_block_id:id,version:v?.version||recordBlock(id,'Baseline saat pencatatan'),name:b.nama,gis_area_ha:b.luas_ha,commodity:b.divisi,recorded_at:clock()};}
 const plantings=()=>db.prepare('SELECT * FROM _gis_plantings ORDER BY commodity,block_id,planted_on,id').all().map(p=>({...p,area_ha:p.commodity==='Pisang'&&p.population!=null?Number(p.population)/2000:p.area_ha,cycle_overrides:parse(p.cycle_overrides,[])}));
 function catalog(at=today(),owned=[]){
  date(at);const areas=new Map(owned.map(b=>[b.id,b])),plants=plantings();
  const rows=blocks.list().map(b=>{const v=db.prepare('SELECT version,recorded_at FROM _gis_block_versions WHERE block_id=? ORDER BY version DESC LIMIT 1').get(b.id);return {id:b.id,name:b.nama,aliases:b.aliases,commodity:b.divisi,active:!!b.active&&!!b.layer_id,mapped:!!b.layer_id,ownership:b.ownership,gis_area_ha:b.luas_ha,owned_area_ha:areas.get(b.id)?.luas_ha??(b.ownership==='Sudah milik kebun'?b.luas_ha:null),version:v?.version||0,parents:b.parents,plantings:plants.filter(p=>p.block_id===b.id).map(p=>plantState(p,at))};});
  const revision=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');return {schema:1,revision,as_of:at,cycle_rules:CYCLES,commodities:[...new Set([...rows.map(r=>r.commodity),...plants.map(p=>p.commodity),...db.prepare('SELECT name FROM _gis_commodities ORDER BY name').all().map(r=>r.name)].filter(Boolean))],blocks:rows};
 }
 function savePlanting(input){
  const old=input.id?db.prepare('SELECT * FROM _gis_plantings WHERE id=?').get(input.id):null;
  if(input.id&&!old)fail('Kelompok tanam tidak ditemukan.',404);
  if(old&&Number(input.expected_version)!==old.version)fail('Data tanaman sudah berubah. Muat ulang sebelum menyimpan.',409);
  const block=current(input.block_id||old?.block_id);if(!block.active)fail('Blok tidak aktif; gunakan blok aktif untuk data tanaman baru.');
  const commodity=String(input.commodity||old?.commodity||block.divisi||'').trim();if(!commodity||commodity.length>80)fail('Komoditas wajib diisi.');
  if((!old&&commodity!==block.divisi)||(old&&commodity!==old.commodity))fail('Komoditas kelompok mengikuti data GIS; tutup kelompok lama bila mengganti komoditas.');
  const planted_on=date(input.planted_on),closed_on=date(input.closed_on);if(closed_on&&planted_on&&closed_on<planted_on)fail('Tanggal tutup mendahului tanggal tanam.');
  const population=commodity==='Padi'?null:number(input.population,'Pokok tanam'),replacement_plants=commodity==='Pisang'?number(input.replacement_plants,'Pokok sulam'):null,lost_plants=commodity==='Pisang'?number(input.lost_plants,'Pokok mati / hilang'):null;
  for(const n of [population,replacement_plants,lost_plants])if(n!=null&&!Number.isInteger(n))fail('Jumlah pokok harus bilangan bulat.');
  if(commodity==='Padi'&&['population','replacement_plants','lost_plants'].some(k=>input[k]!=null&&input[k]!==''))fail('Padi memakai luas tanam, bukan jumlah pokok atau sulam Pisang.');
  if(commodity==='Pisang'&&population==null)fail('Isi pokok tanam Pisang untuk menghitung luas tanam.');
  if(population!=null&&(lost_plants||0)>population+(replacement_plants||0))fail('Pokok mati/hilang melebihi pokok tanam dan sulam.');
  const area_ha=commodity==='Pisang'?population/2000:number(input.area_ha,'Luas tanam');
  // Existing oversized legacy groups remain visible until reviewed. New edits
  // cannot silently allocate more active planted area than the current boundary.
  const from=planted_on||'0001-01-01',to=closed_on||'9999-12-31',overlaps=plantings().filter(p=>p.block_id===block.id&&p.id!==old?.id&&(p.planted_on||'0001-01-01')<to&&(p.closed_on||'9999-12-31')>from),events=[];
  for(const p of overlaps){const a=(p.planted_on||'0001-01-01')>from?p.planted_on:from,z=(p.closed_on||'9999-12-31')<to?p.closed_on:to;events.push([a,Number(p.area_ha||0)],[z,-Number(p.area_ha||0)]);}
  let used=0,peak=0;for(const [,value]of events.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1])){used+=value;peak=Math.max(peak,used);}
  if(area_ha!=null&&block.luas_ha!=null&&peak+area_ha>Number(block.luas_ha)+1e-6)fail('Total luas kelompok tanam pada periode yang sama melebihi luas batas GIS.');
  const reason=String(input.reason||'').trim();if(!reason)fail('Alasan perubahan wajib diisi.');
  const overrides=old?parse(old.cycle_overrides,[]):[];
  if(input.cycle_override!==undefined){if(commodity!=='Pisang')fail('Koreksi siklus ini khusus Pisang.');const cycle=String(input.cycle_override||'');if(cycle&&!CYCLES.some(x=>x[0]===cycle))fail('Siklus tidak dikenal.');overrides.push({from:date(input.cycle_effective_on)||today(),cycle:cycle||null,reason});}
  const r={id:old?.id||crypto.randomUUID(),block_id:block.id,commodity,label:String(input.label||'').trim(),planted_on,area_ha,population,variety:String(input.variety||'').trim(),season:String(input.season||'').trim(),closed_on,cycle_overrides:JSON.stringify(overrides),version:(old?.version||0)+1,source_key:old?.source_key||null,replacement_plants,lost_plants,reported_area_ha:old?.reported_area_ha??old?.area_ha??null,notes:String(input.notes||'').trim().slice(0,2000),updated_at:clock()};
  if(old){const keys=Object.keys(r).filter(k=>k!=='id');db.prepare('UPDATE _gis_plantings SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>r[k]),r.id);}else{const keys=Object.keys(r);db.prepare('INSERT INTO _gis_plantings('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>r[k]));}
  db.prepare('INSERT INTO _gis_planting_revisions(planting_id,version,before_json,after_json,reason,actor,recorded_at) VALUES(?,?,?,?,?,?,?)').run(r.id,r.version,old?JSON.stringify(old):null,JSON.stringify(r),reason,actor(),clock());
  db.prepare('INSERT OR IGNORE INTO _gis_commodities VALUES(?,?)').run(commodity,clock());return {...r,cycle_overrides:overrides};
 }
 function legacyPreview(){
  const existing=new Set(plantings().map(p=>p.source_key)),rows=[],unmatched=[];
  for(const [table,name,commodity] of [['pisang_blok','nama_blok','Pisang'],['padi_tanam','petak','Padi']])for(const r of db.prepare('SELECT * FROM '+table).all()){
   const source_key=table+':'+r.id;if(existing.has(source_key))continue;
   const b=r.block_id?blocks.list().find(b=>b.id===r.block_id):blocks.find(r[name]);
   if(!b||!b.layer_id){unmatched.push({source_key,name:r[name],commodity,reason:'Belum cocok ke batas blok GIS.'});continue;}
   rows.push({source_key,block_id:b.id,name:b.nama,commodity,planted_on:(table==='padi_tanam'?r.tgl_tanam:r.tanggal_tanam)||null,area_ha:(table==='padi_tanam'?r.luas_tanam_ha:r.luas_ha)??null,population:r.pokok_tanam??null,replacement_plants:r.sulam??null,lost_plants:r.kehilangan??null,notes:r.keterangan||'',variety:r.klon||r.varietas||'',season:table==='padi_tanam'?[r.musim,r.tahun].filter(Boolean).join(' '):'',label:table==='pisang_blok'?'Data induk Pisang':'Musim Padi',legacy_status:r.status||null});
  }
  const seen=new Map();for(const r of rows){const key=r.block_id+'|'+r.commodity+'|'+(r.commodity==='Padi'?r.season:'induk');seen.set(key,(seen.get(key)||0)+1);}
  const safe=rows.filter(r=>{const key=r.block_id+'|'+r.commodity+'|'+(r.commodity==='Padi'?r.season:'induk');if(seen.get(key)>1){unmatched.push({...r,reason:'Beberapa baris induk untuk blok/musim yang sama; perlu penetapan kelompok sebelum migrasi.'});return false;}try{date(r.planted_on);}catch{unmatched.push({...r,reason:'Tanggal sumber perlu diperiksa.'});return false;}return true;});
  const token=crypto.createHash('sha256').update(JSON.stringify({rows:safe,unmatched,blocks:blocks.list()})).digest('hex');return {rows:safe,unmatched,token};
 }
 function importLegacy(token){const p=legacyPreview();if(token!==p.token)fail('Pratinjau migrasi sudah berubah.',409);for(const b of blocks.list())recordBlock(b.id,'Baseline sebelum integrasi');for(const r of p.rows){const id=crypto.randomUUID();db.prepare('INSERT INTO _gis_plantings(id,block_id,commodity,label,planted_on,area_ha,population,variety,season,source_key,updated_at,replacement_plants,lost_plants,reported_area_ha,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,r.block_id,r.commodity,r.label,r.planted_on,r.area_ha,r.population,r.variety,r.season,r.source_key,clock(),r.replacement_plants,r.lost_plants,r.area_ha,r.notes);db.prepare('INSERT INTO _gis_planting_revisions(planting_id,version,after_json,reason,actor,recorded_at) VALUES(?,1,?,?,?,?)').run(id,JSON.stringify(r),'Migrasi data induk; data asal dipertahankan',actor(),clock());}return {imported:p.rows.length,unmatched:p.unmatched};}
 const history=id=>({block:db.prepare('SELECT version,payload,reason,actor,recorded_at FROM _gis_block_versions WHERE block_id=? ORDER BY version DESC').all(id).map(v=>({...v,payload:parse(v.payload)})),plantings:db.prepare('SELECT * FROM _gis_planting_revisions WHERE planting_id IN (SELECT id FROM _gis_plantings WHERE block_id=?) ORDER BY id DESC').all(id).map(v=>({...v,before:parse(v.before_json),after:parse(v.after_json),before_json:undefined,after_json:undefined}))});
 function grant(app){if(!['payrol','gudang'].includes(app))fail('Aplikasi tujuan tidak dikenal.');const token=crypto.randomBytes(32).toString('hex'),expires=new Date(Date.parse(clock())+8*3600000).toISOString();db.prepare('DELETE FROM _gis_reference_tokens WHERE expires<?').run(clock());db.prepare('INSERT INTO _gis_reference_tokens VALUES(?,?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),app,expires,actor(),clock());return {token,expires,app};}
 function verifyGrant(token,app){if(typeof token!=='string'||token.length!==64)return false;return !!db.prepare('SELECT 1 FROM _gis_reference_tokens WHERE hash=? AND app=? AND expires>?').get(crypto.createHash('sha256').update(token).digest('hex'),app,clock());}
 return {migrate,recordBlock,snapshot,catalog,savePlanting,legacyPreview,importLegacy,history,plantings,grant,verifyGrant};
}
