import test from 'node:test';
import assert from 'node:assert/strict';
import {GENERAL_DAILY_LOCATIONS,withGeneralDailyLocations} from '../public/js/daily-locations.js';
import {checkActualWorkflow,checkWeeklyWorkflow} from '../lib/daily-workflow.js';
test('general Daily locations do not become GIS land or inflate owned hectares',()=>{
 const gis=[{id:1,nama:'D04',divisi:'Pisang',luas_ha:2.4}],all=withGeneralDailyLocations(gis);
 assert.equal(gis.length,1);assert.equal(all.reduce((n,l)=>n+Number(l.luas_ha||0),0),2.4);assert.ok(all.some(l=>l.nama==='Nursery'&&l.general));assert.ok(all.some(l=>l.nama==='Packing House'));assert.equal(withGeneralDailyLocations(all).length,all.length);
 const body={tanggal:'2026-10-26',divisi:'Pisang',status:'Selesai',items:[{blok:'Nursery',aktivitas:'Siram bibit',satuan:'pokok',realisasi:23409,hk_realisasi:1}],hk_groups:[{key:'siram bibit|pokok',hk:1,manual:false}]};
 checkActualWorkflow(body);assert.equal(body.items[0].hk_realisasi,1);
 const invalid={...body,items:[{blok:'Nursery',aktivitas:'Tanam',satuan:'ha',realisasi:1}],hk_groups:[{key:'tanam|ha',hk:1,manual:false}]};assert.throws(()=>checkActualWorkflow(invalid),/blok GIS/);
 const plan={divisi:'Pisang',items:[{blok:'Nursery',aktivitas:'Tanam',satuan:'ha',target:1}],hk_groups:[{key:'tanam|ha',hk:1,mode:'manual',times:1}]};assert.throws(()=>checkWeeklyWorkflow(plan,all),/blok GIS/);
});
