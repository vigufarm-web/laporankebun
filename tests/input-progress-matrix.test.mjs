import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {TABLES} from '../public/js/schema.js';
import {createReadModels} from '../lib/read-models.js';

test('progress matrix covers more than 300 groups while excluding Daily',()=>{
 const db=new DatabaseSync(':memory:');
 const fields=TABLES.lahan_harian.f.filter(f=>f.t!=='calc').map(f=>f.k);
 const columns=[...new Set(['daily_report_id','diganti_aktual',...fields])].filter(f=>f!=='id');
 db.exec('CREATE TABLE lahan_harian (id INTEGER PRIMARY KEY,'+columns.map(f=>'"'+f+'"').join(',')+')');
 const insert=db.prepare('INSERT INTO lahan_harian (id,blok,aktivitas,hasil_ha,daily_report_id) VALUES (?,?,?,?,?)');
 for(let i=1;i<=305;i++)insert.run(i,'UJI'+i,'Tanam',0.1,null);
 insert.run(306,'DAILY','Tanam',1,9);
 const model=createReadModels({db,TABLES});
 const res=model.records('lahan_harian',new URLSearchParams('summary=1&limit=50'),{inputOnly:true});
 assert.equal(res.total,305);assert.equal(res.rows.length,50);assert.equal(res.summary.rows.length,305);
 assert.equal(res.summary.truncated,false);assert.ok(!res.summary.rows.some(r=>r.blok==='DAILY'));
 db.close();
});
