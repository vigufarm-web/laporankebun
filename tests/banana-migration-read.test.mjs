import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {TABLES} from '../public/js/schema.js';import {bananaDetail} from '../lib/banana-detail.js';
import {createGISRegistry} from '../lib/gis-registry.js';
test('GIS migration does not turn empty boundary masters into planted hectares or change the recorded physical area',()=>{
 const db=new DatabaseSync(':memory:');for(const [t,T]of Object.entries(TABLES))db.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY,${T.f.filter(f=>f.t!=='calc').map(f=>f.k+' '+(['num','money','int'].includes(f.t)?'REAL':'TEXT')).join(',')})`);
 const registry=createGISRegistry({db,blocks:{}});registry.migrate();
 db.exec("INSERT INTO pisang_blok(id,nama_blok,tanggal_tanam,luas_ha,pokok_tanam) VALUES(1,'A','2026-01-01',1.2,2000),(2,'EMPTY',NULL,5,NULL),(3,'PARTIAL',NULL,3,NULL)");
 const insert=db.prepare('INSERT INTO _gis_plantings(id,block_id,commodity,planted_on,area_ha,population,source_key,reported_area_ha) VALUES(?,?,?,?,?,?,?,?)');
 insert.run('p1','a','Pisang','2026-01-01',1.2,2000,'pisang_blok:1',1.2);insert.run('p2','empty','Pisang',null,5,null,'pisang_blok:2',5);insert.run('p3','partial','Pisang',null,3,null,'pisang_blok:3',3);
 const tables=['pisang_blok','_gis_plantings','_gis_planting_revisions'],snapshot=()=>JSON.stringify(tables.map(t=>db.prepare('SELECT * FROM '+t).all())),before=snapshot();
 const locations=[{id:'a',nama:'A',divisi:'Pisang',luas_ha:1.5},{id:'empty',nama:'EMPTY',divisi:'Pisang',luas_ha:5},{id:'partial',nama:'PARTIAL',divisi:'Pisang',luas_ha:3}],progress={blocks:[{name:'PARTIAL',activity:[{name:'Tanam',ha:.25}]}]};
 for(let i=0;i<2;i++){registry.migrate();const d=bananaDetail(db,locations,progress,'2026-11-01');assert.equal(d.plantedHa,1.45);assert.equal(d.plantedPokok,2000);assert.equal(d.blocks.find(b=>b.name==='EMPTY').plantedHa,0);assert.equal(d.blocks.find(b=>b.name==='PARTIAL').plantedHa,.25);assert.equal(snapshot(),before);}

 // Imported legacy area is a boundary, so actual planting progress controls the reported area.
 const withProgress={blocks:[{name:'A',activity:[{name:'Tanam',ha:1,inputHa:1}]}]};assert.equal(bananaDetail(db,locations,withProgress,'2026-11-01').blocks.find(b=>b.name==='A').plantedHa,1);assert.equal(snapshot(),before);
 // Reviewed GIS counts supersede the old physical area and closed groups stay closed.
 db.exec("UPDATE _gis_plantings SET version=2,area_ha=0.5,population=1000 WHERE id='p1'");assert.equal(bananaDetail(db,locations,progress,'2026-11-01').blocks.find(b=>b.name==='A').plantedHa,.5);
 db.exec("UPDATE _gis_plantings SET closed_on='2026-10-31' WHERE id='p1'");assert.equal(bananaDetail(db,locations,{blocks:[{name:'A',activity:[{name:'Tanam',ha:1.5}]}]},'2026-11-01').blocks.find(b=>b.name==='A').plantedHa,0);db.close();
});
