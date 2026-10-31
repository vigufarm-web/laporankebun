import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkbook,parseWorkbook,sheetFields} from '../lib/excel.js';
import {TABLES,EXCEL_SHEETS} from '../public/js/schema.js';

test('sales downloads show explicit and calculated rupiah without turning totals into import inputs',async()=>{
 const SHEETS=EXCEL_SHEETS.filter(c=>['pisang_penjualan','padi_penjualan'].includes(c.table));
 const data={pisang_penjualan:[{id:1,tanggal:'2026-10-30',jumlah_box:2,harga:30000,nominal:null},{id:2,tanggal:'2026-10-30',jumlah_box:2,harga:30000,nominal:55000},{id:3,tanggal:'2026-10-30',jumlah_box:-1,harga:30000,nominal:null}],padi_penjualan:[{id:4,tanggal:'2026-10-30',berat_kg:50,harga_kg:12000,nominal:null}]};
 const wb=await buildWorkbook({TABLES,SHEETS,rowsOf:t=>data[t]||[]});
 for(const cfg of SHEETS){
  const ws=wb.getWorksheet(cfg.sheet),fields=sheetFields(TABLES,cfg),amount=fields.findIndex(f=>f.k==='nominal')+1;
  assert.equal(!!ws.getColumn(amount).hidden,false);
  const total=fields.length+1;assert.equal(ws.getCell(1,total).value,'Total (Rp)');assert.equal(ws.getColumn(total).numFmt,'#,##0');
  assert.equal(ws.getCell(2,total).value,cfg.table==='pisang_penjualan'?60000:600000);
  if(cfg.table==='pisang_penjualan'){assert.equal(ws.getCell(3,total).value,55000);assert.equal(ws.getCell(4,total).value,-30000);}
 }
 const parsed=await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()),{TABLES,SHEETS});
 for(const sheet of parsed){assert.equal(sheet.errors.length,0);assert.equal(sheet.layoutBeda,false);assert.equal(sheet.rows[0].nominal,null);assert.equal(Object.hasOwn(sheet.rows[0],'total'),false);}
});

test('Jenis Barang is a visible yellow input and export/import completes its classification',async()=>{
 const SHEETS=EXCEL_SHEETS.filter(c=>c.table==='pisang_penjualan'),cfg=SHEETS[0],fields=sheetFields(TABLES,cfg),input={id:1,tanggal:'2026-10-30',jenis_barang:'PISANG CAVENDISH FH A MATANG',jumlah_box:2,harga:30000};
 const wb=await buildWorkbook({TABLES,SHEETS,rowsOf:()=>[input]}),ws=wb.getWorksheet(cfg.sheet),col=k=>fields.findIndex(f=>f.k===k)+1;
 assert.equal(!!ws.getColumn(col('jenis_barang')).hidden,false);assert.equal(ws.getCell(2,col('jenis_barang')).fill.fgColor.argb,'FFFFF7D6');
 assert.equal(ws.getCell(2,col('bentuk')).value,'FH');assert.equal(ws.getCell(2,col('kelas')).value,'A');assert.equal(ws.getCell(2,col('kondisi')).value,'Matang');assert.equal(input.bentuk,undefined);
 for(const k of ['bentuk','kelas','kondisi'])ws.getCell(2,col(k)).value=null;
 const parsed=await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()),{TABLES,SHEETS});assert.equal(parsed[0].errors.length,0);assert.equal(parsed[0].rows[0].bentuk,'FH');assert.equal(parsed[0].rows[0].kelas,'A');assert.equal(parsed[0].rows[0].kondisi,'Matang');
});
