import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {saveWeeklyItems} from '../lib/weekly-plan-store.js';
import {submissionFor} from '../public/js/daily-device-store.js';
import {prepareExcelInput} from '../lib/excel-input-policy.js';
import {checkWeeklyWorkflow,checkActualWorkflow} from '../lib/daily-workflow.js';

test('Excel move selects the destination identity and does not rename the GIS master',()=>{
 const old={id:5042,blok:'E01b',block_id:'old',block_name_snapshot:'E01b',hasil_ha:.52};
 const destination={id:'new',nama:'E01a',active:1};
 const changed=prepareExcelInput('lahan_harian',{blok:'E01a',hasil_ha:.52},old,{findBlock:()=>destination});
 assert.equal(changed.block_id,'new');assert.equal(changed.block_name_snapshot,'E01a');assert.equal(changed.id,5042);assert.equal(old.blok,'E01b');
 assert.throws(()=>prepareExcelInput('lahan_harian',{blok:'Unknown'},old,{findBlock:()=>null}),/GIS/);
 const stable=prepareExcelInput('lahan_harian',{blok:'E01b',hasil_ha:.6},old);assert.equal(stable.block_id,'old');
});
test('large weekly plans retain IDs across revisions and exclude removed rows without deleting history',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE daily_week_item(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT,updated_at TEXT,plan_id INTEGER,retired INTEGER DEFAULT 0,urutan INTEGER,blok TEXT,aktivitas TEXT,target REAL,satuan TEXT,hk_rencana REAL,keterangan TEXT)');
 const items=Array.from({length:260},(_,i)=>({blok:'B'+i,aktivitas:'Perawatan',target:1,satuan:'ha'}));
 const body={items,hk_groups:[{key:'perawatan|ha',hk:1,mode:'manual',times:1}]};
 checkWeeklyWorkflow(body,items.map(x=>({nama:x.blok,luas_ha:1})));
 saveWeeklyItems(db,1,items,'v1');const old=db.prepare('SELECT * FROM daily_week_item ORDER BY id').all();assert.equal(old.length,260);
 saveWeeklyItems(db,1,old.slice(0,259).map((r,i)=>({...r,target:i===0?.5:r.target})),'v2');
 const active=db.prepare('SELECT * FROM daily_week_item WHERE retired=0 ORDER BY id').all();assert.deepEqual(active.map(x=>x.id),old.slice(0,259).map(x=>x.id));assert.equal(active[0].target,.5);
 assert.equal(db.prepare('SELECT retired FROM daily_week_item WHERE id=?').get(old.at(-1).id).retired,1);
 saveWeeklyItems(db,1,items,'v3');assert.equal(db.prepare('SELECT count(*) n FROM daily_week_item').get().n,260);db.close();
});
test('more than 100 actual items are validated, and changed payloads receive a new submission key',()=>{
 const items=Array.from({length:130},(_,i)=>({blok:'B'+i,aktivitas:'Perawatan',satuan:'stem',realisasi:1}));
 const body={tanggal:'2026-10-28',status:'Selesai',items,hk_groups:[{key:'perawatan|stem',hk:13,manual:false}]};
 checkActualWorkflow(body);assert.equal(body.items.length,130);assert.ok(Math.abs(body.items.reduce((s,x)=>s+x.hk_realisasi,0)-13)<1e-6);
 const first=submissionFor(null,body,()=> 'request-one');assert.equal(submissionFor(first,body),first);
 assert.equal(submissionFor(first,{...body,status:'Draf'},()=> 'request-two').key,'request-two');
});
