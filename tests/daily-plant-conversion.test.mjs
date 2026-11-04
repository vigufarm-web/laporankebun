import test from 'node:test';
import assert from 'node:assert/strict';
import {usesPlantCount,plantCountToHa} from '../public/js/daily-plant-conversion.js';

test('banana planting counts convert to hectares without changing other activities',()=>{
  assert.equal(plantCountToHa(2000),1);
  assert.equal(plantCountToHa(1000),0.5);
  assert.equal(plantCountToHa(1),0.0005);
  assert.equal(plantCountToHa(0),0);
  assert.equal(plantCountToHa(''),'');
  for(const invalid of [-1,1.5,'bad'])assert.equal(plantCountToHa(invalid),null);
  assert.equal(usesPlantCount('Pisang','Tanam','ha'),true);
  assert.equal(usesPlantCount('Pisang','Pasang stik tanam','ha'),true);
  assert.equal(usesPlantCount('Padi','Tanam','ha'),false);
  assert.equal(usesPlantCount('Pisang','Sulam tanam','pokok'),false);
  assert.equal(usesPlantCount('Pisang','Tanam','pokok'),false);
});
