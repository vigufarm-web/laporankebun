import test from 'node:test';import assert from 'node:assert/strict';import {ownerTable} from '../public/js/daily.js';
test('daily owner table combines confirmed aliases while keeping unlike units separate',()=>{
 const items=[{aktivitas:'Aplikasi dolomit',blok:'A',satuan:'ha',realisasi:1},{aktivitas:'Aplikasi kapur dolomit',blok:'B',satuan:'ha',realisasi:2},{aktivitas:'Booster LOB',blok:'N',satuan:'pokok',realisasi:10},{aktivitas:'Booster LOB bibit',blok:'N',satuan:'pokok',realisasi:5},{aktivitas:'Booster LOB',blok:'N',satuan:'ha',realisasi:1}];
 const html=ownerTable([{tanggal:'2026-11-10',divisi:'Pisang',status:'Selesai',items}]);
 assert.equal((html.match(/Aplikasi kapur dolomite/g)||[]).length,1);assert.match(html,/>3<\/b> ha/);
 assert.equal((html.match(/Booster LOB/g)||[]).length,2);assert.match(html,/>15<\/b> pokok/);
});
const cells=html=>[...html.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(x=>x[1].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim());
test('Daily combines shift results while counting each block cumulative and weekly plan once',()=>{
 const report={tanggal:'2026-10-24',divisi:'Pisang',status:'Selesai',items:[{aktivitas:'Bajak 1',blok:'D04',satuan:'ha',realisasi:1,hasil_sdhi:9,hk_realisasi:.5,target_hk_minggu:7},{aktivitas:'Bajak 1',blok:'D04',satuan:'ha',realisasi:2,hasil_sdhi:9,hk_realisasi:1,target_hk_minggu:7}]};const html=ownerTable([report]),values=cells(html);assert.equal(values[3],'3 ha');assert.equal(values[4],'9 ha');assert.equal(values[5],'1,5');assert.equal(values[6],'7 HK · tenaga');assert.ok(html.indexOf('HI — Hasil hari ini')<html.indexOf('SDHI — Hasil minggu ini'));assert.ok(html.indexOf('SDHI — Hasil minggu ini')<html.indexOf('>HK<'));
});
