import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const dir=await mkdtemp(join(tmpdir(),'vigu-input-client-test-'));
const child=spawn(process.execPath,['server.js'],{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PORT:String(port),DATA_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
let serverLogs='';for(const stream of [child.stdout,child.stderr])stream.on('data',part=>serverLogs+=part);
const base='http://127.0.0.1:'+port, origin='https://vigufarm-web.github.io';
const pw=crypto.randomUUID(), pw2=crypto.randomUUID();let cookie='';
async function request(path,{method='GET',body,token,originHeader,cookieHeader}={}){
  const headers={'Content-Type':'application/json'};
  if(originHeader)headers.Origin=originHeader;
  if(token)headers.Authorization='Bearer '+token;
  if(cookieHeader)headers.Cookie=cookieHeader;
  const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return response;
}
try{
  for(let i=0;i<300;i++){if(child.exitCode!==null)throw Error('Backend uji berhenti: '+serverLogs);try{if((await request('/api/me')).ok)break;}catch{}if(i===299)throw Error('Backend tidak siap: '+serverLogs);await new Promise(r=>setTimeout(r,200));}
  assert.equal((await request('/api/setup',{method:'POST',body:{username:'admin-uji',password:pw,nama:'Admin'}})).status,200);
  assert.equal((await request('/api/users',{method:'POST',cookieHeader:cookie,body:{username:'sales-uji',password:pw,nama:'Sales',peran:['penjualan']}})).status,200);
  assert.equal((await request('/api/users',{method:'POST',cookieHeader:cookie,body:{username:'mandor-uji',password:pw,nama:'Mandor',peran:['daily_padi','penjualan']}})).status,200);
  assert.equal((await request('/api/users',{method:'POST',cookieHeader:cookie,body:{username:'iklim-uji',password:pw,nama:'Iklim',peran:['iklim']}})).status,200);
  for(const [name,role] of [['pisang-uji','panen_pisang'],['padi-uji','panen_padi'],['lahan-uji','lahan']])assert.equal((await request('/api/users',{method:'POST',cookieHeader:cookie,body:{username:name,password:pw,nama:name,peran:[role]}})).status,200);
  assert.equal((await request('/api/input-client/login',{method:'OPTIONS',originHeader:origin})).headers.get('access-control-allow-origin'),origin);
  assert.equal((await request('/api/input-client/login',{method:'POST',originHeader:'https://attacker.example',body:{username:'sales-uji',password:pw}})).status,403);
  assert.equal((await request('/api/input-client/login',{method:'POST',originHeader:origin,body:{username:'mandor-uji',password:pw}})).status,403);
  const staffLogin=await request('/api/input-client/login',{method:'POST',originHeader:origin,body:{username:'iklim-uji',password:pw}});
  assert.equal(staffLogin.status,200);const staffToken=(await staffLogin.json()).token;
  assert.equal((await request('/api/input-client/records/iklim',{originHeader:origin,token:staffToken})).status,200);
  assert.equal((await request('/api/input-client/records/pisang_penjualan',{originHeader:origin,token:staffToken})).status,403);
  assert.equal((await request('/api/input-client/t/pisang_penjualan',{method:'POST',originHeader:origin,token:staffToken,body:{tanggal:'2026-11-03'}})).status,403);
  assert.equal((await request('/api/input-client/users',{originHeader:origin,token:staffToken})).status,403);
  assert.equal((await request('/api/input-client/daily/locations',{originHeader:origin,token:staffToken})).status,403);
  for(const [name,allowed,denied] of [['pisang-uji','pisang_box','padi_panen'],['padi-uji','padi_panen','pisang_box'],['lahan-uji','lahan_harian','pisang_penjualan']]){
    const login=await request('/api/input-client/login',{method:'POST',originHeader:origin,body:{username:name,password:pw}});
    assert.equal(login.status,200,name);const roleToken=(await login.json()).token;
    assert.equal((await request('/api/input-client/records/'+allowed,{originHeader:origin,token:roleToken})).status,200,name+' permitted');
    assert.equal((await request('/api/input-client/records/'+denied,{originHeader:origin,token:roleToken})).status,403,name+' denied');
    assert.equal((await request('/api/input-client/records/pisang_penjualan',{originHeader:origin,token:roleToken})).status,403,name+' sales denied');
    assert.equal((await request('/api/input-client/daily/locations',{originHeader:origin,token:roleToken})).status,200,name+' GIS locations');
    if(name==='lahan-uji'){
      assert.equal((await request('/api/input-client/t/lahan_aktivitas',{originHeader:origin,token:roleToken})).status,200);
      for (const table of ['lahan_target','lahan_rencana']) assert.equal((await request('/api/input-client/records/'+table,{originHeader:origin,token:roleToken})).status,200,table+' staff access');
    }
  }
  const adminLogin=await request('/api/input-client/login',{method:'POST',originHeader:origin,body:{username:'admin-uji',password:pw}});
  assert.equal(adminLogin.status,200);const adminToken=(await adminLogin.json()).token;
  const blocks=await (await request('/api/blocks',{cookieHeader:cookie})).json();
  const block=blocks.find(b=>b.nama==='A01');assert.ok(block);
  const feature={type:'Feature',geometry:{type:'Polygon',coordinates:[[[109,-7],[109.001,-7],[109.001,-7.001],[109,-7]]]},properties:{Nama_Blok:'A01',Lahan:'Pisang',kepemilikan:'Sudah milik kebun',blok_id:block.id}};
  const riceFeature={type:'Feature',geometry:{type:'Polygon',coordinates:[[[109.01,-7],[109.011,-7],[109.011,-7.001],[109.01,-7]]]},properties:{Nama_Blok:'P01',Lahan:'Padi',kepemilikan:'Sudah milik kebun'}};
  const layer={nama:'Blok Uji',jenis:'Blok Tanam',field_nama:'Nama_Blok',tampil:1,warna:'#336644',gaya:'{}',geojson:JSON.stringify({type:'FeatureCollection',features:[feature,riceFeature]})};
  const preview=await request('/api/gis/revision',{method:'POST',cookieHeader:cookie,body:{layerId:null,layer,mappings:{}}});assert.equal(preview.status,200);
  const proposal=await preview.json();assert.deepEqual(proposal.errors,[]);
  const applied=await request('/api/gis/revision',{method:'POST',cookieHeader:cookie,body:{mode:'apply',token:proposal.token,layerId:null,layer,mappings:{}}});assert.equal(applied.status,200,await applied.clone().text());
  const landLogin=await request('/api/input-client/login',{method:'POST',originHeader:origin,body:{username:'lahan-uji',password:pw}});
  const landToken=(await landLogin.json()).token;
  const daily=await request('/api/daily',{method:'POST',cookieHeader:cookie,body:{tanggal:'2038-11-07',divisi:'Pisang',status:'Selesai',items:[{aktivitas:'Bajak 1',blok:'A01',satuan:'ha',realisasi:0.05}]}});
  assert.equal(daily.status,200,await daily.clone().text());const dailyId=(await daily.json()).id;
  const allLand=(await (await request('/api/records/lahan_harian?limit=100',{cookieHeader:cookie})).json()).rows;
  const dailyLand=allLand.find(row=>row.daily_report_id===dailyId);assert.ok(dailyLand,'daily stays linked to report');
  const onlyInput=await (await request('/api/input-client/records/lahan_harian?limit=100',{originHeader:origin,token:landToken})).json();
  assert.ok(!onlyInput.rows.some(row=>row.daily_report_id===dailyId),'daily does not appear in input');
  assert.equal((await request('/api/input-client/t/lahan_harian/'+dailyLand.id,{method:'PUT',originHeader:origin,token:landToken,body:{updated_at:dailyLand.updated_at,keterangan:'ubah'}})).status,409);
  assert.equal((await request('/api/input-client/t/lahan_harian/'+dailyLand.id+'?updated_at='+encodeURIComponent(dailyLand.updated_at),{method:'DELETE',originHeader:origin,token:landToken})).status,409);
  for(const [table,payload] of [
    ['lahan_target',{blok:'A01',bulan:'2038-12-01',mulai_persiapan:'2038-11-01',prioritas:3}],
    ['lahan_rencana',{blok:'A01',aktivitas:'Bajak 1',luas_ha:0.2,mulai:'2038-11-01',selesai:'2038-11-05'}],
  ]){
    const added=await request('/api/input-client/t/'+table,{method:'POST',originHeader:origin,token:landToken,body:payload});
    assert.equal(added.status,200,table+' add: '+await added.clone().text());
    const id=(await added.json()).id;
    const list=await (await request('/api/input-client/records/'+table+'?limit=100&summary=1',{originHeader:origin,token:landToken})).json();
    assert.ok(list.summary?.rows.length,table+' summary');
    const saved=list.rows.find(row=>row.id===id);assert.ok(saved?.updated_at,table+' version');
    if(table==='lahan_target'){
      const duplicate=await request('/api/input-client/t/'+table,{method:'POST',originHeader:origin,token:landToken,body:{...payload,bulan:'2039-01-01'}});
      assert.equal(duplicate.status,409,'reject a second target for the same GIS block');
      assert.match((await duplicate.json()).error,/sudah ada/i);
      assert.equal((await request('/api/input-client/t/'+table,{method:'POST',originHeader:origin,token:landToken,body:[payload,payload]})).status,400,'reject duplicate target batches');
    }
    const edit={keterangan:'Revisi uji',updated_at:saved.updated_at};
    assert.equal((await request('/api/input-client/t/'+table+'/'+id,{method:'PUT',originHeader:origin,token:landToken,body:edit})).status,200,table+' edit');
    assert.equal((await request('/api/input-client/t/'+table+'/'+id,{method:'PUT',originHeader:origin,token:landToken,body:edit})).status,409,table+' stale edit');
    assert.equal((await request('/api/input-client/excel/download?tables='+table,{originHeader:origin,token:landToken})).status,200,table+' export');
  }
  for (const table of ['lahan_target','lahan_rencana']) {
    assert.equal((await request('/api/input-client/records/'+table,{originHeader:origin,token:staffToken})).status,403,table+' rejects climate staff');
  }
  const activityBody={untuk:'Padi',urutan:999,aktivitas:'Kegiatan uji terisolasi',hari_per_ha:2,tim:1};
  const activityAdd=await request('/api/input-client/t/lahan_aktivitas',{method:'POST',originHeader:origin,token:landToken,body:activityBody});
  assert.equal(activityAdd.status,200,await activityAdd.clone().text());
  const activityId=(await activityAdd.json()).id;
  const activityList=await (await request('/api/input-client/records/lahan_aktivitas?limit=100&summary=1',{originHeader:origin,token:landToken})).json();
  assert.ok(activityList.summary?.rows.length,'activity summary');
  const activity=activityList.rows.find(row=>row.id===activityId);assert.ok(activity?.updated_at);
  const activityEdit={tim:3,updated_at:activity.updated_at};
  assert.equal((await request('/api/input-client/t/lahan_aktivitas/'+activityId,{method:'PUT',originHeader:origin,token:landToken,body:activityEdit})).status,200);
  assert.equal((await request('/api/input-client/t/lahan_aktivitas/'+activityId,{method:'PUT',originHeader:origin,token:landToken,body:activityEdit})).status,409);
  const currentActivity=(await (await request('/api/input-client/records/lahan_aktivitas?limit=100',{originHeader:origin,token:landToken})).json()).rows.find(row=>row.id===activityId);
  assert.equal(currentActivity.tim,3);assert.equal(currentActivity.aktivitas,activityBody.aktivitas);
  assert.equal((await request('/api/input-client/t/lahan_aktivitas/'+activityId,{method:'PUT',originHeader:origin,token:landToken,body:{aktivitas:'Ganti nama',updated_at:currentActivity.updated_at}})).status,409);
  assert.equal((await request('/api/input-client/t/lahan_aktivitas/'+activityId,{method:'PUT',originHeader:origin,token:landToken,body:{untuk:'Pisang',updated_at:currentActivity.updated_at}})).status,409);
  assert.equal((await request('/api/input-client/t/lahan_aktivitas',{method:'POST',originHeader:origin,token:staffToken,body:activityBody})).status,403);
  assert.equal((await request('/api/input-client/excel/download?tables=lahan_aktivitas',{originHeader:origin,token:landToken})).status,200);
  const climate=await request('/api/input-client/t/iklim',{method:'POST',originHeader:origin,token:adminToken,body:{tanggal:'2026-11-03',curah_hujan:12}});
  assert.equal(climate.status,200,await climate.clone().text());const climateId=(await climate.json()).id;
  const climateRows=await (await request('/api/input-client/records/iklim?summary=1',{originHeader:origin,token:adminToken})).json();
  assert.ok(climateRows.summary?.rows.length,'climate summary');
  const climateRow=climateRows.rows.find(r=>r.id===climateId);assert.ok(climateRow.updated_at);
  assert.equal((await request('/api/input-client/t/iklim/'+climateId,{method:'PUT',originHeader:origin,token:adminToken,body:{keterangan:'tanpa versi'}})).status,409);
  const climateEdit={keterangan:'uji revisi',updated_at:climateRow.updated_at};
  assert.equal((await request('/api/input-client/t/iklim/'+climateId,{method:'PUT',originHeader:origin,token:adminToken,body:climateEdit})).status,200);
  assert.equal((await request('/api/input-client/t/iklim/'+climateId,{method:'PUT',originHeader:origin,token:adminToken,body:climateEdit})).status,409);
  assert.equal((await request('/api/input-client/t/iklim/'+climateId+'?updated_at='+encodeURIComponent(climateRow.updated_at),{method:'DELETE',originHeader:origin,token:adminToken})).status,409);
  const currentClimate=(await (await request('/api/input-client/records/iklim',{originHeader:origin,token:adminToken})).json()).rows.find(r=>r.id===climateId);
  assert.equal((await request('/api/input-client/t/iklim/'+climateId+'?updated_at='+encodeURIComponent(currentClimate.updated_at),{method:'DELETE',originHeader:origin,token:staffToken})).status,200);
  assert.ok(!(await (await request('/api/input-client/records/iklim',{originHeader:origin,token:adminToken})).json()).rows.some(r=>r.id===climateId));
  const overviewBefore=await (await request('/api/overview?from=2026-11-03&to=2026-11-03')).json();
  const inputCases=[
    ['lahan_harian',{tanggal:'2026-11-03',blok:'A01',aktivitas:'Bajak 1',hasil_ha:0.1}],
    ['pisang_panen_pkk',{tanggal:'2026-11-03',blok:'A01',fase:'PC',pkk_panen:10}],
    ['pisang_handclass',{tanggal:'2026-11-03',blok:'A01',status:'PC',rata_hand:6.5,jumlah_sampel:12}],
    ['padi_panen',{tanggal:'2026-11-03',petak:'P01',gkp_kg:100,gkg_kg:75,musim_tanam:'Arsip uji',gkg_basis:'Aktual',detail_timbang:'45;55'}],
    ['pisang_box',{tanggal:'2026-11-03',kelas:'A',jumlah_box:2}],
    ['pisang_estimasi',{bulan:'2026-11-01',box:30}],
    ['pisang_bibit',{tanggal_datang:'2026-11-03',batch:'UJI',qty_datang:20}],
    ['padi_giling',{tanggal:'2026-11-03',beras_kg:10}],
    ['padi_benih',{tanggal:'2026-11-03',varietas:'UJI',jenis:'Masuk',qty_kg:10,untuk:'Catatan arsip uji'}],
    ['padi_rencana',{mulai:'2026-11-02',selesai:'2026-11-08',aktivitas:'Uji'}]
  ];
  for(const [table,payload] of inputCases){
    const created=await request('/api/input-client/t/'+table,{method:'POST',originHeader:origin,token:adminToken,body:payload});
    assert.equal(created.status,200,table+': '+await created.clone().text());const itemId=(await created.json()).id;
    const list=await (await request('/api/input-client/records/'+table+'?summary=1',{originHeader:origin,token:adminToken})).json();
    assert.ok(list.summary?.rows.length,table+': ringkasan harus tersedia');
    const current=list.rows.find(r=>r.id===itemId);assert.ok(current?.updated_at,table+': versi tidak tersedia');
    const body={keterangan:'Uji revisi',updated_at:current.updated_at,...(table==='pisang_box'?{jumlah_box:5}:table==='pisang_panen_pkk'?{pkk_panen:12}:table==='padi_panen'?{gkp_kg:120}:{})};
    assert.equal((await request('/api/input-client/t/'+table+'/'+itemId,{method:'PUT',originHeader:origin,token:adminToken,body})).status,200,table+': revisi gagal');
    assert.equal((await request('/api/input-client/t/'+table+'/'+itemId,{method:'PUT',originHeader:origin,token:adminToken,body})).status,409,table+': revisi lama diterima');
    const after=(await (await request('/api/input-client/records/'+table,{originHeader:origin,token:adminToken})).json()).rows.find(r=>r.id===itemId);
    if(table==='padi_panen'){assert.equal(after.musim_tanam,'Arsip uji');assert.equal(after.gkg_basis,'Aktual');assert.equal(after.detail_timbang,'45;55');assert.equal(after.gkg_kg,75);}
    if(table==='padi_benih')assert.equal(after.untuk,'Catatan arsip uji');
  }
  const overviewAfter=await (await request('/api/overview?from=2026-11-03&to=2026-11-03')).json();
  assert.equal(overviewAfter.pisang.boxes-overviewBefore.pisang.boxes,5,'dashboard reflects revised packing once');
  assert.equal(overviewAfter.pisang.harvest-overviewBefore.pisang.harvest,12,'dashboard reflects revised banana harvest once');
  assert.equal(overviewAfter.padi.harvestKg-overviewBefore.padi.harvestKg,120,'dashboard reflects revised rice harvest once');
  const lr=await request('/api/input-client/login',{method:'POST',originHeader:origin,body:{username:'sales-uji',password:pw}});
  assert.equal(lr.status,200);const token=(await lr.json()).token;assert.match(token,/^[a-f0-9]{64}$/);
  const sales=await request('/api/input-client/records/pisang_penjualan',{originHeader:origin,token});assert.equal(sales.status,200);assert.equal(sales.headers.get('access-control-allow-origin'),origin);
  assert.equal((await request('/api/input-client/records/lahan_harian',{originHeader:origin,token})).status,403);
  assert.equal((await request('/api/input-client/users',{originHeader:origin,token})).status,403);
  assert.equal((await request('/api/input-client/t/pisang_penjualan/hapus',{method:'POST',originHeader:origin,token,body:{ids:[1]}})).status,404);
  assert.equal((await request('/api/gis-client/blocks',{originHeader:origin,token})).status,401);
  const row=await request('/api/input-client/t/pisang_penjualan',{method:'POST',originHeader:origin,token,body:{tanggal:'2026-11-03',no_sj:'UJISJ',tipe:'Penjualan',jumlah_box:2,harga:10000}});
  assert.equal(row.status,200,await row.clone().text());const id=(await row.json()).id;
  const batchId=crypto.randomUUID(),salesBatch=[{tanggal:'2026-11-03',no_sj:'BATCH',pembeli:'Pembeli Uji',tipe:'Penjualan',jumlah_box:2,harga:10000},{tanggal:'2026-11-03',no_sj:'BATCH',pembeli:'Pembeli Uji',tipe:'Ongkir',nominal:15000}];
  const firstBatch=await request('/api/input-client/t/pisang_penjualan',{method:'POST',originHeader:origin,token,body:{batchId,salesBatch}});assert.equal(firstBatch.status,200,await firstBatch.clone().text());const ids=(await firstBatch.json()).ids;assert.equal(ids.length,2);
  const retry=await request('/api/input-client/t/pisang_penjualan',{method:'POST',originHeader:origin,token,body:{batchId,salesBatch}});assert.deepEqual((await retry.json()).ids,ids);
  assert.equal((await request('/api/input-client/t/pisang_penjualan',{method:'POST',originHeader:origin,token,body:{batchId,salesBatch:[salesBatch[0]]}})).status,409);
  assert.equal((await request('/api/input-client/t/pisang_penjualan',{method:'POST',originHeader:origin,token,body:{batchId:crypto.randomUUID(),salesBatch:[salesBatch[0],{...salesBatch[1],pembeli:'Beda'}]}})).status,400);
  const records=await (await request('/api/input-client/records/pisang_penjualan',{originHeader:origin,token})).json();const found=records.rows.find(x=>x.id===id);assert.equal(found.total,20000);
  const edit={dibayar:5000,updated_at:found.updated_at};
  assert.equal((await request('/api/input-client/t/pisang_penjualan/'+id,{method:'PUT',originHeader:origin,token,body:edit})).status,200);
  assert.equal((await request('/api/input-client/t/pisang_penjualan/'+id,{method:'PUT',originHeader:origin,token,body:edit})).status,409);
  assert.equal((await request('/api/input-client/t/pisang_penjualan/'+id,{method:'DELETE',originHeader:origin,token})).status,409);
  assert.equal((await request('/api/input-client/t/lahan_harian/1?updated_at=x',{method:'DELETE',originHeader:origin,token})).status,403);
  assert.equal((await request('/api/input-client/t/pisang_penjualan/'+id+'?updated_at='+encodeURIComponent(found.updated_at),{method:'DELETE',originHeader:origin,token})).status,409);
  const current=(await (await request('/api/input-client/records/pisang_penjualan',{originHeader:origin,token})).json()).rows.find(x=>x.id===id);
  assert.equal((await request('/api/input-client/t/pisang_penjualan/'+id+'?updated_at='+encodeURIComponent(current.updated_at),{method:'DELETE',originHeader:origin,token})).status,200);
  assert.equal((await request('/api/input-client/excel/download?tables=pisang_penjualan',{originHeader:origin,token})).status,200);
  const riceSale=await request('/api/input-client/t/padi_penjualan',{method:'POST',originHeader:origin,token,body:{tanggal:'2026-11-03',no_sj:'UJI-PADI',tipe:'Penjualan',jenis:'Beras',berat_kg:25,harga_kg:12000}});
  assert.equal(riceSale.status,200,await riceSale.clone().text());
  const riceSaleId=(await riceSale.json()).id;
  const riceSales=(await (await request('/api/input-client/records/padi_penjualan',{originHeader:origin,token})).json()).rows;
  const savedRiceSale=riceSales.find(r=>r.id===riceSaleId);assert.ok(savedRiceSale?.updated_at);
  const riceSaleEdit={dibayar:50000,updated_at:savedRiceSale.updated_at};
  assert.equal((await request('/api/input-client/t/padi_penjualan/'+riceSaleId,{method:'PUT',originHeader:origin,token,body:riceSaleEdit})).status,200);
  assert.equal((await request('/api/input-client/t/padi_penjualan/'+riceSaleId,{method:'PUT',originHeader:origin,token,body:riceSaleEdit})).status,409);
  assert.equal((await request('/api/input-client/excel/download?tables=padi_penjualan',{originHeader:origin,token})).status,200);
  assert.equal((await request('/api/input-client/excel/download?tables=lahan_harian',{originHeader:origin,token})).status,403);
  const users=await (await request('/api/users',{cookieHeader:cookie})).json();const salesId=users.find(u=>u.username==='sales-uji').id;
  assert.equal((await request('/api/users/'+salesId,{method:'PUT',cookieHeader:cookie,body:{password:pw2}})).status,200);
  assert.equal((await request('/api/input-client/records/pisang_penjualan',{originHeader:origin,token})).status,401);
  console.log('Sesi input: asal, hak akses, pemisahan GIS, simpan, konflik, Excel, dan pencabutan saat sandi berubah lulus.');
}finally{
  if(child.exitCode===null){child.kill();await once(child,'exit');}
}
