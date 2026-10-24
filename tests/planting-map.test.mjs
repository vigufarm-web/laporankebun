import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createParcelLocations} from '../lib/gis-ownership.js';
import {stageLocations} from '../public/js/planting-map.js';
import {ownerLandClearing} from '../lib/owner-lc.js';
const rect=w=>({type:'Polygon',coordinates:[[[0,0],[w,0],[w,1],[0,1],[0,0]]]});
test('public work map clips partial ownership, deduplicates block geometry and follows current GIS names',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE gis_layer(id INTEGER,nama TEXT,updated_at TEXT,field_nama TEXT,geojson TEXT)');
 const block={id:'stable',nama:'A renamed',active:1,ownership:'Belum diverifikasi',luas_ha:2,divisi:'Pisang',layer_id:1,aliases:['A']};
 const fc={features:[{properties:{Nama_Blok:'A',blok_id:'stable',Lahan:'Pisang'},geometry:rect(2)},{properties:{Nama_Blok:'A',blok_id:'stable',Lahan:'Pisang'},geometry:rect(2)}]};
 db.prepare('INSERT INTO gis_layer VALUES(?,?,?,?,?)').run(1,'Blok Tanam','1','Nama_Blok',JSON.stringify(fc));db.prepare('INSERT INTO gis_layer VALUES(?,?,?,?,?)').run(2,'Persil Lahan 21-10-2026','1','No',JSON.stringify({features:[{properties:{Status:'Sudah Bayar'},geometry:rect(1)},{properties:{Status:'Lahan Target'},geometry:rect(2)}]}));
 const get=createParcelLocations(db,{list:()=>[block]},{includePartial:true,includeGeometry:true});let locations=get();assert.equal(locations.length,1);assert.equal(locations[0].nama,'A renamed');assert.equal(locations[0].luas_ha,1);assert.equal(locations[0].geometry.coordinates.length,1);assert.equal(Math.max(...locations[0].geometry.coordinates.flat(2).map(c=>c[0])),1);
 block.nama='A revised again';locations=get();assert.equal(locations[0].nama,'A revised again');assert.ok(!('geometry' in createParcelLocations(db,{list:()=>[block]},{includePartial:true})()[0]),'normal summary payload stays small');db.close();
});
test('map stage status uses capped cumulative completion, distinguishes partial stages, and never reopens 100%',()=>{
 const p={blocks:[{name:'A',area:1,activity:[{name:'Land Clearing',ha:1.2},{name:'Bajak 1',ha:.98}]},{name:'B',area:.5,activity:[]}]};
 const lc=stageLocations(p,'Land Clearing');assert.equal(lc[0].complete,true);assert.equal(lc[0].remaining,0);assert.equal(lc[1].remaining,.5);const bajak=stageLocations(p,'Bajak 1');assert.ok(Math.abs(bajak[0].remaining-.02)<1e-9);assert.equal(bajak[0].complete,false);assert.equal(p.blocks[0].activity[0].ha,1.2);
});
test('owner LC summary splits crops instead of labeling mixed work as banana or Infra',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE lahan_blok(blok TEXT,peruntukan TEXT);CREATE TABLE lahan_harian(tanggal TEXT,blok TEXT,aktivitas TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT);INSERT INTO lahan_blok VALUES('D1','Pisang'),('P1','Padi');INSERT INTO lahan_harian VALUES('2026-10-20','D1','Land Clearing',.4,0,NULL),('2026-10-20','P1','LC',.3,0,NULL),('2026-10-20','Unknown','LC',.1,0,NULL),('2026-10-20','D1','LC',9,1,NULL),('2026-10-20','D1','LC',8,0,'baseline:old'),('2026-10-01','D1','LC',7,0,NULL)");
 assert.deepEqual(ownerLandClearing(db,'2026-10-19','2026-10-25'),[{label:'LC Pisang',ha:.4},{label:'LC Padi',ha:.3},{label:'LC · komoditas belum ditentukan',ha:.1}]);db.close();
});
