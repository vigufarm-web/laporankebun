import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadPhotoContext } from '../lib/photo-context.js';

test('photo context refresh preserves identity allocation and does not read GIS', async()=>{
  const source=new DatabaseSync(':memory:'),cache=new DatabaseSync(':memory:');
  const schema='CREATE TABLE _ver(v INTEGER PRIMARY KEY);CREATE TABLE _users(id INTEGER PRIMARY KEY AUTOINCREMENT,peran TEXT);CREATE TABLE _sessions(token TEXT PRIMARY KEY,user_id INTEGER);CREATE TABLE daily_report(id INTEGER PRIMARY KEY AUTOINCREMENT,divisi TEXT);CREATE TABLE daily_photo(id INTEGER PRIMARY KEY AUTOINCREMENT,report_id INTEGER,deleted_at TEXT);CREATE TABLE _log(id INTEGER PRIMARY KEY AUTOINCREMENT);CREATE TABLE gis_layer(id INTEGER PRIMARY KEY,geojson TEXT)';
  for(const db of [source,cache])db.exec(schema);
  source.exec("INSERT INTO _ver VALUES(9);INSERT INTO _users VALUES(1,'admin');INSERT INTO _sessions VALUES('session',1);INSERT INTO daily_report VALUES(1,'Pisang'),(2,'Padi');INSERT INTO daily_photo VALUES(4,1,NULL),(9,2,NULL);INSERT INTO _log VALUES(15)");
  cache.exec("INSERT INTO _users VALUES(1,'management');INSERT INTO daily_report VALUES(1,'Padi'),(2,'Pisang')");
  cache.prepare('INSERT INTO gis_layer VALUES(1,?)').run('geometry'.repeat(200000));
  const queries=[];const cloud={snapshot:async work=>{
    source.exec('BEGIN');try{const result=await work(async list=>list.map(input=>{const sql=typeof input==='string'?input:input.sql;queries.push(sql);return source.prepare(sql).all(...(input.args||[]));}));source.exec('COMMIT');return result;}catch(e){source.exec('ROLLBACK');throw e;}
  }};
  try {
    assert.equal(await loadPhotoContext(cloud,cache,1),9);
    assert.equal(cache.prepare('SELECT divisi FROM daily_report').get().divisi,'Pisang');
    assert.equal(cache.prepare('SELECT peran FROM _users').get().peran,'admin');
    assert.equal(cache.prepare('SELECT user_id FROM _sessions').get().user_id,1);
    assert.equal(cache.prepare('INSERT INTO daily_photo(report_id) VALUES(1)').run().lastInsertRowid,10);
    assert.equal(cache.prepare('INSERT INTO _log DEFAULT VALUES').run().lastInsertRowid,16);
    assert.equal(source.prepare('SELECT COUNT(*) n FROM daily_report').get().n,2);
    assert.equal(source.prepare('SELECT COUNT(*) n FROM daily_photo').get().n,2);
    assert.ok(!queries.some(sql=>/gis_layer/.test(sql)));
    assert.equal(cache.prepare('SELECT length(geojson) n FROM gis_layer').get().n,1600000);
    await loadPhotoContext(cloud,cache,2);
    assert.equal(cache.prepare('SELECT divisi FROM daily_report').get().divisi,'Padi');
    assert.equal(cache.prepare('SELECT id FROM daily_photo').get().id,9);
  }finally{source.close();cache.close();}
});
