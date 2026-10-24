import test from 'node:test';import assert from 'node:assert/strict';import {ownerTable} from '../public/js/daily.js';
const cells=html=>[...html.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(x=>x[1].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim());
test('Daily combines shift results while counting each block cumulative and weekly plan once',()=>{
 const report={tanggal:'2026-10-24',divisi:'Pisang',status:'Selesai',items:[{aktivitas:'Bajak 1',blok:'D04',satuan:'ha',realisasi:1,hasil_sdhi:9,hk_realisasi:.5,target_hk_minggu:7},{aktivitas:'Bajak 1',blok:'D04',satuan:'ha',realisasi:2,hasil_sdhi:9,hk_realisasi:1,target_hk_minggu:7}]};const html=ownerTable([report]),values=cells(html);assert.equal(values[3],'3 ha');assert.equal(values[4],'9 ha');assert.equal(values[5],'1,5');assert.equal(values[6],'7 HK · tenaga');assert.ok(html.indexOf('HI — Hasil hari ini')<html.indexOf('SDHI — Hasil minggu ini'));assert.ok(html.indexOf('SDHI — Hasil minggu ini')<html.indexOf('>HK<'));
});
