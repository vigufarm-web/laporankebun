import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {TABLES} from '../public/js/schema.js';
import {createReadModels} from '../lib/read-models.js';
test('nursery and annual estimates sum every batch without changing source values',()=>{
 const db=new DatabaseSync(':memory:');
 for(const name of ['pisang_bibit','pisang_estimasi','padi_panen']){const cols=TABLES[name].f.filter(f=>f.t!=='calc'&&f.k!=='id').map(f=>'"'+f.k+'"');db.exec('CREATE TABLE '+name+' (id INTEGER PRIMARY KEY,'+cols.join(',')+')');}
 db.prepare('INSERT INTO pisang_bibit (id,klon,tanggal_datang,qty_datang,afkir,splitting,mortal,ditanam,harga_satuan) VALUES (?,?,?,?,?,?,?,?,?)').run(1,'G9','2026-01-01',100,2,5,3,10,50);
 db.prepare('INSERT INTO pisang_bibit (id,klon,tanggal_datang,qty_datang,afkir,splitting,mortal,ditanam,harga_satuan) VALUES (?,?,?,?,?,?,?,?,?)').run(2,'G9','2026-02-01',40,1,0,1,0,75);
 db.prepare('INSERT INTO pisang_estimasi (id,bulan,box,box_a,box_b,box_c) VALUES (?,?,?,?,?,?)').run(1,'2026-10-01',928,464,325,139);
 db.prepare('INSERT INTO pisang_estimasi (id,bulan,box,box_a,box_b,box_c) VALUES (?,?,?,?,?,?)').run(2,'2026-11-01',1230,615,430,185);
 db.prepare('INSERT INTO padi_panen (id,petak,gkp_kg,gkg_kg) VALUES (?,?,?,?)').run(1,'P01',100,80);
 db.prepare('INSERT INTO padi_panen (id,petak,gkp_kg,gkg_kg) VALUES (?,?,?,?)').run(2,'P01',50,null);
 const model=createReadModels({db,TABLES});const params=new URLSearchParams('summary=1');
 const bibit=model.records('pisang_bibit',params,{inputOnly:true}).summary.rows[0];assert.equal(bibit.qty_datang,140);assert.equal(bibit.saldo,128);assert.equal(bibit.pertama,'2026-01-01');
 const year=model.records('pisang_estimasi',params,{inputOnly:true}).summary.rows[0];assert.equal(year.tahun,'2026');assert.equal(year.value,2158);assert.equal(year.box_c,324);
 const rice=model.records('padi_panen',params,{inputOnly:true}).summary.rows[0];assert.equal(rice.value,150);assert.equal(rice.gkg_kg,80);assert.equal(rice.gkg_count,1);assert.equal(rice.count,2);
 assert.equal(db.prepare('SELECT harga_satuan FROM pisang_bibit WHERE id=1').get().harga_satuan,50);db.close();
});
