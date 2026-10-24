import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {removeDuplicateParcelLayer} from '../lib/gis-deduplicate.js';
test('remove only equivalent older parcel layer, retain revised geometry',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE gis_layer(id INTEGER,nama TEXT,geojson TEXT);CREATE TABLE _blocks(layer_id INTEGER)');
 const fc=x=>JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{Status:'Sudah Bayar'},geometry:{type:'Point',coordinates:[x,1]}}]});
 db.prepare('INSERT INTO gis_layer VALUES(1,?,?)').run('Persil Lahan',fc(1));db.prepare('INSERT INTO gis_layer VALUES(6,?,?)').run('Persil Lahan 21-10-2026',fc(2));assert.equal(removeDuplicateParcelLayer(db),null);
 db.prepare('UPDATE gis_layer SET geojson=? WHERE id=6').run(fc(1+1e-14));assert.equal(removeDuplicateParcelLayer(db).kept,6);assert.equal(db.prepare('SELECT count(*) n FROM gis_layer').get().n,1);assert.equal(removeDuplicateParcelLayer(db),null);db.close();
});
