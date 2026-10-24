import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import ExcelJS from '../lib/exceljs.min.cjs';
const root=path.resolve(import.meta.dirname,'..');
const port=3210,base=`http://127.0.0.1:${port}`;
test('migrasi, GIS, riwayat selesai, pagination, iklim dan impor Excel aman', {timeout:120000},async()=>{
 const dir=path.join(root,'work','tests-'+Date.now());fs.mkdirSync(dir,{recursive:true});
 let proc=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:path.join(dir,'data'),EXCEL_FILE:path.join(dir,'input.xlsx')},stdio:['ignore','pipe','pipe']});let output='';proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);let cookie='';
 try{
  let ready=false;for(let i=0;i<240;i++){if(proc.exitCode!=null)throw Error(output);try{const r=await fetch(base+'/api/me');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'server starts: '+output);
  const request=async(p,method='GET',body)=>{const r=await fetch(base+p,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};};
  const initial=await request('/api/records/pisang_penjualan?limit=50');assert.equal(initial.status,200);assert.equal(initial.body.rows.length,50);assert.equal(initial.body.total,909);
  const overview=await request('/api/overview?from=2026-10-01&to=2026-10-24');assert.equal(overview.status,200);assert.equal(overview.body.climate.observations>0,true);assert.ok(JSON.stringify(overview.body).length<80000,'small overview response');
  let r=await request('/api/setup','POST',{username:'test-admin',nama:'Integration test',password:crypto.randomUUID()});assert.equal(r.status,200);
  const beforeSales=await request('/api/t/pisang_penjualan');const salesIDs=beforeSales.body.map(x=>x.id);
  const all=await request('/api/blocks');const old=all.body.find(x=>x.nama==='A01');assert.ok(old);
  const feature=(name,id,parents)=>({type:'Feature',geometry:{type:'Polygon',coordinates:[[[109,-7],[109.001,-7],[109.001,-7.001],[109,-7]]]},properties:{Nama_Blok:name,Lahan:'Pisang',kepemilikan:'Sudah milik kebun',...(id?{blok_id:id}:{}),...(parents?{parent_ids:parents}:{})}});
  let layer={nama:'Blok Kebun Test',jenis:'Blok Tanam',field_nama:'Nama_Blok',tampil:1,warna:'#336644',gaya:'{}',geojson:JSON.stringify({type:'FeatureCollection',features:[feature('A01',old.id)]})};
  const apply=async(layerId,next,mappings={})=>{const p=await request('/api/gis/revision','POST',{layerId,layer:next,mappings});assert.equal(p.status,200);assert.deepEqual(p.body.errors,[]);const a=await request('/api/gis/revision','POST',{mode:'apply',token:p.body.token,layerId,layer:next,mappings});assert.equal(a.status,200,JSON.stringify(a.body));return a.body;};
  let applied=await apply(null,layer);const layerId=applied.id;
  r=await request('/api/daily/locations');assert.ok(r.body.some(x=>x.nama==='A01'&&x.blok_id===old.id));
  r=await request('/api/daily','POST',{tanggal:'2026-10-24',divisi:'Pisang',status:'Selesai',items:[{blok:'A01',aktivitas:'Pemupukan test',realisasi:500,hk_realisasi:4,satuan:'pokok'}]});assert.equal(r.status,200);const reportId=r.body.id;
  layer={...layer,geojson:JSON.stringify({type:'FeatureCollection',features:[feature('A01-REVISI',old.id)]})};await apply(layerId,layer);
  r=await request('/api/daily?from=2026-10-24&to=2026-10-24');const report=r.body.find(x=>x.id===reportId);assert.equal(report.status,'Selesai');assert.equal(report.items[0].blok,'A01-REVISI');assert.equal(report.items[0].block_id,old.id);assert.equal(report.items[0].realisasi,500);assert.equal(report.items[0].block_name_snapshot,'A01');
  r=await request('/api/blocks');assert.ok(r.body.find(x=>x.id===old.id).aliases.includes('A01'));
  let proposal={...layer,geojson:JSON.stringify({type:'FeatureCollection',features:[feature('NAMA TANPA ID')]})};r=await request('/api/gis/revision','POST',{layerId,layer:proposal});assert.ok(r.body.errors.length,'ambiguous rename requires mapping');
  // A split inherits the original history without duplicating daily quantities.
  proposal={...layer,geojson:JSON.stringify({type:'FeatureCollection',features:[feature('ANAK-1','test-child-1',[old.id]),feature('ANAK-2','test-child-2',[old.id])]})};await apply(layerId,proposal);
  r=await request('/api/blocks/test-child-1/history');assert.equal(r.status,200);assert.equal(r.body.filter(x=>x.table==='daily_item'&&x.row.report_id===reportId).length,1);assert.ok(r.body.some(x=>x.inherited));
  r=await request('/api/blocks');assert.equal(r.body.find(x=>x.id===old.id).active,0);
  r=await request('/api/daily?from=2026-10-24&to=2026-10-24');assert.equal(r.body.find(x=>x.id===reportId).items[0].realisasi,500);
  // Unowned geometry is not offered to field users.
  const unowned=feature('BUKAN-MILIK','unowned-block');unowned.properties.kepemilikan='Belum milik kebun';proposal.geojson=JSON.stringify({type:'FeatureCollection',features:[feature('ANAK-1','test-child-1',[old.id]),feature('ANAK-2','test-child-2',[old.id]),unowned]});await apply(layerId,proposal);r=await request('/api/daily/locations');assert.ok(!r.body.some(x=>x.nama==='BUKAN-MILIK'));
  r=await request('/api/daily','POST',{tanggal:'2026-10-25',divisi:'Pisang',items:[{blok:'BUKAN-MILIK',aktivitas:'Test'}]});assert.equal(r.status,400);
  // Existing historical locations remain editable, while new unowned locations stay blocked.
  r=await request('/api/daily','POST',{id:reportId,tanggal:report.tanggal,divisi:report.divisi,status:'Selesai',items:report.items});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items[0].realisasi,500);
  r=await request('/api/daily','POST',{tanggal:'2026-10-26',divisi:'Pisang',status:'Draf',items:[{blok:'ANAK-1',aktivitas:'Belum ada hasil',satuan:'ha',hk_realisasi:1}]});assert.equal(r.status,200);assert.equal(r.body.items[0].realisasi,null);assert.equal(r.body.items[0].hasil_sdhi,null);assert.equal(r.body.items[0].target,null);
  // Expired originals and thumbnails are removed; text and quantities survive.
  const photoDir=path.join(dir,'data','daily-photos');fs.mkdirSync(photoDir,{recursive:true});
  fs.writeFileSync(path.join(photoDir,'expired.webp'),'test original');fs.writeFileSync(path.join(photoDir,'expired-thumb.webp'),'test thumbnail');
  const fixture=new DatabaseSync(path.join(dir,'data','kebun.db'));
  const expiredId=Number(fixture.prepare('INSERT INTO daily_photo(created_at,updated_at,report_id,storage,lokasi,thumb_storage,thumb_lokasi,mime,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run('2000-01-01','2000-01-01',reportId,'local','expired.webp','local','expired-thumb.webp','image/webp','2000-01-08T00:00:00.000Z').lastInsertRowid);fixture.close();
  assert.equal((await fetch(base+'/api/daily/photo/'+expiredId,{headers:{cookie}})).status,404);
  r=await request('/api/daily/cleanup');assert.equal(r.status,200);assert.ok(r.body.deleted>=1);
  assert.equal(fs.existsSync(path.join(photoDir,'expired.webp')),false);assert.equal(fs.existsSync(path.join(photoDir,'expired-thumb.webp')),false);
  r=await request('/api/daily?from=2026-10-24&to=2026-10-24');assert.equal(r.body.find(x=>x.id===reportId).items[0].realisasi,500);assert.ok(r.body.find(x=>x.id===reportId).photos.find(x=>x.id===expiredId).deleted_at);
  // No history is removed when a spreadsheet omits its rows.
  const downloaded=await fetch(base+'/api/excel/download?tables=pisang_penjualan&panel=Test',{headers:{cookie}});assert.equal(downloaded.status,200);const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await downloaded.arrayBuffer()));const ws=wb.worksheets.find(x=>x.name!=='Petunjuk'&&x.name!=='_daftar');assert.ok(ws);ws.spliceRows(3,ws.rowCount-2);
  const upload=async(bytes,preview=false)=>{const response=await fetch(base+'/api/excel/upload?tables=pisang_penjualan&panel=Test'+(preview?'&preview=1':''),{method:'POST',headers:{cookie,'Content-Type':'application/octet-stream'},body:bytes});return {status:response.status,body:await response.json()};};
  let bytes=Buffer.from(await wb.xlsx.writeBuffer());r=await upload(bytes);assert.equal(r.status,200,JSON.stringify(r.body));let after=await request('/api/t/pisang_penjualan');assert.deepEqual(after.body.map(x=>x.id),salesIDs,'omitted sales retain IDs and values');
  const headers=ws.getRow(1).values;const amountColumn=headers.findIndex(x=>String(x||'').replace(/\*/g,'').trim()==='Sudah Dibayar (Rp)');assert.ok(amountColumn>0);const id=Number(ws.getCell(2,1).value);ws.getCell(2,amountColumn).value=12345;bytes=Buffer.from(await wb.xlsx.writeBuffer());r=await upload(bytes);assert.equal(r.status,200);after=await request('/api/t/pisang_penjualan');assert.equal(after.body.find(x=>x.id===id).dibayar,12345);assert.equal(after.body.length,909);
  r=await upload(bytes,true);assert.ok(r.body.sheets.some(x=>x.jumlahError>0),'stale Excel updates are rejected');
  // PDF permission checks and production PDF generation.
  await request('/api/settings','PUT',{nama:'VIGU FARM - CONTOH DATA UJI'});
  for(const kind of ['daily','owner']){const response=await fetch(base+'/api/reports/'+kind+'.pdf?'+(kind==='daily'?'from=2026-10-24&to=2026-10-24&divisi=Pisang':'from=2026-10-01&to=2026-10-24'),{headers:{cookie}});assert.equal(response.status,200,response.status!==200?await response.text():'');assert.equal(response.headers.get('content-type'),'application/pdf');const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1000);if(process.env.WRITE_PDF_SAMPLES==='1')fs.writeFileSync(path.resolve(root,'..','contoh-laporan-'+kind+'.pdf'),bytes);}
  const adminCookie=cookie,mandorPass=crypto.randomUUID();r=await request('/api/users','POST',{username:'mandor-test',nama:'Mandor test',password:mandorPass,peran:['daily_pisang']});assert.equal(r.status,200);
  r=await request('/api/login','POST',{username:'mandor-test',password:mandorPass});assert.equal(r.status,200);
  let response=await fetch(base+'/api/reports/owner.pdf?from=2026-10-01&to=2026-10-24',{headers:{cookie}});assert.equal(response.status,403);
  response=await fetch(base+'/api/reports/daily.pdf?from=2026-10-01&to=2026-10-24&divisi=Padi',{headers:{cookie}});assert.equal(response.status,403);
  response=await fetch(base+'/api/reports/daily.pdf?from=2026-10-01&to=2026-10-24&divisi=Pisang',{headers:{cookie}});assert.equal(response.status,200);
  r=await request('/api/reports/share?from=2026-10-24&to=2026-10-24&divisi=Pisang');assert.equal(r.status,200);assert.ok(r.body.text.includes('Pemupukan test'));assert.ok(!r.body.text.includes('/ Padi /'));
  response=await fetch(base+'/api/reports/daily.pdf');assert.equal(response.status,401);
  cookie=adminCookie;
  // A second start reruns migration against existing data without losing IDs or results.
  const exit=once(proc,'exit');proc.kill();await exit;
  proc=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:path.join(dir,'data'),EXCEL_FILE:path.join(dir,'input.xlsx')},stdio:['ignore','pipe','pipe']});proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);
  let restarted=false;for(let i=0;i<240;i++){if(proc.exitCode!=null)throw Error(output);try{if((await fetch(base+'/api/me')).ok){restarted=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(restarted);
  r=await request('/api/blocks');assert.equal(r.body.find(x=>x.id===old.id).nama,'A01-REVISI');assert.equal(r.body.find(x=>x.id===old.id).active,0);
  r=await request('/api/daily?from=2026-10-24&to=2026-10-24');assert.equal(r.body.find(x=>x.id===reportId).items[0].realisasi,500);assert.equal(r.body.find(x=>x.id===reportId).items[0].block_name_snapshot,'A01');
  r=await request('/api/t/pisang_penjualan');assert.deepEqual(r.body.map(x=>x.id),salesIDs);assert.equal(r.body.find(x=>x.id===id).dibayar,12345);
  console.log('Verified: stable block ID, rename keeps completed quantities, split ancestry, ownership exclusion, 50-row pagination, small overview, Excel no deletion, stable row IDs and stale-file protection.');
 }finally{proc.kill();}
});
