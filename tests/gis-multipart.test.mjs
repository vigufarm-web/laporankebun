import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createBlockRegistry,isBlockLayer} from '../lib/blocks.js';
test('multipart GIS blocks share one stable identity without importing future plans',()=>{
 const db=new DatabaseSync(':memory:');const blocks=createBlockRegistry({db,TABLES:{},cascadeRename(){},log(){}});blocks.migrate();
 const polygon=x=>({type:'Feature',properties:{Nama_Blok:'A01',Lahan:'Pisang',Shape_Area:100},geometry:{type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,0]]]}});
 const plan=blocks.plan({nama:'Blok Tanam',geojson:{type:'FeatureCollection',features:[polygon(0),polygon(2)]}},{initializing:true});
 assert.deepEqual(plan.errors,[]);const features=JSON.parse(plan.geojson).features;assert.equal(features.length,1);assert.equal(features[0].geometry.coordinates.length,2);assert.equal(features[0].properties.Shape_Area,200);assert.ok(features[0].properties.blok_id);
 assert.equal(isBlockLayer({nama:'Rencana Blok Tanam Full'}),false);assert.equal(isBlockLayer({nama:'Blok Tanam'}),true);db.close();
});
