import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createBlockRegistry} from '../lib/blocks.js';
import {createGISRegistry,plantState} from '../lib/gis-registry.js';

function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE pisang_blok(id INTEGER PRIMARY KEY,nama_blok TEXT,block_id TEXT,tanggal_tanam TEXT,luas_ha REAL,pokok_tanam INTEGER,klon TEXT,status TEXT);CREATE TABLE padi_tanam(id INTEGER PRIMARY KEY,petak TEXT,block_id TEXT,tgl_tanam TEXT,luas_tanam_ha REAL,varietas TEXT,musim TEXT,tahun INTEGER);');
 const blocks=createBlockRegistry({db,TABLES:{},cascadeRename(){},log(){}});blocks.migrate();
 db.exec("INSERT INTO _blocks(id,nama,divisi,active,ownership,luas_ha,layer_id) VALUES('gis-A','A01','Pisang',1,'Sudah milik kebun',2,1)");
 const registry=createGISRegistry({db,blocks,clock:()=>'2026-10-31T00:00:00.000Z',actor:()=>'uji'});registry.migrate();return {db,blocks,registry};
}
test('GIS versions preserve names, geometry and area before/after changes without duplicate versions',()=>{
 const {db,registry}=fixture();try{
 assert.equal(registry.recordBlock('gis-A','Baseline'),1);assert.equal(registry.recordBlock('gis-A'),1);
 db.exec("UPDATE _blocks SET nama='A01-baru',luas_ha=1.5 WHERE id='gis-A'");assert.equal(registry.recordBlock('gis-A','Koreksi luas'),2);
 const h=registry.history('gis-A');assert.equal(h.block.length,2);assert.equal(h.block[1].payload.luas_ha,2);assert.equal(h.block[1].payload.nama,'A01');assert.equal(registry.snapshot('gis-A').gis_area_ha,1.5);
 }finally{db.close();}
});
test('legacy migration is previewed, stale-safe, idempotent and leaves source quantities intact',()=>{
 const {db,registry}=fixture();try{
 db.exec("INSERT INTO pisang_blok VALUES(1,'A01','gis-A','2025-05-22',1.8,3600,'G9','PC');INSERT INTO padi_tanam VALUES(1,'Tidak dikenal',NULL,'2026-10-01',1,'Inpari','MT1',2026)");
 const before=db.prepare('SELECT * FROM pisang_blok').all(),p=registry.legacyPreview();assert.equal(p.rows.length,1);assert.equal(p.unmatched.length,1);
 assert.throws(()=>registry.importLegacy('stale'),/berubah/);assert.equal(registry.plantings().length,0);
 assert.equal(registry.importLegacy(p.token).imported,1);assert.equal(registry.legacyPreview().rows.length,0);assert.deepEqual(db.prepare('SELECT * FROM pisang_blok').all(),before);
 assert.equal(registry.catalog('2026-10-31').blocks[0].plantings[0].population,3600);
 }finally{db.close();}
});
test('plant groups enforce combined area, version conflicts and dated cycle overrides',()=>{
 const {db,registry}=fixture();try{
 const p=registry.savePlanting({block_id:'gis-A',commodity:'Pisang',planted_on:'2025-05-22',area_ha:1.2,population:2400,reason:'Tanam kelompok pertama'});
 assert.throws(()=>registry.savePlanting({block_id:'gis-A',population:2000,reason:'Kelompok kedua'}),/melebihi/);
 const next=registry.savePlanting({...p,expected_version:1,cycle_override:'R2',cycle_effective_on:'2026-10-31',reason:'Verifikasi lapangan'});
 assert.equal(plantState(next,'2026-10-30').cycle,'R1');assert.equal(plantState(next,'2026-10-31').cycle,'R2');
 assert.throws(()=>registry.savePlanting({...p,expected_version:1,reason:'Form lama'}),/berubah/);
 assert.equal(registry.history('gis-A').plantings.length,2);
 }finally{db.close();}
});
test('banana cycle boundaries remain exact at 52/53,91/92 and null dates stay unknown',()=>{
 const base={commodity:'Pisang',planted_on:'2025-01-01'};for(const [week,cycle] of [[0,'PC'],[52,'PC'],[53,'R1'],[91,'R1'],[92,'R2'],[131,'R3'],[170,'R4']]){const d=new Date('2025-01-01T00:00:00Z');d.setUTCDate(d.getUTCDate()+week*7);assert.equal(plantState(base,d.toISOString().slice(0,10)).cycle,cycle);}
 assert.equal(plantState({commodity:'Pisang'},'2026-10-31').cycle,null);assert.equal(plantState(base,'2024-12-31').age_weeks,null);
});
test('read grants are hashed, application scoped and expire without granting edit access',()=>{
 const {db,blocks,registry}=fixture();try{const grant=registry.grant('payrol');assert.equal(registry.verifyGrant(grant.token,'payrol'),true);assert.equal(registry.verifyGrant(grant.token,'gudang'),false);assert.equal(db.prepare('SELECT hash FROM _gis_reference_tokens').get().hash===grant.token,false);const later=createGISRegistry({db,blocks,clock:()=>'2026-10-31T09:00:00.000Z'});assert.equal(later.verifyGrant(grant.token,'payrol'),false);assert.throws(()=>registry.grant('arbitrary-app'),/dikenal/);}finally{db.close();}
});
test('Padi migration uses its actual planting and planted-area fields',()=>{
 const {db,registry}=fixture();try{db.exec("INSERT INTO _blocks(id,nama,divisi,active,layer_id,luas_ha) VALUES('gis-P','P01','Padi',1,1,1);INSERT INTO padi_tanam VALUES(1,'P01','gis-P','2026-10-01',0.8,'Inpari 32','MT2',2026)");const p=registry.legacyPreview();assert.equal(p.rows[0].planted_on,'2026-10-01');assert.equal(p.rows[0].area_ha,.8);registry.importLegacy(p.token);assert.equal(registry.plantings()[0].season,'MT2 2026');}finally{db.close();}
});

test('banana area follows initial planting density while replanting changes population only',()=>{const {db,registry}=fixture();try{const p=registry.savePlanting({block_id:'gis-A',commodity:'Pisang',population:2000,replacement_plants:50,lost_plants:20,area_ha:999,reason:'Pengukuran'}),state=plantState(p,'2026-10-31');assert.equal(p.area_ha,1);assert.equal(state.current_population,2030);assert.equal(state.area_from_plants_ha,1);assert.throws(()=>registry.savePlanting({...p,expected_version:1,lost_plants:3000,reason:'Salah'}),/melebihi/);}finally{db.close();}});

test('legacy planting follows one explicit merged GIS descendant without rewriting the source',()=>{
 const {db,registry}=fixture();try{
 db.exec("INSERT INTO _blocks(id,nama,divisi,active) VALUES('old-E01d','E01d','Pisang',0)");
 db.prepare('UPDATE _blocks SET nama=?,parents=? WHERE id=?').run('E01c',JSON.stringify(['old-E01d']),'gis-A');
 db.exec("INSERT INTO pisang_blok VALUES(1,'E01d','old-E01d','2025-05-22',0.1,200,'G9','PC')");
 const before=db.prepare('SELECT * FROM pisang_blok').get(),p=registry.legacyPreview();assert.equal(p.rows[0].block_id,'gis-A');assert.equal(p.rows[0].label,'Gabungan E01d');registry.importLegacy(p.token);assert.equal(registry.plantings()[0].population,200);assert.deepEqual(db.prepare('SELECT * FROM pisang_blok').get(),before);
 }finally{db.close();}
});

test('persistent read-only grants survive daily opening, remain app scoped and can be revoked',()=>{
 const {db,blocks,registry}=fixture();try{const grant=registry.grant('payrol',{persistent:true});assert.equal(grant.expires,null);const later=createGISRegistry({db,blocks,clock:()=>'2030-01-01T00:00:00.000Z'});assert.equal(later.verifyGrant(grant.token,'payrol'),true);assert.equal(later.verifyGrant(grant.token,'gudang'),false);registry.revokeGrant(grant.token);assert.equal(later.verifyGrant(grant.token,'payrol'),false);}finally{db.close();}
});
