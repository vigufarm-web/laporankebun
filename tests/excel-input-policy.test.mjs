import test from 'node:test';import assert from 'node:assert/strict';
import {TABLES,EXCEL_SHEETS} from '../public/js/schema.js';
import {buildWorkbook,parseWorkbook,sheetFields} from '../lib/excel.js';
import {isExcelReference,prepareExcelInput,capExcelLandChanges} from '../lib/excel-input-policy.js';
test('Excel inputs hide technical fields, GIS references retain stored measurements and new masters resolve GIS',()=>{
 const f=sheetFields(TABLES,EXCEL_SHEETS.find(c=>c.table==='lahan_harian'));assert.ok(!f.some(f=>['source_key','daily_report_id','hasil_input_ha','diganti_aktual'].includes(f.k)));assert.ok(f.some(f=>f.k==='hasil_ha'));
 const old={id:1,nama_blok:'A',luas_ha:.4,pokok_tanam:500,keterangan:'lama'},findBlock=()=>({luas_ha:1,divisi:'Pisang',ownership:'Sudah milik kebun'});
 const r=prepareExcelInput('pisang_blok',{nama_blok:'A',luas_ha:99,pokok_tanam:600},old,{findBlock});assert.equal(r.luas_ha,.4);assert.equal(r.pokok_tanam,600);assert.equal(r.keterangan,'lama');assert.equal(old.pokok_tanam,500);
 assert.equal(prepareExcelInput('pisang_blok',{nama_blok:'A',luas_ha:99},null,{findBlock}).luas_ha,1);assert.throws(()=>prepareExcelInput('padi_petak',{nama_petak:'UNKNOWN'},null,{}),/GIS/);
 assert.equal(isExcelReference('lahan_rencana','mulai'),true);assert.equal(isExcelReference('lahan_harian','hasil_ha'),false);
});
test('Excel recomputes formerly automatic sale totals but preserves explicit manual nominal',()=>{
 const old={jumlah_box:10,harga:20,nominal:200};assert.equal(prepareExcelInput('pisang_penjualan',{...old,jumlah_box:12},old).nominal,null);
 const manual={...old,nominal:190};assert.equal(prepareExcelInput('pisang_penjualan',{...manual,jumlah_box:12},manual).nominal,190);
 const rice={berat_kg:10,harga_kg:15000,nominal:150000};assert.equal(prepareExcelInput('padi_penjualan',{...rice,berat_kg:12},rice).nominal,null);
});
test('Excel land recognizes only remaining stage area and preserves original over-input',()=>{
 const current=[{id:1,blok:'A',aktivitas:'LC',hasil_ha:.98},{id:2,blok:'A',aktivitas:'Bajak 1',hasil_ha:1}],ops=[{row:{tanggal:'2026-10-27',blok:'A',aktivitas:'LC',hasil_ha:.03}}];
 const warnings=capExcelLandChanges(ops,current,()=>({luas_ha:1}));assert.ok(Math.abs(ops[0].row.hasil_ha-.02)<1e-8);assert.equal(ops[0].row.hasil_input_ha,.03);assert.equal(warnings.length,1);assert.equal(current[0].hasil_ha,.98);
 assert.throws(()=>capExcelLandChanges([{row:{blok:'X',hasil_ha:1}}],[],()=>null),/GIS/);
});
test('templates distinguish GIS, generated schedules and sale-derived fields; metadata roundtrip remains intact',async()=>{
 const SHEETS=EXCEL_SHEETS.filter(c=>['lahan_harian','lahan_blok','lahan_rencana','pisang_penjualan','pisang_estimasi'].includes(c.table));
 const rows={lahan_harian:[{id:9,updated_at:'v1',tanggal:'2026-10-20',aktivitas:'Tanam',blok:'A',hasil_ha:.2,source_key:'actual:test',daily_report_id:3}],lahan_blok:[{id:1,blok:'A',luas_ha:1}],lahan_rencana:[{id:1,blok:'A',aktivitas:'Tanam',luas_ha:1,mulai:'2026-11-01',selesai:'2026-11-02'}]};
 const w=await buildWorkbook({TABLES,SHEETS,rowsOf:t=>rows[t]||[]});const col=(s,k)=>w.getWorksheet(s.sheet).getColumn(sheetFields(TABLES,s).findIndex(f=>f.k===k)+1),cfg=t=>SHEETS.find(s=>s.table===t);
 assert.notEqual(col(cfg('lahan_blok'),'luas_ha').fill?.fgColor?.argb,'FFFFF7D6');assert.equal(col(cfg('lahan_harian'),'hasil_ha').fill.fgColor.argb,'FFFFF7D6');assert.notEqual(col(cfg('lahan_rencana'),'mulai').fill?.fgColor?.argb,'FFFFF7D6');assert.equal(col(cfg('pisang_penjualan'),'jenis_barang').hidden,true);assert.equal(!!col(cfg('pisang_penjualan'),'nominal').hidden,false);assert.equal(w.getWorksheet(cfg('lahan_rencana').sheet).state,'hidden');
 const land=w.getWorksheet(cfg('lahan_harian').sheet);land.getCell(1,sheetFields(TABLES,cfg('lahan_harian')).findIndex(f=>f.k==='hasil_ha')+1).value='Hasil (ha) *';
 const est=w.getWorksheet(cfg('pisang_estimasi').sheet),ef=sheetFields(TABLES,cfg('pisang_estimasi'));for(const [k,v] of Object.entries({bulan:new Date('2026-10-01'),box_a:100,box_b:50}))est.getCell(2,ef.findIndex(f=>f.k===k)+1).value=v;
 const parsed=await parseWorkbook(Buffer.from(await w.xlsx.writeBuffer()),{TABLES,SHEETS});const plan=parsed.find(p=>p.cfg.table==='pisang_estimasi');assert.equal(plan.rows[0].box,150);assert.equal(plan.errors.length,0);
 const h=parsed.find(p=>p.cfg.table==='lahan_harian').rows[0];assert.equal(h._record_id,9);assert.equal(h._row_updated_at,'v1');assert.equal(h.source_key,undefined);const kept=prepareExcelInput('lahan_harian',h,rows.lahan_harian[0]);assert.equal(kept.daily_report_id,3);assert.equal(kept.source_key,'actual:test');
});
