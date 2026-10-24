// Local migration tool. Output belongs in ignored work/, never public/ or Git.
// Generates a separate secret key file; that key must be backed up securely and
// configured only on the server. This tool never prints the key or uploads it.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {encryptDatabase,decryptDatabase} from '../lib/github-store.js';
const [source,destination]=process.argv.slice(2);
if(!source||!destination)throw new Error('Usage: node scripts/prepare-github-data.mjs backup.db work/github-migration');
const folder=path.resolve(destination);
if(fs.existsSync(path.resolve(source)+'-wal')&&fs.statSync(path.resolve(source)+'-wal').size)throw new Error('Gunakan backup SQLite yang lengkap, bukan database aktif dengan WAL terpisah.');
if(folder.split(path.sep).includes('public'))throw new Error('Paket migrasi tidak boleh disimpan di public/.');
fs.mkdirSync(folder,{recursive:true});
const keyFile=path.join(folder,'data-key.secret'),payloadFile=path.join(folder,'kebun.enc.json');
if(fs.existsSync(keyFile)||fs.existsSync(payloadFile))throw new Error('Paket sudah tersedia; tidak menimpa kunci atau cadangan.');
const db=new DatabaseSync(path.resolve(source),{readOnly:true});
try{
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Cadangan gagal pemeriksaan integritas.');
 const bytes=fs.readFileSync(path.resolve(source)),key=randomBytes(32).toString('base64'),encrypted=encryptDatabase(bytes,key);
 if(!decryptDatabase(encrypted,key).equals(bytes))throw new Error('Verifikasi enkripsi gagal.');
 fs.writeFileSync(keyFile,key,{mode:0o600});fs.writeFileSync(payloadFile,encrypted);
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
 const counts=Object.fromEntries(tables.map(({name})=>[name,db.prepare('SELECT count(*) n FROM "'+name.replaceAll('"','""')+'"').get().n]));
 fs.writeFileSync(path.join(folder,'audit.json'),JSON.stringify({sourceBytes:bytes.length,encryptedBytes:encrypted.length,version:db.prepare('SELECT max(v) v FROM _ver').get().v,integrity:'ok',foreignKeys:'ok',tables:counts},null,2));
 console.log(JSON.stringify({integrity:'ok',sourceBytes:bytes.length,encryptedBytes:encrypted.length,tableCount:tables.length,photoCount:counts.daily_photo}));
}finally{db.close();}
