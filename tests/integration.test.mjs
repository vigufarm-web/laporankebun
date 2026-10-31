import sharp from 'sharp';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
import {createServer} from 'node:net';
import ExcelJS from '../lib/exceljs.min.cjs';
const root=path.resolve(import.meta.dirname,'..');

// Tests may never inherit credentials or endpoints for a production data store.
const isolatedEnv={...process.env,DATA_BACKEND:'local'};
for(const key of Object.keys(isolatedEnv))if(/^(GITHUB_DATA_|TURSO_|LIBSQL_|BLOB_READ_WRITE_TOKEN|CRON_SECRET|VERCEL)/.test(key)||/^libsql:\/\//.test(isolatedEnv[key])||/^https:\/\/[^/]+\.turso\.io/.test(isolatedEnv[key]))delete isolatedEnv[key];

test('migrasi, GIS, riwayat selesai, pagination, iklim dan impor Excel aman', {timeout:120000},async()=>{
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));const base=`http://127.0.0.1:${port}`;
 const dir=path.join(root,'work','tests-'+Date.now());fs.mkdirSync(dir,{recursive:true});
 let proc=spawn(process.execPath,['server.js'],{cwd:root,env:{...isolatedEnv,PORT:String(port),DATA_DIR:path.join(dir,'data'),EXCEL_FILE:path.join(dir,'input.xlsx')},stdio:['ignore','pipe','pipe']});let output='';proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);let cookie='';
 try{
  let ready=false;for(let i=0;i<240;i++){if(proc.exitCode!=null)throw Error(output);try{const r=await fetch(base+'/api/me');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'server starts: '+output);
  const request=async(p,method='GET',body)=>{const r=await fetch(base+p,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};};
  const initial=await request('/api/records/pisang_penjualan?limit=50');assert.equal(initial.status,401);
  const publicSettings=await request('/api/settings');assert.deepEqual(Object.keys(publicSettings.body),['nama']);assert.equal((await request('/api/log')).status,401);
  const kebun=await request('/api/kebun');assert.equal(kebun.status,401);const summary=await request('/api/kebun-summary');assert.equal(summary.status,200);assert.ok(!JSON.stringify(summary.body).includes('geojson'));assert.ok(!JSON.stringify(summary.body).includes('pembeli'));
  const riceSummary=await request('/api/padi-summary');assert.equal(riceSummary.status,200);assert.ok(Math.abs(riceSummary.body.area-riceSummary.body.plantedHa-riceSummary.body.harvestedHa-riceSummary.body.otherHa)<1e-8);assert.ok(!JSON.stringify(riceSummary.body).includes('geojson'));
  const overview=await request('/api/overview?from=2026-10-01&to=2026-10-24');assert.equal(overview.status,200);assert.equal(overview.body.climate.observations>0,true);assert.ok(JSON.stringify(overview.body).length<80000,'small overview response');
  let r=await request('/api/setup','POST',{username:'test-admin',nama:'Integration test',password:crypto.randomUUID()});assert.equal(r.status,200);
  const beforeSales=await request('/api/t/pisang_penjualan');const salesIDs=beforeSales.body.map(x=>x.id);
  const all=await request('/api/blocks');const old=all.body.find(x=>x.nama==='A01');assert.ok(old);
  const feature=(name,id,parents)=>({type:'Feature',geometry:{type:'Polygon',coordinates:[[[109,-7],[109.001,-7],[109.001,-7.001],[109,-7]]]},properties:{Nama_Blok:name,Lahan:'Pisang',kepemilikan:'Sudah milik kebun',...(id?{blok_id:id}:{}),...(parents?{parent_ids:parents}:{})}});
  let layer={nama:'Blok Kebun Test',jenis:'Blok Tanam',field_nama:'Nama_Blok',tampil:1,warna:'#336644',gaya:'{}',geojson:JSON.stringify({type:'FeatureCollection',features:[feature('A01',old.id)]})};
  const apply=async(layerId,next,mappings={})=>{const p=await request('/api/gis/revision','POST',{layerId,layer:next,mappings});assert.equal(p.status,200);assert.deepEqual(p.body.errors,[]);const a=await request('/api/gis/revision','POST',{mode:'apply',token:p.body.token,layerId,layer:next,mappings});assert.equal(a.status,200,JSON.stringify(a.body));return a.body;};
  let applied=await apply(null,layer);const layerId=applied.id;
  r=await request('/api/daily/locations');assert.ok(r.body.some(x=>x.nama==='A01'&&x.blok_id===old.id));
  r=await request('/api/daily','POST',{tanggal:'2026-10-24',divisi:'Pisang',status:'Selesai',apel_hadir:4,items:[{blok:'A01',aktivitas:'Pemupukan test',realisasi:500,hk_realisasi:4,satuan:'pokok'}]});assert.equal(r.status,200);const reportId=r.body.id;
  const hkResponse=await fetch(base+'/api/daily/hk-summary?from=2026-10-24&to=2026-10-24',{headers:{Origin:'https://vigufarm-web.github.io'}});assert.equal(hkResponse.status,200);assert.equal(hkResponse.headers.get('access-control-allow-origin'),'https://vigufarm-web.github.io');const hkData=await hkResponse.json(),hkPisang=hkData.reports.find(x=>x.divisi==='Pisang');assert.equal(hkPisang.declaredHK,4);assert.equal(hkPisang.activityHK,4);assert.ok(!('mandor' in hkPisang));assert.equal((await fetch(base+'/api/daily/hk-summary?from=2026-10-01&to=2026-12-31')).status,400);
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
  // New grouped workflow preserves selected work date and one HK total per activity.
  const wkGroups=[{key:'bud injection|stem',hk:3,mode:'manual',times:1}];
  r=await request('/api/daily/plans','POST',{workflow_v2:true,week_start:'2002-01-07',divisi:'Pisang',status:'Dikirim',hk_groups:wkGroups,items:[{aktivitas:'Bud injection',satuan:'stem',blok:'ANAK-1',target:100},{aktivitas:'Bud injection',satuan:'stem',blok:'ANAK-2',target:200}]});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(JSON.parse(r.body.hk_kegiatan)[0].hk,3);assert.ok(r.body.items.every(i=>i.hk_rencana===null));
  const otherPlan={workflow_v2:true,week_start:'2002-01-07',divisi:'Pisang',status:'Draf',hk_groups:[{key:'bud injection|stem',hk:1,mode:'manual',times:1}],items:[{aktivitas:'Bud injection',satuan:'stem',blok:'ANAK-1',target:1}]};
  r=await request('/api/daily/plans','POST',otherPlan);assert.equal(r.status,409,'a new weekly form cannot silently replace the saved plan of that week');assert.match(r.body.error,/sudah ada/);
  r=await request('/api/daily/plans','POST',{...otherPlan,week_start:'2002-01-14'});assert.equal(r.status,200,JSON.stringify(r.body));
  r=await request('/api/daily/plans','POST',{...otherPlan,id:r.body.id});assert.equal(r.status,409,'a plan cannot be moved onto a week that already has one');
  const groupReport={workflow_v2:true,tanggal:'2002-01-08',divisi:'Pisang',status:'Selesai',apel_hadir:2,hk_groups:[{key:'bud injection|stem',hk:2,manual:false}],items:[{aktivitas:'Bud injection',satuan:'stem',blok:'ANAK-1',realisasi:20},{aktivitas:'Bud injection',satuan:'stem',blok:'ANAK-2',realisasi:60}]};
  r=await request('/api/daily','POST',groupReport);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.tanggal,'2002-01-08');assert.deepEqual(r.body.items.map(i=>i.hk_realisasi),[.5,1.5]);assert.equal(JSON.parse(r.body.hk_kegiatan_rencana)[0].hk,3);
  const groupedId=r.body.id,firstGroupVersion=r.body.updated_at;
  r=await request('/api/daily','POST',{...groupReport,id:groupedId,updated_at:firstGroupVersion});assert.equal(r.status,200);assert.equal(r.body.id,groupedId);const currentGroup=r.body;
  r=await request('/api/daily','POST',{...groupReport,id:groupedId,updated_at:'2000-01-01T00:00:00.000Z',items:[{...groupReport.items[0],realisasi:999}]});assert.equal(r.status,409);
  r=await request('/api/daily','POST',groupReport);assert.equal(r.status,409,'a new form cannot implicitly replace an existing report');
  // Routine work chosen by the foreman may be planned without a target; the report still records its result.
  const infraRoutine={workflow_v2:true,week_start:'2002-01-07',divisi:'Infra',status:'Dikirim',hk_groups:[{key:'pengiriman air|rit',hk:2,mode:'manual',times:5,jenis:'rutin'}],items:[{aktivitas:'Pengiriman air',satuan:'rit',blok:'ANAK-1',target:''}]};
  r=await request('/api/daily/plans','POST',{...infraRoutine,hk_groups:[{...infraRoutine.hk_groups[0],jenis:'target'}]});assert.equal(r.status,400,'target work still needs a target');
  r=await request('/api/daily/plans','POST',infraRoutine);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items[0].target,null);assert.equal(JSON.parse(r.body.hk_kegiatan)[0].jenis,'rutin');
  r=await request('/api/daily','POST',{workflow_v2:true,tanggal:'2002-01-08',divisi:'Infra',status:'Selesai',apel_hadir:2,hk_groups:[{key:'pengiriman air|rit',hk:2,manual:false}],items:[{aktivitas:'Pengiriman air',satuan:'rit',blok:'ANAK-1',realisasi:6}]});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items[0].target,null);assert.equal(r.body.items[0].realisasi,6);
  r=await request('/api/daily','POST',{...groupReport,id:9999999,updated_at:currentGroup.updated_at});assert.equal(r.status,404);
  r=await request('/api/daily?from=2002-01-08&to=2002-01-08&divisi=Pisang');assert.deepEqual(r.body.find(x=>x.id===groupedId).items.map(x=>x.realisasi),[20,60],'rejected saves preserve the current report');
  r=await request('/api/daily','POST',{...groupReport,id:groupedId,updated_at:currentGroup.updated_at,hk_groups:[{key:'bud injection|stem',hk:-1}]});assert.equal(r.status,400);
  // Existing historical locations remain editable, while new unowned locations stay blocked.
  r=await request('/api/daily','POST',{id:reportId,tanggal:report.tanggal,divisi:report.divisi,status:'Selesai',items:report.items});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items[0].realisasi,500);
  r=await request('/api/daily','POST',{tanggal:'2026-10-26',divisi:'Pisang',status:'Draf',items:[{blok:'ANAK-1',aktivitas:'Belum ada hasil',satuan:'ha',hk_realisasi:1}]});assert.equal(r.status,200);assert.equal(r.body.items[0].realisasi,null);assert.equal(r.body.items[0].hasil_sdhi,null);assert.equal(r.body.items[0].target,null);
  // Explicit historical transfer is previewed, version checked, and idempotent.
  r=await request('/api/daily?from=2026-10-24&to=2026-10-24');const transferReport=r.body.find(x=>x.id===reportId);
  const transferBody={reports:[transferReport,{tanggal:'2001-01-01',divisi:'Pisang',status:'Selesai',items:[{aktivitas:'Riwayat lama',blok:'LOKASI-HISTORIS',realisasi:2,satuan:'ha',hk_realisasi:1}]}]};
  r=await request('/api/daily/transfer','POST',transferBody);assert.equal(r.status,200);assert.equal(r.body.preview.length,2);const transferToken=r.body.token;
  r=await request('/api/daily/transfer','POST',{...transferBody,mode:'apply',token:'stale'});assert.equal(r.status,409);
  r=await request('/api/daily/transfer','POST',{...transferBody,mode:'apply',token:transferToken});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.reports.find(x=>x.key==='2026-10-24|Pisang').id,reportId);
  r=await request('/api/daily/transfer','POST',{...transferBody,mode:'apply',token:transferToken});assert.equal(r.status,200);assert.equal(r.body.already_applied,true);
  r=await request('/api/daily/locations');assert.ok(!r.body.some(x=>x.nama==='LOKASI-HISTORIS'));
  r=await request('/api/daily','POST',{tanggal:'2999-01-01',divisi:'Pisang',status:'Draf',items:[{blok:'ANAK-1',aktivitas:'Foto retry',realisasi:1,satuan:'ha',hk_realisasi:1}]});assert.equal(r.status,200);const retryReportId=r.body.id;
  const uploadFixture=async()=>{const response=await fetch(base+'/api/daily/photo?report='+retryReportId,{method:'POST',headers:{cookie,'Content-Type':'image/webp'},body:Buffer.from('RIFF-test-WEBP')});assert.equal(response.status,200);return response.json();};
  const firstPhoto=await uploadFixture(),secondPhoto=await uploadFixture();assert.equal(firstPhoto.id,secondPhoto.id,'retry does not duplicate the stored original');
  const publicInfra=await request('/api/daily','POST',{tanggal:'2026-10-22',divisi:'Infra',status:'Selesai',items:[{blok:'ANAK-1',aktivitas:'Pembuatan parit tanpa foto',realisasi:237,satuan:'meter',hk_realisasi:2}]});assert.equal(publicInfra.status,200);
  const publicRead=await fetch(base+'/api/daily/public?from=2026-10-19&to=2026-10-24');assert.equal(publicRead.status,200);const publicData=await publicRead.json(),infra=publicData.reports.find(x=>x.id===publicInfra.body.id);assert.equal(infra.items[0].realisasi,237);assert.equal(infra.photos.length,0);assert.ok(!JSON.stringify(publicData).includes('lokasi'));assert.ok(!publicData.reports.some(r=>r.id===retryReportId));
  assert.equal((await fetch(base+'/api/daily/public/photo/'+firstPhoto.id)).status,404,'draft photograph stays private');
  assert.equal((await fetch(base+'/api/daily/public',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  const publicPeriods=await (await fetch(base+'/api/summary-periods')).json();assert.deepEqual(publicPeriods.periods.map(p=>p.key),['week','month','year','lastYear','all']);
  assert.equal((await fetch(base+'/api/kebun-plan')).status,200);
  // Expired originals and thumbnails are removed; text and quantities survive.
  const photoDir=path.join(dir,'data','daily-photos');fs.mkdirSync(photoDir,{recursive:true});
  fs.writeFileSync(path.join(photoDir,'expired.webp'),'test original');fs.writeFileSync(path.join(photoDir,'expired-thumb.webp'),'test thumbnail');
  const fixture=new DatabaseSync(path.join(dir,'data','kebun.db'));
  const publicImage=await sharp({create:{width:20,height:20,channels:3,background:'#24563D'}}).jpeg().toBuffer();fs.writeFileSync(path.join(photoDir,'public.jpg'),publicImage);const publishedPhotoId=Number(fixture.prepare('INSERT INTO daily_photo(report_id,storage,lokasi,mime,expires_at) VALUES(?,?,?,?,?)').run(reportId,'local','public.jpg','image/jpeg','2999-01-01T00:00:00Z').lastInsertRowid);
  const expiredId=Number(fixture.prepare('INSERT INTO daily_photo(created_at,updated_at,report_id,storage,lokasi,thumb_storage,thumb_lokasi,mime,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run('2000-01-01','2000-01-01',reportId,'local','expired.webp','local','expired-thumb.webp','image/webp','2000-01-08T00:00:00.000Z').lastInsertRowid);fixture.close();
  const publicPhoto=await fetch(base+'/api/daily/public/photo/'+publishedPhotoId);assert.equal(publicPhoto.status,200);assert.deepEqual(Buffer.from(await publicPhoto.arrayBuffer()),publicImage);
  assert.equal((await fetch(base+'/api/daily/photo/'+expiredId,{headers:{cookie}})).status,404);assert.equal((await fetch(base+'/api/daily/public/photo/'+expiredId)).status,404);
  r=await request('/api/daily/cleanup');assert.equal(r.status,200);assert.ok(r.body.deleted>=1);
  assert.equal(fs.existsSync(path.join(photoDir,'expired.webp')),false);assert.equal(fs.existsSync(path.join(photoDir,'expired-thumb.webp')),false);
  r=await request('/api/daily?from=2026-10-24&to=2026-10-24');assert.equal(r.body.find(x=>x.id===reportId).items[0].realisasi,500);assert.ok(r.body.find(x=>x.id===reportId).photos.find(x=>x.id===expiredId).deleted_at);
  // No history is removed when a spreadsheet omits its rows.
  const downloaded=await fetch(base+'/api/excel/download?tables=pisang_penjualan&panel=Test',{headers:{cookie}});assert.equal(downloaded.status,200);const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await downloaded.arrayBuffer()));const ws=wb.worksheets.find(x=>x.name!=='Petunjuk'&&x.name!=='_daftar');assert.ok(ws);assert.equal(ws.getCell('C2').fill.fgColor.argb,'FFFFF7D6');assert.equal(ws.getCell('C100').fill.fgColor.argb,'FFFFF7D6');assert.notEqual(ws.getCell('A2').fill?.fgColor?.argb,'FFFFF7D6');assert.notEqual(ws.getCell('B2').fill?.fgColor?.argb,'FFFFF7D6');assert.notEqual(wb.getWorksheet('Ringkasan Input').getCell('C2').fill?.fgColor?.argb,'FFFFF7D6');ws.spliceRows(3,ws.rowCount-2);
  const upload=async(bytes,preview=false)=>{const response=await fetch(base+'/api/excel/upload?tables=pisang_penjualan&panel=Test'+(preview?'&preview=1':''),{method:'POST',headers:{cookie,'Content-Type':'application/octet-stream'},body:bytes});return {status:response.status,body:await response.json()};};
  let bytes=Buffer.from(await wb.xlsx.writeBuffer());r=await upload(bytes);assert.equal(r.status,200,JSON.stringify(r.body));let after=await request('/api/t/pisang_penjualan');assert.deepEqual(after.body.map(x=>x.id),salesIDs,'omitted sales retain IDs and values');
  const headers=ws.getRow(1).values;const amountColumn=headers.findIndex(x=>String(x||'').replace(/\*/g,'').trim()==='Sudah Dibayar (Rp)');assert.ok(amountColumn>0);const id=Number(ws.getCell(2,1).value);ws.getCell(2,amountColumn).value=12345;bytes=Buffer.from(await wb.xlsx.writeBuffer());r=await upload(bytes);assert.equal(r.status,200);after=await request('/api/t/pisang_penjualan');assert.equal(after.body.find(x=>x.id===id).dibayar,12345);assert.equal(after.body.length,909);
  r=await upload(bytes,true);assert.ok(r.body.sheets.some(x=>x.jumlahError>0),'stale Excel updates are rejected');
  // PDF permission checks and production PDF generation.
  await request('/api/settings','PUT',{nama:'VIGU FARM - CONTOH DATA UJI'});
  for(const kind of ['daily','owner']){const response=await fetch(base+'/api/reports/'+kind+'.pdf?'+(kind==='daily'?'from=2026-10-24&to=2026-10-24&divisi=Pisang':'from=2026-10-01&to=2026-10-24'),{headers:{cookie}});assert.equal(response.status,200,response.status!==200?await response.text():'');assert.equal(response.headers.get('content-type'),'application/pdf');const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1000);if(process.env.WRITE_PDF_SAMPLES==='1')fs.writeFileSync(path.resolve(root,'..','contoh-laporan-'+kind+'.pdf'),bytes);}
  r=await request('/api/reports/owner-summary?week=2026-10-24');assert.equal(r.status,200);assert.equal(r.body.from,'2026-10-19');assert.equal(r.body.to,'2026-10-25');assert.ok(r.body.photos.length<=21);for(const day of new Set(r.body.photos.map(p=>p.date)))assert.ok(r.body.photos.filter(p=>p.date===day).length<=3);assert.ok(r.body.sections.every(s=>!s.headers.includes('Tanggal')));
  const adminCookie=cookie,mandorPass=crypto.randomUUID();r=await request('/api/users','POST',{username:'mandor-test',nama:'Mandor test',password:mandorPass,peran:['daily_pisang']});assert.equal(r.status,200);
  r=await request('/api/login','POST',{username:'mandor-test',password:mandorPass});assert.equal(r.status,200);
  let response=await fetch(base+'/api/reports/owner.pdf?from=2026-10-01&to=2026-10-24',{headers:{cookie}});assert.equal(response.status,403);assert.equal((await request('/api/reports/owner-summary?week=2026-10-24')).status,403);
  response=await fetch(base+'/api/reports/daily.pdf?from=2026-10-01&to=2026-10-24&divisi=Padi',{headers:{cookie}});assert.equal(response.status,403);
  response=await fetch(base+'/api/reports/daily.pdf?from=2026-10-01&to=2026-10-24&divisi=Pisang',{headers:{cookie}});assert.equal(response.status,200);
  r=await request('/api/overview');assert.equal(r.status,200,'foremen can read the same aggregate summary as public visitors');
  r=await request('/api/daily/transfer','POST',{reports:[transferReport]});assert.equal(r.status,403);
  r=await request('/api/reports/share?from=2026-10-24&to=2026-10-24&divisi=Pisang');assert.equal(r.status,200);assert.ok(r.body.text.includes('Pemupukan test'));assert.ok(!r.body.text.includes('/ Padi /'));
  response=await fetch(base+'/api/reports/daily.pdf');assert.equal(response.status,401);
  cookie=adminCookie;
  const weeklyPDF=await fetch(base+'/api/reports/owner.pdf?from=2026-10-01&to=2026-10-24',{headers:{cookie}});assert.equal(weeklyPDF.status,200);assert.ok(weeklyPDF.headers.get('content-disposition').includes('2026-10-19-2026-10-25'));assert.equal(Buffer.from(await weeklyPDF.arrayBuffer()).subarray(0,4).toString(),'%PDF');
  r=await request('/api/t/padi_penjualan','POST',{tanggal:'2026-10-22',pembeli:'PH UJI',tipe:'Mutasi Internal',jenis:'GKG',berat_kg:123.45});assert.equal(r.status,200);const hiddenRiceId=r.body.id;
  // Full accountability workbook: admin and the "Unduh Laporan Lengkap" role only; that role cannot read or change raw data.
  let full=await fetch(base+'/api/reports/lengkap.xlsx?from=2026-10-01&to=2026-10-31',{headers:{cookie}});assert.equal(full.status,200,full.status!==200?await full.text():'');
  const fullBook=new ExcelJS.Workbook();await fullBook.xlsx.load(Buffer.from(await full.arrayBuffer()));
  for(const name of ['Ringkasan','Daftar Lahan','Rencana Tanam Pisang','Kegiatan Harian','Penjualan Pisang','Panen Padi','Iklim Harian'])assert.ok(fullBook.getWorksheet(name),name);
  const fullSummary=fullBook.getWorksheet('Ringkasan'),valueOf=label=>{let v;fullSummary.eachRow(row=>{if(row.getCell(1).value===label&&v===undefined)v=row.getCell(2).value;});return v;};
  const sameOverview=(await request('/api/overview?from=2026-10-01&to=2026-10-31')).body,samePlan=(await request('/api/kebun-plan')).body,samePadi=(await request('/api/padi-summary')).body;
  assert.equal(valueOf('Total luas blok Pisang'),samePlan.banana.area,'same planted-area basis as the dashboard');assert.equal(valueOf('Sudah tertanam'),samePlan.banana.plantedHa);assert.equal(valueOf('Total luas petak Padi'),samePadi.area);
  assert.equal(valueOf('Penjualan'),sameOverview.pisang.sales.revenue,'same banana sales as the dashboard for the period');for(const [sheet,revenue] of [['Penjualan Pisang',sameOverview.pisang.sales.revenue],['Penjualan Padi',sameOverview.padi.sales.revenue]]){const ws=fullBook.getWorksheet(sheet),col=ws.getRow(5).values.indexOf('Total (Rp)');let row;ws.eachRow(x=>{if(x.getCell(1).value==='TOTAL PENJUALAN (sama dengan Ringkasan)')row=x;});assert.ok(row,sheet);assert.ok(Math.abs(row.getCell(col).value-revenue)<0.01,sheet+' detail total equals the summary');}
  assert.equal((await fetch(base+'/api/reports/lengkap.xlsx?from=2026-10-31&to=2026-10-01',{headers:{cookie}})).status,400);
  const reportPass=crypto.randomUUID();r=await request('/api/users','POST',{username:'laporan-test',nama:'Laporan test',password:reportPass,peran:['unduh_laporan']});assert.equal(r.status,200);
  r=await request('/api/login','POST',{username:'laporan-test',password:reportPass});assert.equal(r.status,200);
  full=await fetch(base+'/api/reports/lengkap.xlsx?from=2026-10-01&to=2026-10-31',{headers:{cookie}});assert.equal(full.status,200,'admin-granted download role');
  assert.equal((await request('/api/t/pisang_penjualan')).status,403,'download role cannot read raw input');assert.equal((await request('/api/t/pisang_penjualan','POST',{tanggal:'2026-10-22'})).status,403,'download role cannot change data');
  r=await request('/api/login','POST',{username:'mandor-test',password:mandorPass});assert.equal(r.status,200);
  assert.equal((await fetch(base+'/api/reports/lengkap.xlsx',{headers:{cookie}})).status,403,'foremen cannot download the full report');
  assert.equal((await fetch(base+'/api/reports/lengkap.xlsx')).status,401);
  cookie=adminCookie;
  // Assigned input roles can import only their sheets, without becoming admins.
  const salesPass=crypto.randomUUID();r=await request('/api/users','POST',{username:'sales-role-test',nama:'Sales role test',password:salesPass,peran:['penjualan']});assert.equal(r.status,200);
  r=await request('/api/login','POST',{username:'sales-role-test',password:salesPass});assert.equal(r.status,200);
  r=await request('/api/excel/status');assert.equal(r.status,200);assert.deepEqual(r.body.tables.sort(),['padi_penjualan','pisang_penjualan']);assert.equal(r.body.laporan,null);assert.equal(r.body.file,undefined);
  let roleDownload=await fetch(base+'/api/excel/download',{headers:{cookie}});assert.equal(roleDownload.status,200);
  const roleBook=new ExcelJS.Workbook();await roleBook.xlsx.load(Buffer.from(await roleDownload.arrayBuffer()));
  assert.deepEqual(roleBook.worksheets.filter(w=>!['Petunjuk','_daftar','Ringkasan Input'].includes(w.name)).map(w=>w.name).sort(),['Padi - Penjualan Beras','Pisang - Penjualan']);
  assert.equal((await fetch(base+'/api/excel/download?tables=iklim',{headers:{cookie}})).status,403);
  assert.equal((await fetch(base+'/api/excel/upload?tables=pisang_penjualan,iklim',{method:'POST',headers:{cookie},body:Buffer.from(await roleBook.xlsx.writeBuffer())})).status,403);
  assert.ok(roleBook.getWorksheet('Ringkasan Input'));
  const riceSheet=roleBook.getWorksheet('Padi - Penjualan Beras');assert.ok(!riceSheet.getColumn(1).values.includes(hiddenRiceId),'process transfer hidden from sales workbook');
  const inputStats=await request('/api/excel/summary');assert.equal(inputStats.status,200);assert.deepEqual(inputStats.body.tables.map(t=>t.table).sort(),['padi_penjualan','pisang_penjualan']);
  const roleSheet=roleBook.getWorksheet('Pisang - Penjualan');roleSheet.getCell(2,amountColumn).value=12346;
  const roleBytes=Buffer.from(await roleBook.xlsx.writeBuffer());
  for(const preview of [true,false]){const rr=await fetch(base+'/api/excel/upload'+(preview?'?preview=1':''),{method:'POST',headers:{cookie,'Content-Type':'application/octet-stream'},body:roleBytes});assert.equal(rr.status,200,await rr.text());}
  assert.equal((await request('/api/t/iklim')).status,403);assert.equal((await request('/api/users')).status,403);
  cookie=adminCookie;assert.ok((await request('/api/t/padi_penjualan')).body.some(r=>r.id===hiddenRiceId&&r.berat_kg===123.45),'hidden transfer survives reupload');after=await request('/api/t/pisang_penjualan');assert.equal(after.body.find(x=>x.id===id).dibayar,12346);
  r=await request('/api/t/pisang_penjualan/'+id,'PUT',{...after.body.find(x=>x.id===id),dibayar:12345});assert.equal(r.status,200);
  // Regression: move an existing Excel transaction between blocks, keeping its row ID.
  r=await request('/api/t/lahan_harian','POST',{tanggal:'2004-02-03',aktivitas:'Bajak 2',blok:'ANAK-1',hasil_ha:.01});assert.equal(r.status,200,JSON.stringify(r.body));const moveId=r.body.id;
  const moveDownload=await fetch(base+'/api/excel/download?tables=lahan_harian&panel=Test',{headers:{cookie}}),moveBook=new ExcelJS.Workbook();await moveBook.xlsx.load(Buffer.from(await moveDownload.arrayBuffer()));
  const moveSheet=moveBook.getWorksheet('Progres - Harian'),moveValues=[];moveSheet.eachRow((row,n)=>{if(n>1&&Number(row.getCell(1).value)===moveId)moveValues.push([...row.values]);});assert.equal(moveValues.length,1);
  const singleMoveBook=new ExcelJS.Workbook(),singleMoveSheet=singleMoveBook.addWorksheet('Progres - Harian');singleMoveSheet.addRow(moveSheet.getRow(1).values.slice(1));singleMoveSheet.addRow(moveValues[0].slice(1));const blockColumn=moveSheet.getRow(1).values.findIndex(v=>String(v).replace('*','').trim()==='Blok');singleMoveSheet.getCell(2,blockColumn).value='ANAK-2';
  const moveBytes=Buffer.from(await singleMoveBook.xlsx.writeBuffer());
  const moveUpload=async preview=>{const res=await fetch(base+'/api/excel/upload?tables=lahan_harian&panel=Test'+(preview?'&preview=1':''),{method:'POST',headers:{cookie,'Content-Type':'application/octet-stream'},body:moveBytes});return {status:res.status,body:await res.json()};};
  let moved=await moveUpload(true);assert.equal(moved.status,200);assert.equal(moved.body.sheets[0].ubah,1,JSON.stringify(moved.body));assert.ok(moved.body.sheets[0].changes.some(c=>c.before==='ANAK-1'&&c.after==='ANAK-2'));
  moved=await moveUpload(false);assert.equal(moved.body.sheets[0].ubah,1,JSON.stringify(moved.body));
  const movedRow=(await request('/api/t/lahan_harian')).body.find(x=>x.id===moveId);assert.equal(movedRow.blok,'ANAK-2');assert.equal(movedRow.block_id,'test-child-2');assert.equal(movedRow.block_name_snapshot,'ANAK-2');assert.equal(movedRow.hasil_ha,.01);
  // Regression: a real save of 230 plan rows, stable IDs, and stale revision rejection.
  const bigItems=Array.from({length:230},(_,i)=>({blok:'ANAK-1',aktivitas:'Uji rencana '+i,satuan:'stem',target:100}));
  const bigBody={workflow_v2:true,week_start:'2003-01-06',divisi:'Pisang',status:'Dikirim',items:bigItems,hk_groups:bigItems.map(i=>({key:i.aktivitas.toLowerCase()+'|stem',hk:0,mode:'manual',times:1}))};
  r=await request('/api/daily/plans','POST',bigBody);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items.length,230);const bigPlan=r.body;
  r=await request('/api/daily/plans','POST',{...bigBody,id:bigPlan.id,updated_at:bigPlan.updated_at,items:bigPlan.items.map((i,n)=>({...i,target:n===0?111:100}))});assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body.items.map(i=>i.id),bigPlan.items.map(i=>i.id));assert.equal(r.body.items[0].target,111);
  r=await request('/api/daily/plans','POST',{...bigBody,id:bigPlan.id,updated_at:bigPlan.updated_at});assert.equal(r.status,409);
  // Regression: retry exactly the same daily submission after a lost response.
  const manyActual=bigItems.slice(0,130).map(i=>({...i,realisasi:1})),retryBody={workflow_v2:true,request_key:crypto.randomUUID(),tanggal:'2003-01-07',divisi:'Pisang',status:'Selesai',apel_hadir:130,items:manyActual,hk_groups:manyActual.map(i=>({key:i.aktivitas.toLowerCase()+'|stem',hk:1,manual:false}))};
  r=await request('/api/daily','POST',retryBody);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items.length,130);const retrySaved=r.body;
  r=await request('/api/daily','POST',retryBody);assert.equal(r.status,200);assert.deepEqual(r.body,retrySaved);
  r=await request('/api/daily','POST',{...retryBody,apel_hadir:999});assert.equal(r.status,409);
  assert.equal((await request('/api/daily?from=2003-01-07&to=2003-01-07')).body.length,1);

  // Ecer Pupuk remains a normal Daily input, but is absent from admin progress/export.
  const dailyFertilizer={workflow_v2:true,tanggal:'2005-01-04',divisi:'Pisang',status:'Selesai',apel_hadir:1,hk_groups:[{key:'ecer pupuk|ha',hk:1,manual:false}],items:[{aktivitas:'Ecer Pupuk',satuan:'ha',blok:'ANAK-1',realisasi:.01}]};
  r=await request('/api/daily','POST',dailyFertilizer);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items[0].aktivitas,'Ecer Pupuk');const fertilizerSaved=r.body;
  r=await request('/api/daily','POST',{...dailyFertilizer,id:fertilizerSaved.id,updated_at:fertilizerSaved.updated_at,kendala:'Catatan revisi'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items[0].aktivitas,'Ecer Pupuk');
  assert.ok(!(await request('/api/t/lahan_harian')).body.some(row=>row.aktivitas==='Ecer Pupuk'));
  const fertilizerWorkbook=await fetch(base+'/api/excel/download?tables=lahan_harian&panel=Test',{headers:{cookie}}),fertilizerBook=new ExcelJS.Workbook();await fertilizerBook.xlsx.load(Buffer.from(await fertilizerWorkbook.arrayBuffer()));assert.ok(!JSON.stringify(fertilizerBook.getWorksheet('Progres - Harian').getSheetValues()).includes('Ecer Pupuk'));
  const progressAfter=(await request('/api/kebun-summary')).body;assert.ok(!progressAfter.stages.includes('Ecer Pupuk'));assert.ok(!progressAfter.weekly.some(a=>a.name==='Ecer Pupuk'));
  // A second start reruns migration against existing data without losing IDs or results.
  const exit=once(proc,'exit');proc.kill();await exit;
  proc=spawn(process.execPath,['server.js'],{cwd:root,env:{...isolatedEnv,PORT:String(port),DATA_DIR:path.join(dir,'data'),EXCEL_FILE:path.join(dir,'input.xlsx')},stdio:['ignore','pipe','pipe']});proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);
  let restarted=false;for(let i=0;i<240;i++){if(proc.exitCode!=null)throw Error(output);try{if((await fetch(base+'/api/me')).ok){restarted=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(restarted);
  r=await request('/api/blocks');assert.equal(r.body.find(x=>x.id===old.id).nama,'A01-REVISI');assert.equal(r.body.find(x=>x.id===old.id).active,0);
  r=await request('/api/daily?from=2026-10-24&to=2026-10-24');assert.equal(r.body.find(x=>x.id===reportId).items[0].realisasi,500);assert.equal(r.body.find(x=>x.id===reportId).items[0].block_name_snapshot,'A01');
  r=await request('/api/t/pisang_penjualan');assert.deepEqual(r.body.map(x=>x.id),salesIDs);assert.equal(r.body.find(x=>x.id===id).dibayar,12345);
  console.log('Verified: stable block ID, rename keeps completed quantities, split ancestry, ownership exclusion, 50-row pagination, small overview, Excel no deletion, stable row IDs and stale-file protection.');
 }finally{proc.kill();}
});
