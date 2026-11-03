import test from 'node:test';
import assert from 'node:assert/strict';
import {inputSummary} from '../lib/input-summary.js';

test('rincian periode memisahkan nilai penjualan, ongkir, pembayaran dan sisa tanpa menghitung sampel',()=>{
  const rows=[
    {id:1,tanggal:'2026-10-01',no_sj:'A',pembeli:'Toko',tipe:'Penjualan',nominal:100,dibayar:40},
    {id:2,tanggal:'2026-10-01',no_sj:'A',pembeli:'Toko',tipe:'Ongkir',nominal:10,dibayar:0},
    {id:3,tanggal:'2026-10-05',no_sj:'B',pembeli:'Toko',tipe:'Sampel',nominal:999},
    {id:4,tanggal:'2026-10-16',no_sj:'C',pembeli:'Toko',tipe:'Penjualan',nominal:50,dibayar:10},
  ];
  const data=inputSummary({tables:['pisang_penjualan'],rowsOf:()=>rows,TABLES:{pisang_penjualan:{date:'tanggal',title:'Penjualan Pisang'}},today:'2026-10-31'}).tables[0];
  const period=part=>data.selectedPeriods.find(p=>p.month==='2026-10'&&p.part===part);
  assert.deepEqual([period('first').net_sales,period('first').shipping,period('first').billed,period('first').paid,period('first').outstanding],[100,10,110,40,70]);
  assert.deepEqual([period('second').net_sales,period('second').billed,period('second').paid,period('second').outstanding],[50,50,10,40]);
  assert.deepEqual([period('full').net_sales,period('full').billed,period('full').paid,period('full').outstanding],[150,160,50,110]);
});
