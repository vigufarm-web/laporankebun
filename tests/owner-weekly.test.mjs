import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {ownerWeeklyWork,selectOwnerPhotos,weeklyWorkSections} from '../lib/owner-weekly.js';
test('owner weekly totals sum daily actuals, deduplicate weekly block targets, separate units and exclude drafts',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE lahan_harian(tanggal TEXT,aktivitas TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT)');
 const item=(blok,realisasi,hasil_sdhi,target=10,satuan='ha')=>({blok,aktivitas:'Panen padi',realisasi,hasil_sdhi,target,satuan,target_hk_minggu:8,hk_realisasi:2});
 const reports=[{id:1,status:'Selesai',tanggal:'2026-10-19',divisi:'Padi',items:[item('P1',2,2)]},{id:2,status:'Selesai',tanggal:'2026-10-20',divisi:'Padi',items:[item('P1',3,5),item('P2',1,1,4),item('P2',20,20,40,'pokok')]},{id:3,status:'Draf',tanggal:'2026-10-21',divisi:'Padi',items:[item('P1',900,905)]}];
 let work=ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports});assert.equal(work.length,2);let r=work.find(r=>r.unit==='ha');assert.equal(r.actual,6);assert.equal(r.target,14);assert.equal(r.variance,-8);assert.equal(r.hk,6);assert.equal(r.hkPlan,16);assert.equal(r.percent,100*6/14);
 reports.push({id:4,status:'Selesai',tanggal:'2026-10-21',divisi:'Padi',items:[item('P3',1,1,null)]});work=ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports});r=work.find(r=>r.unit==='ha');assert.equal(r.targetPartial,true);assert.equal(r.percent,null);assert.equal(r.variance,null);assert.ok(weeklyWorkSections(work)[0].rows.some(row=>row.some(x=>String(x).includes('sebagian'))));db.close();
});
test('owner land totals use capped effective transactions once, not covered Daily or opening balances',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE lahan_harian(tanggal TEXT,aktivitas TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT);INSERT INTO lahan_harian VALUES('2026-10-20','Land Clearing',.4,0,NULL),('2026-10-21','Land Clearing',.2,0,NULL),('2026-10-21','Land Clearing',5,1,NULL),('2026-10-20','Land Clearing',8,0,'baseline:old')");
 const work=ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports:[{id:1,status:'Selesai',tanggal:'2026-10-21',divisi:'Infra',items:[{blok:'D1',aktivitas:'LC',realisasi:.9,satuan:'ha',hk_realisasi:2}]}],landTargets:[{a:'Land Clearing',target:1}]});assert.equal(work.length,1);assert.ok(Math.abs(work[0].actual-.6)<1e-9);assert.equal(work[0].target,1);assert.equal(work[0].hk,2);db.close();
});
test('owner sample photographs are bounded to three per date and prioritize activities across divisions',()=>{
 let id=0;const reports=[];for(const division of ['Pisang','Padi','Infra'])for(const day of ['19','20','21'])reports.push({id:reports.length+1,status:'Selesai',tanggal:'2026-10-'+day,divisi:division,photos:[{id:++id,jenis:'Apel',caption:'Apel'},{id:++id,jenis:'Kegiatan',caption:'Kegiatan '+division}]});
 reports.push({status:'Draf',tanggal:'2026-10-22',divisi:'Pisang',photos:[{id:999,jenis:'Kegiatan',caption:'Draf'}]});reports[0].photos.push({id:998,jenis:'Kegiatan',expires_at:'2000-01-01'},{id:997,jenis:'Kegiatan',deleted_at:'2026-10-22'});
 const sample=selectOwnerPhotos(reports),photos=sample.flatMap(r=>r.photos);assert.equal(photos.length,9);assert.equal(new Set(photos.map(p=>p.id)).size,9);for(const day of ['19','20','21'])assert.equal(sample.filter(r=>r.tanggal==='2026-10-'+day).flatMap(r=>r.photos).length,3);assert.ok(photos.every(p=>p.jenis==='Kegiatan'));for(const division of ['Pisang','Padi','Infra'])assert.equal(new Set(sample.filter(r=>r.divisi===division).map(r=>r.tanggal)).size,3);assert.equal(reports[0].photos.length,4,'selection does not remove stored photographs');
});
test('HK-only days join the measured weekly activity only when its unit is unambiguous',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE lahan_harian(tanggal TEXT,aktivitas TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT)');
 const reports=[{id:1,status:'Selesai',tanggal:'2026-10-19',divisi:'Pisang',items:[{blok:'A1',aktivitas:'Bagging',satuan:'lainnya',realisasi:null,hk_realisasi:2}]},{id:2,status:'Selesai',tanggal:'2026-10-20',divisi:'Pisang',items:[{blok:'A1',aktivitas:'Bagging',satuan:'stem',realisasi:20,hk_realisasi:1}]}];
 let work=ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports});assert.equal(work.length,1);assert.equal(work[0].actual,20);assert.equal(work[0].hk,3);assert.equal(work[0].unit,'stem');
 reports[1].items.push({blok:'A1',aktivitas:'Bagging',satuan:'pokok',realisasi:5,hk_realisasi:1});work=ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports});assert.equal(work.length,3);assert.equal(work.find(x=>!x.unit).hk,2);db.close();
});

test('group HK plan is counted once across repeated daily payloads, not allocated per block',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE lahan_harian(tanggal TEXT,aktivitas TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT)');
 const reports=[20,21].map(day=>({id:day,tanggal:'2026-10-'+day,divisi:'Pisang',status:'Selesai',hk_kegiatan_rencana:JSON.stringify([{key:'bud injection|stem',hk:6}]),items:[{aktivitas:'Bud injection',blok:'A',satuan:'stem',target:100,realisasi:20,hk_realisasi:1}]}));
 const rows=ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports});assert.equal(rows[0].hkPlan,6);assert.equal(rows[0].hk,2);assert.equal(rows[0].target,100);db.close();
});

test('HK-only group plans remain visible without inventing a physical result unit',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE lahan_harian(tanggal TEXT,aktivitas TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT)');
 const reports=[{id:1,tanggal:'2026-10-20',divisi:'Pisang',status:'Selesai',hk_kegiatan_rencana:JSON.stringify([{key:'pengawasan|hk',hk:6}]),items:[{aktivitas:'Pengawasan',blok:'A',satuan:'HK',target:null,realisasi:null,hk_realisasi:3}]}];
 const rows=ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports});assert.equal(rows[0].hkPlan,6);assert.equal(rows[0].actual,null);assert.equal(rows[0].unit,'');db.close();
});

test('owner weekly photo cap covers seven days and preserves a sparse day',()=>{
 let id=1000;const reports=Array.from({length:7},(_,i)=>({id:i,status:'Selesai',tanggal:'2026-10-'+(19+i),divisi:'Pisang',photos:Array.from({length:i===0?1:8},()=>({id:++id,jenis:'Kegiatan'}))}));
 const selected=selectOwnerPhotos(reports);assert.equal(selected.flatMap(r=>r.photos).length,19);assert.equal(selected[0].photos.length,1);assert.ok(selected.every(r=>r.photos.length<=3));
 reports[0].photos.push({id:++id,jenis:'Kegiatan'},{id:++id,jenis:'Kegiatan'});assert.equal(selectOwnerPhotos(reports).flatMap(r=>r.photos).length,21);
});

test('repeated paddy irrigation counts GIS coverage once while retaining all work days and HK',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE lahan_harian(tanggal TEXT,aktivitas TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT)');
 const reports=[19,20,21].map(day=>({id:day,status:'Selesai',tanggal:'2026-10-'+day,divisi:'Padi',items:[{block_id:1,blok:'P01',aktivitas:'Irigasi tanaman & usir burung',satuan:'ha',realisasi:2,hk_realisasi:1},{block_id:2,blok:'P02',aktivitas:'Irigasi tanaman & usir burung',satuan:'ha',realisasi:3,hk_realisasi:1}]}));
 const [r]=ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports,locations:[{id:1,luas_ha:2},{id:2,luas_ha:3}]});assert.equal(r.actual,5);assert.equal(r.hk,6);assert.equal(r.workDays,3);assert.equal(r.coverage,true);assert.match(weeklyWorkSections([r])[0].rows[0][0],/cakupan; 3 hari/);db.close();
});

test('drying repeat weights are not new grain and nursery population is not multiplied by days',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE lahan_harian(tanggal TEXT,aktivitas TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT)');
 const reports=[19,20,21].flatMap(day=>[{id:day,status:'Selesai',tanggal:'2026-10-'+day,divisi:'Padi',items:[{blok:'P06',aktivitas:'Jemur padi',satuan:'kg',realisasi:108,hk_realisasi:.5}]},{id:day+30,status:'Selesai',tanggal:'2026-10-'+day,divisi:'Pisang',items:[{blok:null,aktivitas:'Siram bibit',satuan:day===19?'lainnya':'pokok',realisasi:23409,hk_realisasi:.5}]}]);
 const work=ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports}),dry=work.find(r=>r.drying),nursery=work.find(r=>r.population);assert.equal(dry.actual,null);assert.equal(dry.workDays,3);assert.equal(dry.hk,1.5);assert.equal(nursery.actual,23409);assert.equal(nursery.unit,'pokok');assert.equal(nursery.workDays,3);assert.equal(nursery.hk,1.5);assert.match(weeklyWorkSections(work).find(s=>s.title.endsWith('Padi')).rows[0][2],/3 hari penjemuran/);db.close();
});
test('overlapping legacy block groups and changing partial areas do not invent unique coverage',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE lahan_harian(tanggal TEXT,aktivitas TEXT,hasil_ha REAL,diganti_aktual INTEGER,source_key TEXT)');
 const reports=[19,20].map((day,i)=>({id:day,status:'Selesai',tanggal:'2026-10-'+day,divisi:'Pisang',items:[{blok:i?'A02,A03':'A01,A02',aktivitas:'Siram manual',satuan:'ha',realisasi:4.4,hk_realisasi:1},{blok:'D02',aktivitas:'Herbisida spray',satuan:'ha',realisasi:i?.4:.25,hk_realisasi:1}]}));
 for(const row of ownerWeeklyWork({db,from:'2026-10-19',to:'2026-10-25',reports})){assert.equal(row.actual,null);assert.equal(row.ambiguous,true);assert.equal(row.workDays,2);assert.equal(row.hk,2);}db.close();
});
