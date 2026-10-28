import test from 'node:test';import assert from 'node:assert/strict';
import ExcelJS from '../lib/exceljs.min.cjs';
import {accountabilityData,accountabilityWorkbook} from '../lib/accountability-report.js';
const input=()=>({from:'2026-01-01',to:'2026-10-28',today:'2026-10-28',createdBy:'Admin',
 overview:{blocks:{ownedAreaHa:12.5,owned:3},pisang:{harvest:10,boxes:20,kg:300,sales:{revenue:5000,paid:4000,outstanding:1000}},padi:{harvestKg:900,harvestGkgKg:800,milledKg:500,sales:{revenue:700,paid:700,outstanding:0}},infra:{lcHa:2},dailyTotals:{Pisang:{reports:2,hk:9}},climate:{rain:40,rainDays:3,missingDays:0,days:[{tanggal:'2026-10-27',hujan:12}]}},
 plan:{year:2026,targetHa:4,plantedHa:1.5,remainingHa:2.5,forecastEnd:'2026-12-10',blocks:[{name:'D04',area:2,targetMonth:'2026-11',plantedHa:1.5,remainingHa:.5,forecast:'2026-11-20',complete:false,late:false}],banana:{area:6,plantedHa:3.5,plantedPokok:7000,population:6900,nursery:{incoming:100,splitting:5,planted:60,rejected:2,mortality:3,balance:40},blocks:[{name:'D04',area:2,plantedHa:1.5,plantedPokok:3000,population:2950},{name:'D11',area:4,plantedHa:2,plantedPokok:4000,population:3950}]}},
 padi:{area:6.5,plantedHa:2,harvestedHa:3,otherHa:1.5,blocks:[{name:'P01',area:6.5,status:'Sudah Tanam',plantedHa:2,harvestedHa:3,otherHa:1.5,variety:'Inpari 32',plantDate:'2026-09-01'}],seeds:{varieties:[{name:'Inpari 32',incoming:50,used:30,rejected:0,balance:20}]}},
 locations:[{nama:'P01',divisi:'Padi',luas_ha:6.5},{nama:'D11',divisi:'Pisang',luas_ha:4},{nama:'D04',divisi:'Pisang',luas_ha:2}],
 details:[{title:'Penjualan Pisang',fields:[{k:'tanggal',l:'Tanggal',t:'date'},{k:'tipe',l:'Tipe',t:'select'},{k:'harga',l:'Harga @',t:'money'},{k:'total',l:'Total (Rp)',t:'calc'}],rows:[{tanggal:'2026-10-01',tipe:'Penjualan',harga:100,total:5000},{tanggal:'2026-10-02',tipe:'Mutasi Internal',harga:50,total:300}],sale:r=>r.tipe!=='Mutasi Internal'}]});
test('land list joins every owned block with its planted, remaining and harvested area',()=>{
 const d=accountabilityData(input()),lahan=d.sheets.find(s=>s.name==='Daftar Lahan');
 assert.deepEqual(lahan.rows.map(r=>[r.blok,r.komoditas,r.luas,r.tertanam,r.belum,r.panen,r.status]),[['P01','Padi',6.5,2,1.5,3,'Sudah Tanam'],['D04','Pisang',2,1.5,.5,null,'Tertanam sebagian'],['D11','Pisang',4,2,2,null,'Tertanam sebagian']]);
 const pisang=d.summary.find(s=>s.title.startsWith('Pisang — lahan'));assert.deepEqual(pisang.items.slice(0,3).map(i=>[i.label,i.value]),[['Total luas blok Pisang',6],['Sudah tertanam',3.5],['Sisa belum tertanam',2.5]]);
 assert.equal(d.sheets.find(s=>s.name==='Penjualan Pisang').total.includes('harga'),false,'unit prices are never summed');
});
test('the workbook is tidy: summary first, header row, totals, and sales total matching the summary',async()=>{
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(await accountabilityWorkbook(accountabilityData(input())));
 assert.equal(wb.worksheets[0].name,'Ringkasan');const labels=[];wb.worksheets[0].eachRow(r=>labels.push(r.getCell(1).value));
 for(const l of ['LAPORAN PERTANGGUNGJAWABAN KEBUN','Sudah tertanam','Sisa belum tertanam','Saldo benih Inpari 32','Piutang'])assert.ok(labels.includes(l),l);
 const sales=wb.getWorksheet('Penjualan Pisang'),rows=[];sales.eachRow(r=>rows.push(r.values.slice(1)));
 assert.deepEqual(rows.at(-2).filter(v=>v!=null),['TOTAL semua baris',5300]);assert.deepEqual(rows.at(-1).filter(v=>v!=null),['TOTAL PENJUALAN (sama dengan Ringkasan)',5000]);
 const land=wb.getWorksheet('Daftar Lahan');assert.equal(land.getRow(5).getCell(1).value,'Blok');assert.equal(land.getRow(9).getCell(1).value,'TOTAL');assert.equal(land.getRow(9).getCell(3).value,12.5);
});
