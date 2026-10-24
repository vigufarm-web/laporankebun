import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_DB = 64 * 1024 * 1024;
function keyBytes(key) {
  const value = Buffer.from(key || '', 'base64');
  if (value.length !== 32) throw new Error('GITHUB_DATA_KEY harus berupa kunci base64 32 byte.');
  return value;
}
export function encryptDatabase(bytes, key) {
  if (bytes.length > MAX_DB || !bytes.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))) throw new Error('Berkas database tidak valid atau terlalu besar.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from('laporankebun:sqlite-gzip:v1'));
  const data = Buffer.concat([cipher.update(gzipSync(bytes)), cipher.final()]);
  return Buffer.from(JSON.stringify({format:'laporankebun:sqlite-gzip:v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}));
}
export function decryptDatabase(bytes, key) {
  const value = JSON.parse(bytes.toString('utf8'));
  if (value.format !== 'laporankebun:sqlite-gzip:v1') throw new Error('Format data GitHub tidak dikenali.');
  const decipher = createDecipheriv('aes-256-gcm',keyBytes(key),Buffer.from(value.iv,'base64'));
  decipher.setAAD(Buffer.from(value.format));
  decipher.setAuthTag(Buffer.from(value.tag,'base64'));
  const plain = gunzipSync(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]),{maxOutputLength:MAX_DB});
  if (!plain.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))) throw new Error('Isi database GitHub tidak valid.');
  return plain;
}
export function githubDataConfig(env) {
  if (env.DATA_BACKEND !== 'github') return null;
  const repo=env.GITHUB_DATA_REPO,token=env.GITHUB_DATA_TOKEN,key=env.GITHUB_DATA_KEY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo||'') || !token || !key) throw new Error('Penyimpanan GitHub belum lengkap: repo, token, dan kunci diperlukan.');
  keyBytes(key);
  const branch=env.GITHUB_DATA_BRANCH||'kebun-data',file=env.GITHUB_DATA_PATH||'storage/kebun.enc.json';
  if (!branch || !file || file.split('/').some(p=>!p||p==='.'||p==='..')) throw new Error('Lokasi data GitHub tidak valid.');
  return {repo,token,key,branch,file};
}

// One encrypted SQLite file, just as payroll uses an encrypted data file.
// SQL and scoped snapshots run locally; GitHub is contacted only for version
// checks and durable commits. GitHub's blob SHA is the compare-and-swap guard.
export function githubStore(config,{fetch:request=globalThis.fetch,now=Date.now,checkMs=15000,directory=os.tmpdir()}={}) {
  keyBytes(config.key);
  const base='https://api.github.com/repos/'+config.repo;
  const location=base+'/contents/'+config.file.split('/').map(encodeURIComponent).join('/');
  const headers={Authorization:'Bearer '+config.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'laporankebun'};
  const folder=fs.mkdtempSync(path.join(directory,'kebun-github-')),filename=path.join(folder,'data.db');
  let database=null,sha=null,etag=null,checked=-Infinity,invalid=false;
  let queue=Promise.resolve();
  function serial(fn){const run=queue.then(fn,fn);queue=run.catch(()=>{});return run;}
  async function call(url,options={}) {
    const response=await request(url,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(25000)});
    if (response.status===304) return {response};
    const body=await response.json();
    if (!response.ok) {
      const error=new Error(response.status===404?'Berkas data GitHub belum tersedia. Pulihkan cadangan terenkripsi terlebih dahulu.':response.status===401||response.status===403?'GitHub menolak akses penyimpanan. Periksa izin token atau batas permintaan.':'Penyimpanan GitHub gagal ('+response.status+').');
      error.status=response.status===409||response.status===422?409:503;
      error.conflict=error.status===409;
      throw error;
    }
    return {response,body};
  }
  async function refresh(force=false) {
    if (database&&!invalid&&!force&&now()-checked<checkMs) return;
    const {response,body}=await call(location+'?ref='+encodeURIComponent(config.branch),{headers:etag&&!invalid?{'If-None-Match':etag}:{}});
    if (response.status===304) {if(!database||invalid)throw new Error('Versi database GitHub belum dapat dimuat.');checked=now();return;}
    if (database&&!invalid&&body.sha===sha) {etag=response.headers.get('etag');checked=now();return;}
    let content=body.content;
    if (body.encoding!=='base64'||!content) content=(await call(base+'/git/blobs/'+encodeURIComponent(body.sha))).body.content;
    const bytes=decryptDatabase(Buffer.from(content,'base64'),config.key);
    // Validate before replacing the last successfully opened copy.
    const candidate=path.join(folder,'candidate.db');fs.writeFileSync(candidate,bytes);
    const check=new DatabaseSync(candidate);
    try {if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Cadangan GitHub gagal diperiksa.');if(!check.prepare("SELECT name FROM sqlite_master WHERE name='_ver'").get())throw new Error('Cadangan GitHub tidak memiliki versi data.');}finally{check.close();}
    database?.close();fs.renameSync(candidate,filename);database=new DatabaseSync(filename);database.exec('PRAGMA journal_mode=DELETE;');
    sha=body.sha;etag=response.headers.get('etag');checked=now();invalid=false;
  }
  function execute(s) {return database.prepare(typeof s==='string'?s:s.sql).all(...(typeof s==='string'?[]:s.args||[]));}
  async function query(list){return serial(async()=>{await refresh();return list.map(execute);});}
  async function snapshot(work){return serial(async()=>{await refresh();database.exec('BEGIN');try{const value=await work(async list=>list.map(execute));database.exec('COMMIT');return value;}catch(error){database.exec('ROLLBACK');throw error;}});}
  async function batch(list){return serial(async()=>{
    // Always compare with the latest data before applying a write. The caller's
    // _ver insertion detects stale local transactions; SHA detects a later race.
    await refresh(true);
    const changes=database.prepare('SELECT total_changes() n').get().n,schema=database.prepare('PRAGMA schema_version').get().schema_version;
    database.exec('BEGIN');
    let results;
    try {results=list.map(s=>database.prepare(typeof s==='string'?s:s.sql).run(...(typeof s==='string'?[]:s.args||[])));database.exec('COMMIT');}
    catch(error){database.exec('ROLLBACK');if(/UNIQUE constraint failed: _ver/.test(error.message))error.conflict=true;throw error;}
    if(database.prepare('SELECT total_changes() n').get().n===changes&&database.prepare('PRAGMA schema_version').get().schema_version===schema)return results;
    const encrypted=encryptDatabase(fs.readFileSync(filename),config.key);
    try {
      const {body}=await call(location,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Simpan data laporan kebun [skip ci]',branch:config.branch,sha,content:encrypted.toString('base64')})});
      sha=body.content.sha;etag=null;checked=now();return results;
    } catch(error) {
      // An ambiguous network response is never retried as a write. Discard the
      // local working copy; the next read must reconcile against GitHub.
      invalid=true;checked=-Infinity;etag=null;
      try{await refresh(true);}catch{}
      throw error;
    }
  });}
  return {query,batch,snapshot,close(){database?.close();database=null;fs.rmSync(folder,{recursive:true,force:true});}};
}
