import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {TABLES} from '../public/js/schema.js';
import {bananaDetail} from '../lib/banana-detail.js';
import {bananaDetailMarkup} from '../public/js/banana-detail.js';
test('banana detail reconciles hectares once per GIS block, keeps nursery and field counts separate and compares every harvest month',()=>{
 const db=new DatabaseSync(':memory:');for(const [t,T] of Object.entries(TABLES))db.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY,${T.f.filter(f=>f.t!=='calc').map(f=>f.k+' '+(['num','money','int'].includes(f.t)?'REAL':'TEXT')).join(',')})`);
 db.exec(`INSERT INTO pisang_blok(nama_blok,tanggal_tanam,luas_ha,pokok_tanam,kehilangan,sulam) VALUES('A','2026-08-15',2,1200,20,5),('A','2026-08-15',2,1200,20,5),('FUTURE','2027-01-01',1,500,0,0),('OTHER','2026-01-01',99,90000,0,0);
 INSERT INTO pisang_bibit(tanggal_datang,batch,klon,qty_datang,splitting,ditanam,afkir,mortal) VALUES('2026-07-01','B1','G9',2000,100,1200,20,30),('2026-09-01','B2','Moka',10,0,12,0,0);
 INSERT INTO pisang_estimasi(bulan,box) VALUES('2026-09-01',100),('2026-10-01',200),('2026-11-01',250);
 INSERT INTO pisang_box(tanggal,jumlah_box) VALUES('2026-09-20',110),('2026-10-20',50),('2026-10-28',999),('2025-12-01',20);`);
 const locations=[{nama:'A',divisi:'Pisang',luas_ha:1.5},{nama:'B',divisi:'Pisang',luas_ha:1},{nama:'FUTURE',divisi:'Pisang',luas_ha:1},{nama:'P1',divisi:'Padi',luas_ha:100}],progress={blocks:[{name:'A',activity:[{name:'Tanam',ha:1}]},{name:'B',activity:[{name:'Tanam',ha:.3}]}]};
 const before=db.prepare('SELECT * FROM pisang_blok').all(),d=bananaDetail(db,locations,progress,'2026-10-27');
 assert.equal(d.area,3.5);assert.equal(d.plantedHa,1.8);assert.equal(d.plantedPokok,1200);assert.equal(d.population,1185);assert.equal(d.missingPokok,1);assert.equal(d.nursery.balance,848);assert.equal(d.nursery.planted,1212);assert.equal(d.nursery.negativeBatches,1);
 assert.deepEqual(d.harvestMonths.map(m=>[m.month,m.plan,m.actual]),[['2026-11',250,null],['2026-10',200,50],['2026-09',100,110],['2025-12',null,20]]);
 assert.ok(Math.abs(d.harvestMonths[2].achievement-110)<1e-9);assert.equal(d.harvestMonths[2].remaining,0);assert.deepEqual(db.prepare('SELECT * FROM pisang_blok').all(),before);
 const densityMarkup=bananaDetailMarkup({...d,plantedHa:17.28,plantedPokok:28900,population:28806});
 assert.match(densityMarkup,/17,28 ha/);assert.match(densityMarkup,/Luas dari pokok tanam: 14,45 ha/);assert.match(densityMarkup,/2\.000 pokok\/ha/);assert.equal(d.plantedPokok,1200);
 assert.match(bananaDetailMarkup(d),/Persediaan bibit Pisang/);assert.match(bananaDetailMarkup(d),/November 2026/i);assert.ok(!JSON.stringify(d).includes('90000'));db.close();
});

test('estimates from planting progress are separate from GIS counts and do not change population',()=>{
 const db=new DatabaseSync(':memory:');for(const [t,T] of Object.entries(TABLES))db.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY,${T.f.filter(f=>f.t!=='calc').map(f=>f.k+' '+(['num','money','int'].includes(f.t)?'REAL':'TEXT')).join(',')})`);
 db.exec("INSERT INTO pisang_blok(nama_blok,tanggal_tanam,luas_ha,pokok_tanam) VALUES('D04','2026-10-29',2.46,1428),('D11',NULL,0.84,NULL)");
 const before=JSON.stringify(db.prepare('SELECT * FROM pisang_blok').all());
 const locations=[{nama:'D04',divisi:'Pisang',luas_ha:2.46},{nama:'D11',divisi:'Pisang',luas_ha:.84},{nama:'NO',divisi:'Pisang',luas_ha:1}],progress={blocks:[{name:'D04',activity:[{name:'Tanam',ha:2.364,inputHa:2.364}]},{name:'D11',activity:[{name:'Tanam',ha:.706,inputHa:.706}]},{name:'NO',activity:[{name:'Tanam',ha:null}]}]};
 const d=bananaDetail(db,locations,progress,'2026-11-09'),a=d.blocks.find(b=>b.name==='D04'),b=d.blocks.find(b=>b.name==='D11');
 assert.equal(a.plantedPokok,1428);assert.equal(a.progressEstimate,4728);assert.equal(b.plantedPokok,0);assert.equal(b.progressEstimate,1412);assert.equal(d.progressEstimate,6140);assert.equal(d.progressEstimateBlocks,2);assert.equal(d.population,1428);assert.equal(d.plantedPokok,1428);assert.equal(d.blocks.find(x=>x.name==='NO').progressEstimate,null);assert.equal(JSON.stringify(db.prepare('SELECT * FROM pisang_blok').all()),before);
 const markup=bananaDetailMarkup(d);assert.match(markup,/Estimasi pokok dari progres/);assert.match(markup,/4\.728 \(estimasi\)/);assert.match(markup,/1\.412 \(estimasi\)/);assert.match(markup,/bukan jumlah pokok pasti/);db.close();
});
