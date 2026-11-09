import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createBlockRegistry} from '../lib/blocks.js';
import {createGISRegistry} from '../lib/gis-registry.js';
import {previewPlantingSync,applyPlantingSync,syncPendingLand} from '../lib/planting-progress-sync.js';

function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE _settings(k TEXT PRIMARY KEY,v TEXT);CREATE TABLE lahan_harian(id INTEGER PRIMARY KEY,blok TEXT,aktivitas TEXT,tanggal TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT,daily_report_id INTEGER);CREATE TABLE pisang_blok(id INTEGER PRIMARY KEY,nama_blok TEXT,block_id TEXT,tanggal_tanam TEXT,luas_ha REAL,pokok_tanam INTEGER,klon TEXT,status TEXT);CREATE TABLE padi_tanam(id INTEGER PRIMARY KEY,petak TEXT,block_id TEXT,tgl_tanam TEXT,luas_tanam_ha REAL,varietas TEXT,musim TEXT,tahun INTEGER);');
 const blocks=createBlockRegistry({db,TABLES:{},cascadeRename(){},log(){}});blocks.migrate();
 db.exec("INSERT INTO _blocks(id,nama,divisi,active,ownership,luas_ha,layer_id) VALUES('gis-D04','D04','Pisang',1,'Sudah milik kebun',2.463,1);INSERT INTO pisang_blok VALUES(170,'D04','gis-D04','2026-10-29',2.5064,1428,'G9','PC');INSERT INTO lahan_harian(blok,aktivitas,tanggal,hasil_ha) VALUES('D04','Tanam','2026-10-29',.4485),('D04','Tanam','2026-10-30',.2655),('D04','Tanam','2026-10-31',.34),('D04','Tanam','2026-11-01',.567),('D04','Tanam','2026-11-02',.3275),('D04','Tanam','2026-11-03',.4155)");
 const registry=createGISRegistry({db,blocks,clock:()=>'2026-11-09T00:00:00.000Z',actor:()=>'uji'});registry.migrate();registry.importLegacy(registry.legacyPreview().token);return {db,registry};
}
test('synchronize D04 actual once, retain dated source and record GIS revision',()=>{
 const {db,registry}=fixture();try{
 const before=db.prepare('SELECT * FROM lahan_harian ORDER BY id').all(),p=previewPlantingSync(db,registry,'2026-11-09');assert.equal(p.statements[0].matched_days,2);assert.equal(p.statements[0].population,4728);
 assert.throws(()=>applyPlantingSync(db,registry,p,'stale'),/berubah/);
 db.exec('BEGIN');applyPlantingSync(db,registry,p,p.token);db.exec('COMMIT');
 assert.equal(registry.plantings()[0].population,4728);assert.equal(registry.plantings()[0].planted_on,'2026-10-29');assert.deepEqual(db.prepare('SELECT * FROM lahan_harian ORDER BY id').all(),before);assert.equal(registry.history('gis-D04').plantings.length,2);
 const again=previewPlantingSync(db,registry,'2026-11-09');assert.equal(applyPlantingSync(db,registry,again,again.token).changed,0);assert.equal(registry.history('gis-D04').plantings.length,2);
 }finally{db.close();}
});
test('manual GIS revisions block sync rather than overwrite and leave actual intact',()=>{
 const {db,registry}=fixture();try{let p=previewPlantingSync(db,registry,'2026-11-09');applyPlantingSync(db,registry,p,p.token);let g=registry.plantings()[0];registry.savePlanting({...g,expected_version:g.version,population:4729,reason:'Uji'});p=previewPlantingSync(db,registry,'2026-11-09');assert.match(p.statements[0].reason,/direvisi/);assert.throws(()=>applyPlantingSync(db,registry,p,p.token),/pemeriksaan/);assert.equal(db.prepare('SELECT COUNT(*) n FROM lahan_harian').get().n,6);}finally{db.close();}
});
test('a manual note or replacement count is preserved during the next progress update',()=>{
 const {db,registry}=fixture();try{let p=previewPlantingSync(db,registry,'2026-11-09');applyPlantingSync(db,registry,p,p.token);let g=registry.plantings()[0];registry.savePlanting({...g,expected_version:g.version,replacement_plants:5,notes:'Catatan GIS',reason:'Uji'});db.exec("INSERT INTO lahan_harian(blok,aktivitas,tanggal,hasil_ha) VALUES('D04','Tanam','2026-11-04',.01)");p=previewPlantingSync(db,registry,'2026-11-09');assert.equal(p.statements[0].reason,null);applyPlantingSync(db,registry,p,p.token);g=registry.plantings()[0];assert.equal(g.population,4748);assert.equal(g.replacement_plants,5);assert.equal(g.notes,'Catatan GIS');}finally{db.close();}
});
test('removing the final source does not leave the old GIS population behind',()=>{
 const {db,registry}=fixture();try{let p=previewPlantingSync(db,registry,'2026-11-09');applyPlantingSync(db,registry,p,p.token);db.exec('DELETE FROM lahan_harian');p=previewPlantingSync(db,registry,'2026-11-09');assert.equal(p.statements[0].population,0);applyPlantingSync(db,registry,p,p.token);assert.equal(registry.plantings()[0].population,0);assert.equal(registry.plantings()[0].planted_on,null);}finally{db.close();}
});
test('source edit and GIS synchronization can roll back together on a conflicting GIS edit',()=>{
 const {db,registry}=fixture();try{
  let p=previewPlantingSync(db,registry,'2026-11-09');applyPlantingSync(db,registry,p,p.token);
  const g=registry.plantings()[0];registry.savePlanting({...g,expected_version:g.version,population:4729,reason:'Manual'});
  const before=db.prepare('SELECT SUM(hasil_ha) n FROM lahan_harian').get().n;
  db.exec('BEGIN');try{db.exec("INSERT INTO lahan_harian(blok,aktivitas,tanggal,hasil_ha) VALUES('D04','Tanam','2026-11-05',.01)");p=previewPlantingSync(db,registry,'2026-11-09');applyPlantingSync(db,registry,p,p.token);db.exec('COMMIT');assert.fail('should reject the conflict');}catch(e){db.exec('ROLLBACK');assert.match(e.message,/pemeriksaan/);}
  assert.equal(db.prepare('SELECT SUM(hasil_ha) n FROM lahan_harian').get().n,before);assert.equal(registry.plantings()[0].population,4729);
 }finally{db.close();}
});
test('empty D11 legacy group gains recorded actual without treating GIS boundary as planted',()=>{
 const {db,registry}=fixture();try{
  db.exec("DELETE FROM lahan_harian;INSERT INTO _blocks(id,nama,divisi,active,ownership,luas_ha,layer_id) VALUES('gis-D11','D11','Pisang',1,'Sudah milik kebun',.835,1);INSERT INTO pisang_blok VALUES(178,'D11','gis-D11',NULL,.835,NULL,'G9','PC');INSERT INTO lahan_harian(blok,aktivitas,tanggal,hasil_ha) VALUES('D11','Tanam','2026-11-04',.1935),('D11','Tanam','2026-11-05',.3625),('D11','Tanam','2026-11-07',.15)");
  registry.importLegacy(registry.legacyPreview().token);const p=previewPlantingSync(db,registry,'2026-11-09');assert.equal(p.statements[0].population,1412);applyPlantingSync(db,registry,p,p.token);const d=registry.catalog('2026-11-09').blocks.find(b=>b.name==='D11').plantings[0];assert.equal(d.area_ha,.706);assert.equal(d.planted_on,'2026-11-04');
 }finally{db.close();}
});
test('a later saved admin actual triggers the enabled synchronization exactly once',()=>{
 const {db,registry}=fixture();try{
  let p=previewPlantingSync(db,registry,'2026-11-09');applyPlantingSync(db,registry,p,p.token);db.prepare('INSERT INTO _settings VALUES(?,?)').run('planting-sync-enabled','1');
  db.exec("INSERT INTO lahan_harian(blok,aktivitas,tanggal,hasil_ha) VALUES('D04','Tanam','2026-11-04',.01)");
  const tx=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  assert.equal(syncPendingLand(db,registry,[{sql:'INSERT INTO "lahan_harian" VALUES(?)'}],'2026-11-09',tx).changed,1);assert.equal(registry.plantings()[0].population,4748);
  assert.equal(syncPendingLand(db,registry,[{sql:'UPDATE pisang_box SET jumlah_box=?'}],'2026-11-09',tx),null);
  assert.equal(syncPendingLand(db,registry,[{sql:'UPDATE lahan_harian SET hasil_ha=?'}],'2026-11-09',tx).changed,0);
 }finally{db.close();}
});
test('an inactive older block with the same name never receives the active block actual',()=>{
 const {db,registry}=fixture();try{
  db.exec("INSERT INTO _blocks(id,nama,divisi,active,luas_ha) VALUES('inactive-d04','D04','Pisang',0,2.463)");
  const p=previewPlantingSync(db,registry,'2026-11-09');assert.equal(p.statements.length,1);assert.equal(p.statements[0].block_id,'gis-D04');assert.equal(p.statements[0].group_id,registry.plantings()[0].id);assert.equal(p.statements[0].reason,null);
 }finally{db.close();}
});
