import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('input activity permissions, revisions and history protection', {timeout:90000}, async()=>{
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const dir=await mkdtemp(join(tmpdir(),'vigu-activity-test-'));
 const child=spawn(process.execPath,['server.js'],{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,DATA_BACKEND:'local',DATA_DIR:dir,PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let logs='';for(const s of [child.stdout,child.stderr])s.on('data',chunk=>logs+=chunk);
 const base='http://127.0.0.1:'+port,origin='https://vigufarm-web.github.io',password=crypto.randomUUID();let cookie='';
 async function call(path,{method='GET',body,token,admin=false}={}){const r=await fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(admin&&cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;}
 try{
  let ready=false;for(let i=0;i<300;i++){if(child.exitCode!==null)throw Error(logs);try{if((await call('/api/me')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,logs);
  assert.equal((await call('/api/setup',{method:'POST',body:{username:'admin-uji',password,nama:'Uji'}})).status,200);
  assert.equal((await call('/api/users',{method:'POST',admin:true,body:{username:'lahan-uji',password,nama:'Lahan',peran:['lahan']}})).status,200);
  assert.equal((await call('/api/users',{method:'POST',admin:true,body:{username:'iklim-uji',password,nama:'Iklim',peran:['iklim']}})).status,200);
  async function login(username){const r=await call('/api/input-client/login',{method:'POST',body:{username,password}});assert.equal(r.status,200);return (await r.json()).token;}
  const land=await login('lahan-uji'),climate=await login('iklim-uji');
  const item={untuk:'Padi',urutan:999,aktivitas:'Aktivitas uji terisolasi',hari_per_ha:2,tim:1};
  assert.equal((await call('/api/input-client/t/lahan_aktivitas',{method:'POST',token:climate,body:item})).status,403);
  const added=await call('/api/input-client/t/lahan_aktivitas',{method:'POST',token:land,body:item});assert.equal(added.status,200);const {id}=await added.json();
  assert.equal((await call('/api/input-client/t/lahan_aktivitas',{method:'POST',token:land,body:{...item,aktivitas:' aktivitas UJI terisolasi '}})).status,409);
  assert.equal((await call('/api/input-client/t/lahan_aktivitas',{method:'POST',token:land,body:{...item,untuk:'Semua'}})).status,409);
  const list=async()=>((await (await call('/api/input-client/records/lahan_aktivitas?limit=100',{token:land})).json()).rows.find(r=>r.id===id));
  const old=await list(),patch={tim:3,updated_at:old.updated_at};
  assert.equal((await call('/api/input-client/t/lahan_aktivitas/'+id,{method:'PUT',token:land,body:patch})).status,200);
  assert.equal((await call('/api/input-client/t/lahan_aktivitas/'+id,{method:'PUT',token:land,body:patch})).status,409);
  const current=await list();assert.equal(current.tim,3);assert.equal(current.aktivitas,item.aktivitas);
  for(const edit of [{aktivitas:'Ganti nama'},{untuk:'Pisang'}])assert.equal((await call('/api/input-client/t/lahan_aktivitas/'+id,{method:'PUT',token:land,body:{...edit,updated_at:current.updated_at}})).status,409);
  assert.equal((await call('/api/input-client/excel/download?tables=lahan_aktivitas',{token:land})).status,200);
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
});
