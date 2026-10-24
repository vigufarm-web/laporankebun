import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {encryptDatabase,decryptDatabase,githubStore,githubDataConfig} from '../lib/github-store.js';
import {copyCloudSnapshot} from '../lib/cloud-snapshot.js';

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kebun-store-test-')),file=path.join(dir,'seed.db');
 const db=new DatabaseSync(file);db.exec("CREATE TABLE _ver(v INTEGER PRIMARY KEY);INSERT INTO _ver VALUES(7);CREATE TABLE records(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO records VALUES(1,'data asli');");db.close();
 const key=randomBytes(32).toString('base64'),bytes=fs.readFileSync(file);
 const config={repo:'test/private-data',token:'server-only-test',key,branch:'main',file:'storage/kebun.enc.json'};
 let content=encryptDatabase(bytes,key),sha=createHash('sha1').update(content).digest('hex'),requests=[],race=false,failAfterWrite=false;
 const request=async(url,options)=>{
  requests.push({method:options.method||'GET',url});assert.equal(options.headers.Authorization,'Bearer server-only-test');
  if(options.method==='PUT'){
   const body=JSON.parse(options.body);
   if(race){race=false;sha='external-sha';}
   if(body.sha!==sha)return Response.json({message:'conflict'},{status:409});
   content=Buffer.from(body.content,'base64');sha=createHash('sha1').update(content).digest('hex');
   if(failAfterWrite){failAfterWrite=false;throw new TypeError('network response lost');}
   return Response.json({content:{sha}});
  }
  if(options.headers['If-None-Match']==='"'+sha+'"')return new Response(null,{status:304});
  return Response.json({sha,content:content.toString('base64'),encoding:'base64'},{headers:{etag:'"'+sha+'"'}});
 };
 return {dir,key,bytes,config,request,requests,race(){race=true;},failAfterWrite(){failAfterWrite=true;},read:()=>decryptDatabase(content,key),cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('encrypted database authenticates contents and rejects wrong keys or tampering',()=>{
 const f=fixture();try{
  const encrypted=encryptDatabase(f.bytes,f.key);assert.ok(!encrypted.includes(Buffer.from('data asli')));assert.deepEqual(decryptDatabase(encrypted,f.key),f.bytes);
  assert.throws(()=>decryptDatabase(encrypted,randomBytes(32).toString('base64')));
  const changed=JSON.parse(encrypted);changed.data=Buffer.alloc(30).toString('base64');assert.throws(()=>decryptDatabase(Buffer.from(JSON.stringify(changed)),f.key));
  assert.equal(githubDataConfig({}),null);assert.throws(()=>githubDataConfig({DATA_BACKEND:'github'}));
 }finally{f.cleanup();}
});
test('GitHub reads use cached local SQL, durable writes survive a new instance and scoped snapshots preserve records',async()=>{
 const f=fixture();let clock=0;const store=githubStore(f.config,{fetch:f.request,now:()=>clock,directory:f.dir});let second;
 try{
  assert.equal((await store.query(['SELECT value FROM records']))[0][0].value,'data asli');
  for(let i=0;i<20;i++)await store.query(['SELECT max(v) v FROM _ver']);assert.equal(f.requests.length,1);
  clock=16000;await store.query(['SELECT max(v) v FROM _ver']);assert.equal(f.requests.length,2);
  await store.batch(['CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY,value TEXT)']);assert.equal(f.requests.filter(r=>r.method==='PUT').length,0);
  await store.batch([{sql:'INSERT INTO _ver VALUES(?)',args:[8]},{sql:'UPDATE records SET value=? WHERE id=1',args:['tersimpan']}]);
  assert.equal(f.requests.filter(r=>r.method==='PUT').length,1);
  second=githubStore(f.config,{fetch:f.request,directory:f.dir});assert.equal((await second.query(['SELECT value FROM records']))[0][0].value,'tersimpan');
  const snapshot=await copyCloudSnapshot(second,{tables:['_ver','records']});try{assert.equal(snapshot.version,8);assert.equal(snapshot.db.prepare('SELECT value FROM records').get().value,'tersimpan');}finally{snapshot.db.close();}
 }finally{second?.close();store.close();f.cleanup();}
});
test('two writers cannot overwrite a saved update; a SHA race is rejected and local changes discarded',async()=>{
 const f=fixture(),a=githubStore(f.config,{fetch:f.request,directory:f.dir}),b=githubStore(f.config,{fetch:f.request,directory:f.dir});
 try{
  await Promise.all([a.query(['SELECT * FROM records']),b.query(['SELECT * FROM records'])]);
  await a.batch(["INSERT INTO _ver VALUES(8)","UPDATE records SET value='writer a'"]);
  await assert.rejects(b.batch(["INSERT INTO _ver VALUES(8)","UPDATE records SET value='stale b'"]),e=>e.conflict===true);
  assert.equal((await b.query(['SELECT value FROM records']))[0][0].value,'writer a');
  f.race();await assert.rejects(b.batch(["INSERT INTO _ver VALUES(9)","UPDATE records SET value='lost race'"]),e=>e.conflict===true);
  assert.equal((await b.query(['SELECT value FROM records']))[0][0].value,'writer a');
 }finally{a.close();b.close();f.cleanup();}
});
test('lost write response is reconciled without replay and missing remote never creates an empty database',async()=>{
 const f=fixture(),a=githubStore(f.config,{fetch:f.request,directory:f.dir});let missing;
 try{
  await a.query(['SELECT * FROM records']);f.failAfterWrite();
  await assert.rejects(a.batch(["INSERT INTO _ver VALUES(8)","UPDATE records SET value='saved despite timeout'"]),/network response lost/);
  assert.equal(f.requests.filter(r=>r.method==='PUT').length,1);assert.equal((await a.query(['SELECT value FROM records']))[0][0].value,'saved despite timeout');
  missing=githubStore(f.config,{fetch:async()=>Response.json({message:'Not found'},{status:404}),directory:f.dir});await assert.rejects(missing.query(['SELECT 1']),/belum tersedia/);
 }finally{missing?.close();a.close();f.cleanup();}
});
