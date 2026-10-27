import test from 'node:test';import assert from 'node:assert/strict';
import {inputRows,inputSummary} from '../lib/input-summary.js';
test('rice sales hide process transfers without deleting originals; summary periods and months match visible rows',()=>{
 const rows=[{id:1,tanggal:'2026-10-26',jenis:'Beras',tipe:'Penjualan',nominal:100,berat_kg:10,no_sj:'A'},{id:2,tanggal:'2026-10-26',jenis:'Beras',tipe:'Retur',nominal:-20,berat_kg:-2,no_sj:'A'},{id:3,tanggal:'2026-10-01',jenis:'Beras',tipe:'Penjualan',nominal:50},{id:4,tanggal:'2025-01-01',jenis:'Beras',tipe:'Penjualan',nominal:30},{id:5,jenis:'Beras',tipe:'Penjualan',nominal:10},{id:6,tanggal:'2026-10-26',jenis:'GKG',tipe:'Mutasi Internal',nominal:9999},{id:7,tanggal:'2026-10-26',jenis:'Beras',tipe:'Sampel',nominal:0}];
 const before=JSON.stringify(rows);assert.equal(inputRows('padi_penjualan',rows).length,5);
 const data=inputSummary({tables:['padi_penjualan'],rowsOf:()=>rows,TABLES:{padi_penjualan:{date:'tanggal',title:'Penjualan Beras'}},today:'2026-10-27'}).tables[0];
 const p=Object.fromEntries(data.periods.map(p=>[p.key,p]));assert.equal(p.week.amount,80);assert.equal(p.week.rows,2);assert.equal(p.week.documents,1);assert.equal(p.month.amount,130);assert.equal(p.year.amount,130);assert.equal(p.previous.amount,30);assert.equal(p.all.amount,170);assert.equal(data.undated,1);assert.equal(data.months.find(m=>m.month==='2026-10').amount,130);assert.equal(JSON.stringify(rows),before);
});
test('non-sales input summaries count records without inventing sums of balances or repeated areas',()=>{
 const d=inputSummary({tables:['work'],rowsOf:()=>[{tanggal:'2026-10-26',luas:5},{tanggal:'2026-10-27',luas:5}],TABLES:{work:{date:'tanggal',title:'Work'}},today:'2026-10-27'}).tables[0];assert.equal(d.periods[0].rows,2);assert.deepEqual(d.metrics,[]);assert.equal(d.periods[0].amount,undefined);
});
