import test from 'node:test';
import assert from 'node:assert/strict';
import {actualRows, groupWork, prepareActual} from '../public/js/daily-work.js';

test('reopened draft retains saved rows and offers remaining active planned work',()=>{
 const saved={items:[{id:8,plan_item_id:1,aktivitas:'Tanam',blok:'D01',satuan:'ha',realisasi:.2,hk_realisasi:1}]};
 const plan={items:[{id:1,aktivitas:'Tanam',blok:'D01',satuan:'ha',target:1},{id:2,aktivitas:'Tanam',blok:'D02',satuan:'ha',target:2},{id:3,aktivitas:'Tanam',blok:'lama',satuan:'ha',target:2}]};
 const rows=actualRows(saved,plan,[{nama:'D01'},{nama:'D02'}]);
 assert.equal(rows.length,2); assert.equal(rows[0].realisasi,.2); assert.equal(rows[0].selected,true);
 assert.equal(rows[1].plan_item_id,2); assert.equal(rows[1].selected,false);
 assert.equal(prepareActual(groupWork(rows)).items.length,1);
});

test('historic activity without a plan id is not duplicated',()=>{
 const base={items:[{id:8,aktivitas:'Panen',blok:'D01',satuan:'tandan'}]};
 const rows=actualRows(base,{items:[{id:9,aktivitas:'Panen',blok:'D01',satuan:'tandan'}]},[{nama:'D01'}]);
 assert.equal(rows.length,1); assert.equal(rows[0].id,8);
});
