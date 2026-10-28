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
import {workKind,defaultKind} from '../public/js/daily-work.js';
test('activity kind: coverage stays routine, land preparation stays target, others follow the foreman choice',()=>{
 assert.deepEqual(workKind('Pisang','Herbisida spray','ha','target'),{kind:'rutin',locked:true,targetRequired:true},'coverage measurement keeps routine');
 assert.deepEqual(workKind('Pisang','Bajak 2','ha','rutin'),{kind:'target',locked:true,targetRequired:true},'land progress keeps target');
 assert.equal(workKind('Pisang','Ecer Pupuk','ha').kind,'rutin','existing coverage behaviour is unchanged');
 assert.deepEqual(workKind('Infra','Pengawasan','HK'),{kind:'hk',locked:true,targetRequired:false});
 assert.deepEqual(workKind('Infra','Pengiriman air','rit','rutin'),{kind:'rutin',locked:false,targetRequired:false});
 assert.equal(workKind('Infra','Pengiriman air','rit').kind,'target','saved plans without a choice keep their old target behaviour');
 assert.equal(defaultKind('Infra','Operasional traktor'),'rutin');assert.equal(defaultKind('Infra','Pembuatan parit'),'target');assert.equal(defaultKind('Pisang','Panen'),'target');
});
test('routine work may be planned without a target; target work still requires one, in the form and on the server',()=>{
 const locs=[{nama:'A',luas_ha:1}],row=t=>({blok:'A',selected:true,target:t});
 const rutin={aktivitas:'Pengiriman air',satuan:'rit',mode:'manual',times:5,hk:2,jenis:'rutin',rows:[row('')]};
 const plan=validatePlan([rutin],locs,'Infra');assert.equal(plan.items[0].target,null);assert.equal(plan.hk_groups[0].jenis,'rutin');
 const meta=checkWeeklyWorkflow({...plan,divisi:'Infra'},locs);assert.equal(meta[0].jenis,'rutin');assert.equal(plan.items[0].target,null);
 assert.throws(()=>validatePlan([{...rutin,jenis:'target'}],locs,'Infra'),/target/);
 assert.throws(()=>checkWeeklyWorkflow({...plan,divisi:'Infra',hk_groups:[{...plan.hk_groups[0],jenis:'target'}]},locs),/target/);
 assert.throws(()=>checkWeeklyWorkflow({...plan,divisi:'Infra',hk_groups:[{...plan.hk_groups[0],jenis:undefined}]},locs),/target/,'a missing choice is never treated as routine');
 assert.throws(()=>validatePlan([{aktivitas:'Herbisida spray',satuan:'ha',mode:'manual',times:1,hk:1,jenis:'rutin',rows:[row('')]}],locs,'Pisang'),/target/,'coverage targets stay required');
 assert.equal(validatePlan([{aktivitas:'Herbisida spray',satuan:'ha',mode:'manual',times:1,hk:1,rows:[row(1)]}],locs,'Pisang').hk_groups[0].jenis,undefined,'locked kinds are not stored');
 assert.throws(()=>validatePlan([{...rutin,rows:[row(-1)]}],locs,'Infra'),/angka/);
});
test('routine targets are per execution and never exhausted; without a target the routine still shows',()=>{
 const p=(target,jenis)=>({items:[{id:1,blok:'A',aktivitas:'Pengiriman air',satuan:'rit',target}],hk_kegiatan:JSON.stringify([{key:activityKey('Pengiriman air','rit'),times:5,...(jenis?{jenis}:{})}])});
 const row={plan_item_id:1,blok:'A',aktivitas:'Pengiriman air',satuan:'rit'},done=[{...row,realisasi:4},{...row,realisasi:4}];
 assert.deepEqual(dailyWorkTarget({row,division:'Infra',plan:p(20,'rutin'),previousItems:done}),{remaining:4,repeat:true});
 assert.deepEqual(dailyWorkTarget({row,division:'Infra',plan:p(null,'rutin'),previousItems:done}),{remaining:null,repeat:true});
 assert.deepEqual(dailyWorkTarget({row,division:'Infra',plan:p(20),previousItems:done}),{remaining:12,repeat:false},'old plans keep consuming the weekly target');
});
