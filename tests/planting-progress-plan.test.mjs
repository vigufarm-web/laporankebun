import test from 'node:test';
import assert from 'node:assert/strict';
import {planPlantingProgress} from '../lib/planting-progress-plan.js';

test('audit keeps actual planting dates and existing GIS population separate',()=>{
 const blocks=[{name:'D04',commodity:'Pisang',active:true,gis_area_ha:2.463,plantings:[{id:'legacy',source_key:'pisang_blok:170',planted_on:'2026-10-29',version:1,population:1428}]}];
 const rows=[['2026-10-29',.4485],['2026-10-30',.2655],['2026-10-31',.34],['2026-11-01',.567],['2026-11-02',.3275],['2026-11-03',.4155]].map(([tanggal,hasil_ha])=>({blok:'D04',aktivitas:'Tanam',tanggal,hasil_ha}));
 const [r]=planPlantingProgress(blocks,rows,'2026-11-09');assert.equal(r.actual.length,6);assert.ok(Math.abs(r.actualHa-2.364)<1e-9);assert.equal(r.existing[0].population,1428);assert.equal(r.matchedDays,2);assert.equal(r.exceedsGIS,false);
});
test('audit excludes opening balances and Daily, preserves GIS cap and ambiguity',()=>{
 const blocks=[{name:'D11',commodity:'Pisang',active:true,gis_area_ha:.835,plantings:[]}];
 const row={blok:'D11',aktivitas:'Tanam',tanggal:'2026-11-04',hasil_ha:.8};
 const [r]=planPlantingProgress(blocks,[row,{...row,source_key:'baseline:old'},{...row,daily_report_id:5},{...row,hasil_ha:.2},{...row,tanggal:'2027-01-01'},{...row,tanggal:'2026-02-30'}],'2026-11-09');
 assert.equal(r.actualHa,1);assert.equal(r.cappedHa,.835);assert.equal(r.exceedsGIS,true);
 assert.deepEqual(planPlantingProgress([...blocks,{...blocks[0],id:'other'}],[row],'2026-11-09'),[]);
});
test('renamed and merged GIS blocks keep actual records linked by stable id or unique alias',()=>{
 const blocks=[{id:'new',parents:['old'],name:'E01c',aliases:['E01d'],commodity:'Pisang',active:true,gis_area_ha:1,plantings:[]}];
 const rows=[{block_id:'old',blok:'E01d',aktivitas:'Tanam',tanggal:'2026-11-01',hasil_ha:.2},{blok:'E01d',aktivitas:'Tanam',tanggal:'2026-11-02',hasil_ha:.1}];
 const [p]=planPlantingProgress(blocks,rows,'2026-11-09');assert.equal(p.name,'E01c');assert.ok(Math.abs(p.actualHa-.3)<1e-9);
});
