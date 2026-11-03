import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from '../lib/exceljs.min.cjs';
import {addSalesExcelReport,compareSalesSJ} from '../lib/sales-excel-report.js';

test('SJ urut numerik dalam bulan dan gudang, dan rincian sama berdekatan',()=>{
 const rows=[{tanggal:'2026-10-20',gudang:'TGL',no_sj:'10/TGL'},{tanggal:'2026-10-22',gudang:'TGL',no_sj:'2/TGL'},{tanggal:'2026-10-01',gudang:'TGL',no_sj:'1/TGL'},{tanggal:'2026-11-01',gudang:'TGL',no_sj:'1/TGL'},{tanggal:'2026-10-23',gudang:'TGL',no_sj:'2/TGL'},{tanggal:'2026-10-01',gudang:'SMG',no_sj:'3/SMG'}];
 assert.deepEqual(rows.sort(compareSalesSJ).map(r=>r.no_sj),['3/SMG','1/TGL','2/TGL','2/TGL','10/TGL','1/TGL']);
});

test('laporan Excel memisahkan ringkasan, pembeli dan SJ, serta menghitung retur dan ongkir',async()=>{
 const rows=[
  {id:1,tanggal:'2026-10-02',no_sj:'A',pembeli:'Toko',tipe:'Penjualan',nominal:100000,dibayar:30000,jumlah_box:5,berat_kg:0},
  {id:2,tanggal:'2026-10-02',no_sj:'A',pembeli:'Toko',tipe:'Ongkir',nominal:10000,dibayar:0,jumlah_box:5},
  {id:3,tanggal:'2026-10-20',no_sj:'B',pembeli:'Toko',tipe:'Retur',nominal:-20000,jumlah_box:-1,dibayar:0},
  {id:4,tanggal:'2026-10-02',no_sj:'S',pembeli:'Toko',tipe:'Sampel',nominal:9000,jumlah_box:9},
  {id:5,tanggal:'2025-12-31',no_sj:'C',pembeli:'Pembeli B',tipe:'Penjualan',nominal:50000,dibayar:50000,jumlah_box:2},
  {id:6,tanggal:'2026-11-03',no_sj:'F',pembeli:'Masa depan',tipe:'Penjualan',nominal:999999,jumlah_box:1},
  {id:7,tanggal:null,no_sj:'G',pembeli:'Arsip',tipe:'Penjualan',nominal:5000,jumlah_box:1},
 ];
 const wb=new ExcelJS.Workbook();addSalesExcelReport(wb,{table:'pisang_penjualan',rows,today:'2026-10-31'});
 const exported=await wb.xlsx.writeBuffer(),read=new ExcelJS.Workbook();await read.xlsx.load(exported);
 const s=read.getWorksheet('Ringkasan Penjualan');
 assert.deepEqual([s.getCell('C7').value,s.getCell('D7').value,s.getCell('E7').value,s.getCell('F7').value,s.getCell('G7').value,s.getCell('H7').value],[80000,10000,90000,30000,80000,4]);
 assert.equal(s.getCell('C10').value,80000);assert.equal(s.getCell('C11').value,50000);assert.equal(s.getCell('C12').value,135000);
 const d=read.getWorksheet('Piutang per SJ');assert.equal(d.rowCount,4);assert.equal(d.getRow(2).getCell(9).value,80000);
 assert.equal(read.getWorksheet('Piutang Pembeli').rowCount,3);
 assert.ok(String(s.getCell('A5').value).includes('tidak otomatis berubah'));
});
