import crypto from 'node:crypto';

const norm = v => String(v ?? '').trim().toLowerCase();
const quote = v => '"' + v.replaceAll('"', '') + '"';
const parse = (v, fallback = []) => { try { return JSON.parse(v); } catch { return fallback; } };
const owned = p => p.kepemilikan ? p.kepemilikan === 'Sudah milik kebun' : ['Sudah Bayar', 'Lahan Terpisah', 'Belum ST'].includes(p.Status);
export const isBlockLayer = r => /blok\s*tanam|blok\s*kebun|petak\s*kebun/i.test(`${r?.jenis || ''} ${r?.nama || ''}`);

// IDs are permanent. Names remain in old columns for backwards-compatible reports/Excel.
export function createBlockRegistry({ db, TABLES, cascadeRename, log, clock = () => new Date().toISOString() }) {
  const masters = { lahan_blok: 'blok', pisang_blok: 'nama_blok', padi_petak: 'nama_petak' };
  const refs = Object.entries(TABLES).flatMap(([table, T]) => {
    const fields = T.f.filter(f => f.t === 'ref' && masters[f.ref]).map(f => f.k);
    if (masters[table]) fields.push(masters[table]);
    if (['daily_item','daily_week_item'].includes(table)) fields.push('blok');
    const direct=[...new Set(fields)].map(field=>({table,field}));
    const seasonal=T.f.filter(f=>f.t==='ref'&&f.ref==='padi_tanam').map(f=>({table,field:f.k,parentTable:'padi_tanam'}));
    return [...direct,...seasonal];
  });
  function areaHa(feature) {
    const p=feature.properties||{};if(Number(p.Area_New)>0)return Number(p.Area_New)/10000;if(Number(p.Shape_Area)>0)return Number(p.Shape_Area)/10000;
    const g=feature.geometry;if(!g||!['Polygon','MultiPolygon'].includes(g.type))return null;
    const ringArea=ring=>{let sum=0;for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1],rad=Math.PI/180;if(Math.abs(a[0])>180||Math.abs(a[1])>90)return null;let delta=(b[0]-a[0])*rad;if(delta>Math.PI)delta-=2*Math.PI;if(delta<-Math.PI)delta+=2*Math.PI;sum+=delta*(2+Math.sin(a[1]*rad)+Math.sin(b[1]*rad));}return Math.abs(sum*6378137**2/2)/10000;};
    let total=0;for(const polygon of g.type==='Polygon'?[g.coordinates]:g.coordinates){const areas=polygon.map(ringArea);if(areas.some(x=>x==null))return null;total+=areas[0]-areas.slice(1).reduce((a,b)=>a+b,0);}return total;
  }
  function migrate() {
    db.exec('CREATE TABLE IF NOT EXISTS _blocks (id TEXT PRIMARY KEY, nama TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT \'[]\', divisi TEXT, ownership TEXT, active INTEGER NOT NULL DEFAULT 1, layer_id INTEGER, geometry TEXT, parents TEXT NOT NULL DEFAULT \'[]\', created_at TEXT, updated_at TEXT)');
    if(!db.prepare('PRAGMA table_info(_blocks)').all().some(x=>x.name==='luas_ha'))db.exec('ALTER TABLE _blocks ADD COLUMN luas_ha REAL');
    db.exec('CREATE TABLE IF NOT EXISTS _gis_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, layer_id INTEGER, before_json TEXT, after_json TEXT, summary TEXT, oleh TEXT, created_at TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS _block_links (table_name TEXT, row_id INTEGER, field_name TEXT, block_id TEXT, snapshot TEXT, PRIMARY KEY(table_name,row_id,field_name,block_id))');
    db.exec('CREATE INDEX IF NOT EXISTS block_links_identity ON _block_links(block_id, table_name)');
    db.exec('CREATE INDEX IF NOT EXISTS blocks_layer ON _blocks(layer_id,active)');
    for (const {table} of refs) {
      const cols = new Set(db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(x=>x.name));
      for (const field of ['block_id','block_name_snapshot']) if (!cols.has(field)) db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${field} TEXT`);
    }
  }
  const list = () => db.prepare('SELECT * FROM _blocks ORDER BY nama').all().map(r=>({...r,aliases:parse(r.aliases),parents:parse(r.parents),geometry:undefined}));
  function find(name) {
    const k=norm(name); if (!k) return null;
    const all=list(), exact=all.filter(b=>norm(b.nama)===k);
    if(exact.length===1)return exact[0];
    const aliases=all.filter(b=>b.aliases.some(a=>norm(a)===k));
    return aliases.length===1 ? aliases[0] : null;
  }
  function create(name, extra={}) {
    const id=extra.id || crypto.randomUUID(), t=clock();
    db.prepare('INSERT INTO _blocks (id,nama,aliases,divisi,ownership,active,layer_id,geometry,parents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,name,'[]',extra.divisi||'Umum',extra.ownership||'Belum diverifikasi',1,extra.layer_id||null,extra.geometry||null,JSON.stringify(extra.parents||[]),t,t);
    return find(name);
  }
  function canonical(table, input) {
    const row={...input}, cfg=refs.filter(x=>x.table===table);
    for(const {field,parentTable} of cfg) {
      if(parentTable)continue;
      if(!row[field])continue;
      const b=row.block_id ? list().find(x=>x.id===row.block_id) : find(row[field]);
      if(b) {row[field]=b.nama;row.block_id=b.id;row.block_name_snapshot=row.block_name_snapshot || String(input[field]);}
    }
    return row;
  }
  function linkTable(table) {
    const cfg=refs.filter(x=>x.table===table);if(!cfg.length)return;
    for(const r of db.prepare(`SELECT * FROM ${quote(table)}`).all()) {
      for(const {field,parentTable} of cfg) {
        if(!r[field])continue;
        if(parentTable){const parent=db.prepare('SELECT * FROM padi_tanam').all().find(p=>norm((p.petak+' · '+(p.musim||'')+' '+(p.tahun||'')).trim())===norm(r[field]));const b=parent&&(list().find(b=>b.id===parent.block_id)||find(parent.petak));if(b){if(!db.prepare('SELECT 1 FROM _block_links WHERE table_name=? AND row_id=? AND field_name=? AND block_id=?').get(table,r.id,field,b.id))db.prepare('INSERT OR IGNORE INTO _block_links (table_name,row_id,field_name,block_id,snapshot) VALUES (?,?,?,?,?)').run(table,r.id,field,b.id,parent.block_name_snapshot||parent.petak);if(r.block_id!==b.id||!r.block_name_snapshot)db.prepare('UPDATE '+quote(table)+' SET block_id=?,block_name_snapshot=COALESCE(block_name_snapshot,?) WHERE id=?').run(b.id,parent.block_name_snapshot||parent.petak,r.id);}continue;}
        const desired=new Set();
        const names=find(r[field]) ? [r[field]] : String(r[field]).split(/\s*,\s*/).filter(Boolean);
        for(const name of names) {
          let b=find(name);
          if(!b) b=create(name);desired.add(b.id); // preserve unmatched historical names; never infer ownership
          if(!db.prepare('SELECT 1 FROM _block_links WHERE table_name=? AND row_id=? AND field_name=? AND block_id=?').get(table,r.id,field,b.id)) db.prepare('INSERT OR IGNORE INTO _block_links (table_name,row_id,field_name,block_id,snapshot) VALUES (?,?,?,?,?)').run(table,r.id,field,b.id,names.length===1 ? (r.block_name_snapshot || name) : name);
          if(names.length===1 && (r.block_id!==b.id || !r.block_name_snapshot)) db.prepare(`UPDATE ${quote(table)} SET block_id=?, block_name_snapshot=COALESCE(block_name_snapshot,?) WHERE id=?`).run(b.id,name,r.id);
        }
        for(const old of db.prepare('SELECT block_id FROM _block_links WHERE table_name=? AND row_id=? AND field_name=?').all(table,r.id,field))if(!desired.has(old.block_id))db.prepare('DELETE FROM _block_links WHERE table_name=? AND row_id=? AND field_name=? AND block_id=?').run(table,r.id,field,old.block_id);
      }
    }
  }
  function rename(id, name) {
    const old=list().find(x=>x.id===id);if(!old || old.nama===name)return;
    const clash=list().find(x=>norm(x.nama)===norm(name)&&x.id!==id);
    if(clash)throw new Error(`Nama blok ${name} sudah digunakan ID lain. Gunakan relasi gabung blok, bukan mengganti ID.`);
    const aliases=[...new Set([...old.aliases,old.nama])];
    db.prepare('UPDATE _blocks SET nama=?,aliases=?,updated_at=? WHERE id=?').run(name,JSON.stringify(aliases),clock(),id);
    for(const {table,field} of refs) {
      const links=db.prepare('SELECT * FROM _block_links WHERE block_id=? AND table_name=? AND field_name=?').all(id,table,field);
      for(const l of links) {
        const r=db.prepare(`SELECT * FROM ${quote(table)} WHERE id=?`).get(l.row_id);if(!r)continue;
        const before=r[field];const next=String(before).split(/\s*,\s*/).map(v=>norm(v)===norm(old.nama)||old.aliases.some(a=>norm(a)===norm(v))?name:v).join(', ');
        db.prepare(`UPDATE ${quote(table)} SET ${quote(field)}=?,updated_at=? WHERE id=?`).run(next,clock(),r.id);
        if(masters[table] && before!==next) cascadeRename(table,before,next);
      }
    }
    log('ganti nama GIS','_blocks',null,{block_id:id,nama_lama:old.nama,nama_baru:name});
  }
  function featureName(f, layer) {const p=f.properties||{};return String(p[layer.field_nama] || p.Nama_Blok || p.nama_blok || p.Blok || p.NAMA_BLOK || '').trim();}
  function plan(layer, { mappings={}, initializing=false }={}) {
    const fc=typeof layer.geojson==='string'?JSON.parse(layer.geojson):layer.geojson;
    if(fc?.type!=='FeatureCollection'||!Array.isArray(fc.features))throw new Error('Peta harus berupa GeoJSON FeatureCollection.');
    const rows=list(),used=new Set(),names=new Set(),changes=[],errors=[],features=[];
    for(const original of fc.features) {
      const f=structuredClone(original),p=f.properties ||= {},name=featureName(f,layer);
      if(!name){errors.push('Ada fitur blok tanpa nama.');continue;}
      if(names.has(norm(name))){errors.push(`Nama blok ganda: ${name}`);continue;}names.add(norm(name));
      const supplied=mappings[name] || p.blok_id || p.block_id;
      let b=supplied ? rows.find(x=>x.id===supplied) : find(name);
      if(supplied && !b && !/^[a-zA-Z0-9_-]{1,100}$/.test(supplied)){errors.push(`ID tidak valid: ${name}`);continue;}
      // Exact unchanged geometry may suggest a rename, but never applies it silently.
      const suggested=!b&&!supplied ? db.prepare('SELECT id,nama FROM _blocks WHERE layer_id=? AND geometry=? AND active=1').all(layer.id||-1,JSON.stringify(f.geometry)) : [];
      if(suggested.length===1&&!initializing){errors.push(`${name}: bentuk sama dengan ${suggested[0].nama}; petakan ke ID lama sebelum menerapkan.`);changes.push({type:'perlu pencocokan',nama:name,suggested_id:suggested[0].id,nama_lama:suggested[0].nama});continue;}
      const id=b?.id || supplied || crypto.randomUUID();
      if(used.has(id)){errors.push(`ID blok dipakai lebih dari sekali: ${id}`);continue;}used.add(id);
      const parents=Array.isArray(p.parent_ids)?p.parent_ids:typeof p.parent_ids==='string'?p.parent_ids.split(',').map(x=>x.trim()).filter(Boolean):[];
      const ancestry=new Set(parents);let prior;do{prior=ancestry.size;for(const r of rows)if(ancestry.has(r.id))for(const parent of r.parents)ancestry.add(parent);}while(ancestry.size!==prior);
      if(ancestry.has(id)||parents.some(x=>!rows.some(r=>r.id===x))){errors.push(`Induk blok tidak valid: ${name}`);continue;}
      const collision=rows.find(x=>norm(x.nama)===norm(name)&&x.id!==id);
      if(collision){errors.push(`Nama ${name} sudah dimiliki ID ${collision.id}.`);continue;}
      p.blok_id=id;
      const ownership= ['Sudah milik kebun','Belum milik kebun','Belum diverifikasi'].includes(p.kepemilikan)?p.kepemilikan:owned(p)?'Sudah milik kebun': b?.ownership || 'Belum diverifikasi';
      p.kepemilikan=ownership;
      changes.push({type:!b?'baru':b.nama!==name?'ganti nama':'perbarui',id,nama:name,nama_lama:b?.nama,parents,ownership,luas_ha:areaHa(f)});features.push(f);
    }
    if(layer.id) for(const b of rows.filter(x=>x.layer_id===layer.id&&x.active&&!used.has(x.id)))changes.push({type:'nonaktifkan',id:b.id,nama:b.nama});
    const token=crypto.createHash('sha256').update(JSON.stringify({layer, mappings, rows:rows.map(x=>[x.id,x.updated_at,x.nama])})).digest('hex');
    return {token,changes,errors,geojson:JSON.stringify({...fc,features}),canApply:!errors.length};
  }
  function apply(layer, opts={}) {
    const preview=plan(layer,opts);if(preview.errors.length)throw new Error(preview.errors.join('\n'));
    if(opts.token && preview.token!==opts.token) {const e=new Error('Data GIS berubah sejak pratinjau. Periksa ulang revisi.');e.status=409;throw e;}
    for(const c of preview.changes) {
      if(c.type==='nonaktifkan'){db.prepare('UPDATE _blocks SET active=0,updated_at=? WHERE id=?').run(clock(),c.id);continue;}
      let b=list().find(x=>x.id===c.id);
      const f=JSON.parse(preview.geojson).features.find(x=>x.properties.blok_id===c.id);
      if(!b)b=create(c.nama,{id:c.id});else if(b.nama!==c.nama)rename(b.id,c.nama);
      db.prepare('UPDATE _blocks SET divisi=?,ownership=?,active=1,layer_id=?,geometry=?,parents=?,luas_ha=?,updated_at=? WHERE id=?').run(f.properties.Divisi||f.properties.Lahan||b?.divisi||'Umum',c.ownership,layer.id||null,JSON.stringify(f.geometry),JSON.stringify(c.parents),c.luas_ha,clock(),c.id);
    }
    const touched=new Set();
    for(const c of preview.changes.filter(x=>x.type!=='nonaktifkan')) {
      const b=list().find(x=>x.id===c.id), t=clock();
      const ensure=(table,field,extra={})=>{if(!db.prepare('SELECT id FROM '+quote(table)+' WHERE block_id=? OR '+quote(field)+'=?').get(c.id,c.nama)){const vals={[field]:c.nama,block_id:c.id,block_name_snapshot:c.nama,...extra},cols=Object.keys(vals);db.prepare('INSERT INTO '+quote(table)+' (created_at,updated_at,'+cols.map(quote).join(',')+') VALUES (?,?,'+cols.map(()=>'?').join(',')+')').run(t,t,...cols.map(k=>vals[k]));}touched.add(table);};
      ensure('lahan_blok','blok',{peruntukan:b.divisi,kepemilikan:b.ownership});
      db.prepare('UPDATE lahan_blok SET kepemilikan=?,peruntukan=?,updated_at=? WHERE block_id=?').run(b.ownership,b.divisi,t,b.id);
      if(b.divisi==='Pisang')ensure('pisang_blok','nama_blok');
      if(b.divisi==='Padi')ensure('padi_petak','nama_petak');
    }
    for(const table of touched)linkTable(table);
    return preview;
  }
  function boot() {
    migrate();
    // Older names get IDs first. Existing rows and quantities are never removed.
    for(const {table} of refs)linkTable(table);
    for(const layer of db.prepare('SELECT * FROM gis_layer ORDER BY id').all().filter(isBlockLayer)) {
      const fc=parse(layer.geojson,{});if(!fc.features)continue;
      // Bootstrap adds IDs once; later imports must go through revision preview.
      if(fc.features.every(f=>f.properties?.blok_id))continue;
      const p=plan(layer,{initializing:true});if(p.errors.length)continue;
      apply({...layer,geojson:p.geojson},{initializing:true});db.prepare('UPDATE gis_layer SET geojson=?,updated_at=? WHERE id=?').run(p.geojson,clock(),layer.id);
    }
  }
  function history(id) {
    const family=new Set([id]);let size;
    do {size=family.size;for(const b of list())if(family.has(b.id))for(const p of b.parents)family.add(p);}while(family.size!==size);
    const seen=new Set(),out=[];
    for(const blockId of family)for(const link of db.prepare('SELECT * FROM _block_links WHERE block_id=?').all(blockId)) {
      const k=`${link.table_name}:${link.row_id}`;if(seen.has(k))continue;seen.add(k);
      const row=db.prepare(`SELECT * FROM ${quote(link.table_name)} WHERE id=?`).get(link.row_id);
      if(row)out.push({table:link.table_name,block_id:blockId,inherited:blockId!==id,snapshot:link.snapshot,row});
    }
    return out;
  }
  return {migrate,boot,list,find,canonical,linkTable,rename,plan,apply,history,refs};
}
