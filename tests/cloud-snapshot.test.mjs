import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { turso } from '../lib/turso.js';
import { copyCloudSnapshot } from '../lib/cloud-snapshot.js';

test('cloud snapshot streams geometry and blobs within one read transaction', async () => {
  const source=new DatabaseSync(':memory:');
  source.exec('CREATE TABLE _ver(v INTEGER PRIMARY KEY); INSERT INTO _ver VALUES(7); CREATE TABLE gis_layer(id INTEGER PRIMARY KEY AUTOINCREMENT,geojson TEXT); CREATE TABLE records(code TEXT PRIMARY KEY,value TEXT) WITHOUT ROWID; CREATE TABLE attachments(id INTEGER PRIMARY KEY,data BLOB); CREATE INDEX attachment_id ON attachments(id)');
  const geometry='peta 🌴 '.repeat(100000),blob=Buffer.alloc(90000,42);
  source.prepare('INSERT INTO gis_layer(geojson) VALUES(?)').run(geometry);
  source.prepare('INSERT INTO attachments VALUES(1,?)').run(blob);
  for(let i=0;i<251;i++)source.prepare('INSERT INTO records VALUES(?,?)').run(String(i).padStart(4,'0'),'hasil '+i);
  let active=false,largest=0,reads=0;
  const encode=v=>v===null?{type:'null'}:v instanceof Uint8Array?{type:'blob',base64:Buffer.from(v).toString('base64')}:typeof v==='number'?{type:'integer',value:String(v)}:{type:'text',value:v};
  const server=http.createServer(async(req,res)=>{
    try {
      let body='';for await(const chunk of req)body+=chunk;
      const payload=JSON.parse(body);
      assert.equal(payload.baton,active?'snapshot-token':null);
      const results=[];
      for(const r of payload.requests) {
        if(r.type==='close') {if(active){source.exec('ROLLBACK');active=false;}results.push({type:'ok',response:{type:'close'}});continue;}
        const sql=r.stmt.sql;
        if(sql==='BEGIN')active=true;
        const st=source.prepare(sql),rows=st.all();
        if(sql==='COMMIT')active=false;
        results.push({type:'ok',response:{type:'execute',result:{cols:st.columns().map(c=>({name:c.name})),rows:rows.map(row=>Object.values(row).map(encode))}}});reads++;
      }
      const response=JSON.stringify({baton:active?'snapshot-token':null,results});
      largest=Math.max(largest,Buffer.byteLength(response));
      if(Buffer.byteLength(response)>100000){res.destroy();return;}
      res.setHeader('Content-Type','application/json');res.end(response);
    }catch(error){res.statusCode=500;res.end(String(error));}
  }).listen(0,'127.0.0.1');
  await once(server,'listening');
  let snapshot;
  try {
    snapshot=await copyCloudSnapshot(turso('http://127.0.0.1:'+server.address().port,'test-token'));
    assert.equal(snapshot.version,7);
    assert.equal(snapshot.db.prepare('SELECT geojson FROM gis_layer').get().geojson,geometry);
    assert.deepEqual(Buffer.from(snapshot.db.prepare('SELECT data FROM attachments').get().data),blob);
    assert.equal(snapshot.db.prepare('SELECT COUNT(*) n FROM records').get().n,251);
    assert.equal(snapshot.db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get('gis_layer').seq,1);
    assert.ok(snapshot.db.prepare("SELECT 1 FROM sqlite_master WHERE name='attachment_id'").get());
    assert.equal(active,false);assert.ok(largest<100000);assert.ok(reads>20);
  }finally{snapshot?.db.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));source.close();}
});
