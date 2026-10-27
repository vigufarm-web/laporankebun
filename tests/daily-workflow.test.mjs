import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {allocateHK,groupWork,prepareActual,validatePlan,activityKey,dailyWorkTarget} from '../public/js/daily-work.js';
import {checkWeeklyWorkflow,checkActualWorkflow,reallocateEffectiveHK} from '../lib/daily-workflow.js';
import {isoWeek,weekMonday} from '../public/js/weekly-work-form.js';
const item=(blok,realisasi,satuan='ha')=>({blok,aktivitas:'Herbisida spray',satuan,realisasi,selected:true});
test('one activity HK total allocates by realized area or stem, with exact rounded sum',()=>{
 assert.deepEqual(allocateHK(4,[.5,1,.5]),[1,2,1]);assert.deepEqual(allocateHK(2,[20,60]),[.5,1.5]);
 const thirds=allocateHK(1,[1,1,1]);assert.deepEqual(thirds,[.333334,.333333,.333333]);assert.equal(thirds.reduce((s,n)=>s+n,0),1);
 assert.throws(()=>allocateHK(2,[0,0]),/manual/);assert.throws(()=>allocateHK(2,[-1,1]),/nol/);
});
test('selected blocks only, zero outcome manual reason, incomplete drafts and historical units are preserved',()=>{
 const rows=[item('A',.5),item('B',1.5),{...item('C',9),selected:false}],g=groupWork(rows);g[0].hk=3;g[0].manual=false;
 assert.deepEqual(prepareActual(g,{complete:true}).items.map(r=>r.hk_realisasi),[.75,2.25]);
 const zero=groupWork([item('A',0)]);zero[0].hk=1;zero[0].manual=true;zero[0].rows[0].hk_realisasi=1;
 assert.throws(()=>prepareActual(zero,{complete:true}),/kendala/);zero[0].rows[0].keterangan='Alat rusak';assert.equal(prepareActual(zero,{complete:true}).items[0].hk_realisasi,1);
 const legacy=groupWork([{id:5,...item('A',null,'kg'),hk_realisasi:1}]);assert.equal(prepareActual(legacy,{complete:true}).items[0].satuan,'kg');
 const draft=groupWork([item('A','')]);draft[0].hk=2;assert.equal(prepareActual(draft).items[0].hk_realisasi,null);
});
test('weekly plan has independent manual targets, GIS area limits and unallocated group HK',()=>{
 const g={aktivitas:'Herbisida spray',satuan:'ha',mode:'gis',times:2,hk:3,rows:[{blok:'A',selected:true,target:2},{blok:'B',selected:true,target:4}]},locs=[{nama:'A',luas_ha:1},{nama:'B',luas_ha:2}];
 const plan=validatePlan([g],locs);assert.deepEqual(plan.items.map(r=>r.target),[2,4]);assert.ok(plan.items.every(r=>r.hk_rencana===null));assert.equal(plan.hk_groups[0].hk,3);
 assert.equal(checkWeeklyWorkflow(plan,locs)[0].times,2);
 assert.throws(()=>validatePlan([{...g,rows:[{blok:'A',selected:true,target:''}]}],locs),/target/);
 assert.throws(()=>validatePlan([g,g],locs),/Gabungkan/);
 assert.throws(()=>checkWeeklyWorkflow({...plan,hk_groups:[{...plan.hk_groups[0],times:0.5}]},locs),/pelaksanaan/);
});
test('effective capped results reallocate the same HK total; invalid group payloads cannot bypass checks',()=>{
 const body={status:'Selesai',items:[item('A',.03),item('B',.06)],hk_groups:[{key:activityKey('Herbisida spray','ha'),hk:3,manual:false}]};checkActualWorkflow(body);
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE daily_item(id INTEGER PRIMARY KEY,report_id INTEGER,urutan INTEGER,aktivitas TEXT,satuan TEXT,blok TEXT,realisasi REAL,hk_realisasi REAL,keterangan TEXT)');
 for(const [i,r] of body.items.entries())db.prepare('INSERT INTO daily_item VALUES(?,?,?,?,?,?,?,?,?)').run(i+1,1,i,r.aktivitas,r.satuan,r.blok,i===0?.02:.06,r.hk_realisasi,'');
 reallocateEffectiveHK(db,1,body.hk_groups,true);assert.deepEqual(db.prepare('SELECT hk_realisasi FROM daily_item ORDER BY id').all().map(r=>r.hk_realisasi),[.75,2.25]);
 assert.throws(()=>checkActualWorkflow({...body,hk_groups:[...body.hk_groups,...body.hk_groups]}),/cocok/);
 assert.throws(()=>checkActualWorkflow({...body,hk_groups:[{...body.hk_groups[0],hk:-1}]}),/HK kegiatan/);db.close();
});
test('week picker maps ISO year boundaries and HK-only activities do not invent output targets',()=>{
 assert.equal(isoWeek('2025-12-29'),'2026-W01');assert.equal(weekMonday('2026-W01'),'2025-12-29');assert.throws(()=>weekMonday('2026-W99'),/valid/);
 const g={key:activityKey('Pengawasan','HK'),aktivitas:'Pengawasan',satuan:'HK',hk:2,manual:false,rows:[{blok:'A',selected:true,target:null,realisasi:'',hk_realisasi:''}]};
 const p=validatePlan([g],[{nama:'A',luas_ha:1}]);assert.equal(p.items[0].target,null);
 const r=prepareActual([g],{complete:true});assert.equal(r.items[0].realisasi,null);assert.equal(r.items[0].hk_realisasi,2);
});

test('recurring daily targets survive editing on later dates without consuming the same area',()=>{
 const row={id:9,plan_item_id:1,blok:'P01',aktivitas:'Irigasi tanaman & usir burung',satuan:'ha',target:1},plan={items:[{...row,id:1,target:5}],hk_kegiatan:JSON.stringify([{key:activityKey(row.aktivitas,'ha'),times:5}])};
 assert.deepEqual(dailyWorkTarget({row,division:'Padi',plan,previousItems:[{...row,realisasi:1},{...row,realisasi:1},{...row,realisasi:1}]}),{remaining:1,repeat:true});
 assert.deepEqual(dailyWorkTarget({row,division:'Padi',previousItems:[{...row,realisasi:1}]}),{remaining:1,repeat:true});
});
test('new output still consumes weekly targets; drying and missing targets never auto-fill zero',()=>{
 const row={blok:'D04',aktivitas:'Bud injection',satuan:'stem',target:100};assert.equal(dailyWorkTarget({row,division:'Pisang',previousItems:[{...row,realisasi:60}]}).remaining,40);
 assert.equal(dailyWorkTarget({row:{...row,target:null},division:'Pisang'}).remaining,null);
 assert.equal(dailyWorkTarget({row:{blok:'P01',aktivitas:'Jemur padi',satuan:'kg',target:108},division:'Padi'}).remaining,null);
});
