import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const dir=await mkdtemp(join(tmpdir(),'vigu-input-client-test-'));
const child=spawn(process.execPath,['server.js'],{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PORT:String(port),DATA_DIR:dir},stdio:'ignore',windowsHide:true});
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
  for(let i=0;i<100;i++){try{if((await request('/api/me')).ok)break;}catch{}if(i===99)throw Error('Backend tidak siap');await new Promise(r=>setTimeout(r,200));}
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
    if(name==='lahan-uji')assert.equal((await request('/api/input-client/t/lahan_aktivitas',{originHeader:origin,token:roleToken})).status,200);
  }
  const adminLogin=await request('/api/input-client/login',{method:'POST',originHeader:origin,body:{username:'admin-uji',password:pw}});
  assert.equal(adminLogin.status,200);const adminToken=(await adminLogin.json()).token;
  const climate=await request('/api/input-client/t/iklim',{method:'POST',originHeader:origin,token:adminToken,body:{tanggal:'2026-11-03',curah_hujan:12}});
  assert.equal(climate.status,200,await climate.clone().text());const climateId=(await climate.json()).id;
  const climateRows=await (await request('/api/input-client/records/iklim',{originHeader:origin,token:adminToken})).json();
  const climateRow=climateRows.rows.find(r=>r.id===climateId);assert.ok(climateRow.updated_at);
  assert.equal((await request('/api/input-client/t/iklim/'+climateId,{method:'PUT',originHeader:origin,token:adminToken,body:{keterangan:'tanpa versi'}})).status,409);
  const climateEdit={keterangan:'uji revisi',updated_at:climateRow.updated_at};
  assert.equal((await request('/api/input-client/t/iklim/'+climateId,{method:'PUT',originHeader:origin,token:adminToken,body:climateEdit})).status,200);
  assert.equal((await request('/api/input-client/t/iklim/'+climateId,{method:'PUT',originHeader:origin,token:adminToken,body:climateEdit})).status,409);
  const inputCases=[
    ['pisang_box',{tanggal:'2026-11-03',kelas:'A',jumlah_box:2}],
    ['pisang_estimasi',{bulan:'2026-11-01',box:30}],
    ['pisang_bibit',{tanggal_datang:'2026-11-03',batch:'UJI',qty_datang:20}],
    ['padi_giling',{tanggal:'2026-11-03',beras_kg:10}],
    ['padi_benih',{tanggal:'2026-11-03',varietas:'UJI',jenis:'Masuk',qty_kg:10}],
    ['padi_rencana',{mulai:'2026-11-02',selesai:'2026-11-08',aktivitas:'Uji'}]
  ];
  for(const [table,payload] of inputCases){
    const created=await request('/api/input-client/t/'+table,{method:'POST',originHeader:origin,token:adminToken,body:payload});
    assert.equal(created.status,200,table+': '+await created.clone().text());const itemId=(await created.json()).id;
    const list=await (await request('/api/input-client/records/'+table,{originHeader:origin,token:adminToken})).json();
    const current=list.rows.find(r=>r.id===itemId);assert.ok(current?.updated_at,table+': versi tidak tersedia');
    const body={keterangan:'Uji revisi',updated_at:current.updated_at};
    assert.equal((await request('/api/input-client/t/'+table+'/'+itemId,{method:'PUT',originHeader:origin,token:adminToken,body})).status,200,table+': revisi gagal');
    assert.equal((await request('/api/input-client/t/'+table+'/'+itemId,{method:'PUT',originHeader:origin,token:adminToken,body})).status,409,table+': revisi lama diterima');
  }
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
  assert.equal((await request('/api/input-client/t/lahan_harian/1?updated_at=x',{method:'DELETE',originHeader:origin,token})).status,404);
  assert.equal((await request('/api/input-client/t/pisang_penjualan/'+id+'?updated_at='+encodeURIComponent(found.updated_at),{method:'DELETE',originHeader:origin,token})).status,409);
  const current=(await (await request('/api/input-client/records/pisang_penjualan',{originHeader:origin,token})).json()).rows.find(x=>x.id===id);
  assert.equal((await request('/api/input-client/t/pisang_penjualan/'+id+'?updated_at='+encodeURIComponent(current.updated_at),{method:'DELETE',originHeader:origin,token})).status,200);
  assert.equal((await request('/api/input-client/excel/download?tables=pisang_penjualan',{originHeader:origin,token})).status,200);
  assert.equal((await request('/api/input-client/excel/download?tables=lahan_harian',{originHeader:origin,token})).status,403);
  const users=await (await request('/api/users',{cookieHeader:cookie})).json();const salesId=users.find(u=>u.username==='sales-uji').id;
  assert.equal((await request('/api/users/'+salesId,{method:'PUT',cookieHeader:cookie,body:{password:pw2}})).status,200);
  assert.equal((await request('/api/input-client/records/pisang_penjualan',{originHeader:origin,token})).status,401);
  console.log('Sesi input: asal, hak akses, pemisahan GIS, simpan, konflik, Excel, dan pencabutan saat sandi berubah lulus.');
}finally{
  if(child.exitCode===null){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});else child.kill('SIGTERM');}
}
