import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {TABLES,susunRencana} from '../public/js/schema.js';import {createParcelLocations} from '../lib/gis-ownership.js';import {plantingGISReview,reconcilePlanting} from '../lib/planting-review.js';
import {scopePlantingData} from '../lib/planting-scope.js';
const rect=(w=1)=>({type:'Polygon',coordinates:[[[0,0],[w,0],[w,1],[0,1],[0,0]]]});
test('GIS target preview recognizes only owned portions, holds missing identities, then applies once without altering actuals',()=>{
 const db=new DatabaseSync(':memory:');for(const [t,T] of Object.entries(TABLES))db.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY,created_at TEXT,updated_at TEXT,${T.f.filter(f=>f.t!=='calc').map(f=>f.k+' '+(f.t==='num'||f.t==='money'?'REAL':f.t==='int'?'INTEGER':'TEXT')).join(',')})`);
 db.exec('CREATE TABLE _blocks(id TEXT,nama TEXT,aliases TEXT,divisi TEXT,ownership TEXT,active INTEGER,layer_id INTEGER,luas_ha REAL,updated_at TEXT,geometry TEXT)');
 db.exec('ALTER TABLE lahan_target ADD COLUMN block_id TEXT;ALTER TABLE lahan_target ADD COLUMN block_name_snapshot TEXT');
 const add=(t,r)=>{const cols=Object.keys(r);return Number(db.prepare('INSERT INTO '+t+'('+cols.join(',')+') VALUES('+cols.map(()=>'?')+')').run(...Object.values(r)).lastInsertRowid);};
 add('_blocks',{id:'stable',nama:'E02c',aliases:'[]',divisi:'Pisang',ownership:'Belum diverifikasi',active:1,layer_id:1,luas_ha:1,geometry:JSON.stringify(rect())});
 add('gis_layer',{id:1,nama:'Blok Tanam',field_nama:'Nama_Blok',geojson:JSON.stringify({features:[{properties:{Nama_Blok:'E02c',blok_id:'stable',Lahan:'Pisang',Status:'Next Progress',Shape_Area:10000},geometry:rect()}]})});
 add('gis_layer',{id:2,nama:'Persil Lahan 21-10-2026',geojson:JSON.stringify({features:[{properties:{Status:'Sudah Bayar'},geometry:rect(.5)}]})});
 add('lahan_blok',{blok:'E02c',luas_ha:1,peruntukan:'Pisang'});add('lahan_target',{blok:'E01d',bulan:'2026-12-01'});add('lahan_harian',{tanggal:'2026-10-20',blok:'E02c',aktivitas:'Bajak 1',hasil_ha:.2});
 for(const [i,aktivitas] of ['Bajak 1','Ridger','Tanam'].entries())add('lahan_aktivitas',{aktivitas,untuk:'Pisang',urutan:i+1,hari_per_ha:1});
 const registry={list:()=>db.prepare('select * from _blocks').all().map(r=>({...r,aliases:JSON.parse(r.aliases)}))};assert.equal(createParcelLocations(db,registry)().length,0);const locations=createParcelLocations(db,registry,{includePartial:true})();assert.equal(locations[0].luas_ha,.5);
 const context={db,locations,today:'2026-10-25'},actual=JSON.stringify(db.prepare('select * from lahan_harian').all()),review=plantingGISReview(context);assert.equal(review.totals.nextGISHa,1);assert.equal(review.totals.nextOwnedHa,.5);assert.equal(review.heldTargets[0].name,'E01d');assert.equal(db.prepare('select count(*) n from lahan_target').get().n,1,'preview never writes');
 const args={...context,now:()=> '2026-10-25T01:00:00Z',insertRow:add,log:()=>{},tx:fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
 assert.throws(()=>reconcilePlanting(args,{mode:'apply',token:'stale'}),e=>e.status===409);
 const applied=reconcilePlanting(args,{mode:'apply',token:review.token});assert.equal(db.prepare('select count(*) n from lahan_target').get().n,2);assert.equal(JSON.stringify(db.prepare('select * from lahan_harian').all()),actual);
 assert.ok(db.prepare('select * from lahan_rencana').all().filter(r=>!/Sudah dikerjakan/.test(r.keterangan||'')).some(r=>r.mulai<'2026-12-01'),'December planting target does not delay preparation until December');
 assert.equal(reconcilePlanting(args,{mode:'apply',token:applied.token}).unchanged,true);assert.equal(db.prepare('select count(*) n from _planting_target_revisions').get().n,1);db.close();
});
test('preparation release dates and one shared tractor constrain the schedule',()=>{
 const data={lahan_blok:[{blok:'A',peruntukan:'Pisang',luas_ha:1},{blok:'B',peruntukan:'Pisang',luas_ha:1}],lahan_target:[{blok:'A',bulan:'2026-11-01'},{blok:'B',bulan:'2026-12-01',mulai_persiapan:'2026-12-01'}],lahan_harian:[],pisang_blok:[],gis_layer:[],lahan_aktivitas:['Bajak 1','Bajak 2','Ridger'].map((aktivitas,i)=>({aktivitas,untuk:'Pisang',urutan:i+1,hari_per_ha:1}))};
 const rows=susunRencana({rows:t=>data[t]||[]},'2026-10-26');assert.equal(rows.length,6);assert.equal(new Set(rows.map(r=>r.mulai)).size,6);assert.ok(rows.filter(r=>r.blok==='B').every(r=>r.mulai>='2026-12-01'));
});
test('fully completed stages remain complete after scoping to owned GIS area and source actuals stay intact',()=>{
 const activities=['Land Clearing','Bajak 1','Bajak 2','Ridger','Tanam'],data={lahan_blok:[{blok:'D03',peruntukan:'Pisang',luas_ha:1}],lahan_target:[{blok:'D03',bulan:'2026-12-01'}],lahan_harian:activities.map((aktivitas,i)=>({id:i+1,blok:'D03',tanggal:'2026-09-30',aktivitas,hasil_ha:1,source_key:'baseline:complete'})),lahan_aktivitas:activities.map((aktivitas,i)=>({aktivitas,untuk:'Pisang',urutan:i+1,hari_per_ha:1})),pisang_blok:[],lahan_rencana:[],gis_layer:[]};
 const before=JSON.stringify(data),scoped=scopePlantingData(data,[{nama:'D03',divisi:'Pisang',luas_ha:.8}],'2026-10-25');assert.equal(susunRencana({rows:t=>scoped[t]||[]},'2026-10-26').length,0);assert.equal(JSON.stringify(data),before);
});
