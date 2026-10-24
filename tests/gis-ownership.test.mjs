import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import {parcelCoverage,createParcelLocations} from '../lib/gis-ownership.js';
import {DatabaseSync} from 'node:sqlite';
const rect=(x,y,w=1,h=1)=>({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]});
test('parcel ownership measures full coverage, holes and partial crossings',()=>{
 const union=clipping.union(rect(0,0).coordinates,rect(1,0).coordinates);
 assert.equal(parcelCoverage(rect(0,0,2,1),union),1);assert.equal(parcelCoverage(rect(1,0,2,1),union),0.5);
 assert.equal(parcelCoverage(rect(3,0),union),0);assert.equal(parcelCoverage(null,union),0);
 const hole=[[[[0,0],[3,0],[3,3],[0,3],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]]];assert.equal(parcelCoverage(rect(1,1),hole),0);
});
test('daily locations refresh after a parcel revision and do not infer target ownership',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE gis_layer(id INTEGER,nama TEXT,updated_at TEXT,geojson TEXT);CREATE TABLE _blocks(id TEXT,geometry TEXT)');
 const fc=status=>JSON.stringify({features:[{properties:{Status:status},geometry:rect(0,0)}]});
 db.prepare('INSERT INTO gis_layer VALUES(1,?,?,?)').run('Persil Lahan 21-10-2026','v1',fc('Sudah Bayar'));db.prepare('INSERT INTO _blocks VALUES(?,?)').run('fixed',JSON.stringify(rect(0,0)));
 const blocks={list:()=>[{id:'fixed',nama:'A01',active:1,layer_id:2,ownership:'Belum diverifikasi'}]};const locations=createParcelLocations(db,blocks);
 assert.equal(locations().length,1);assert.equal(locations()[0].id,'fixed');
 db.prepare('UPDATE gis_layer SET updated_at=?,geojson=?').run('v2',fc('Lahan Target1'));assert.equal(locations().length,0);db.close();
});
