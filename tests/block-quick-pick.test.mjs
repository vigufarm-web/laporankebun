import test from 'node:test';import assert from 'node:assert/strict';
import {cropGroups,quickPickWant,quickPickHTML,bindQuickPick} from '../public/js/block-quick-pick.js';
const locations=[{nama:'D04',divisi:'Pisang'},{nama:'P12',divisi:'Padi'},{nama:'A01',divisi:'Pisang'},{nama:'Embung 1',divisi:''},{nama:'K01',divisi:'Kelapa'}];
test('crop buttons come from location data, so a new crop appears automatically',()=>{
 assert.deepEqual(cropGroups(locations),['Kelapa','Padi','Pisang']);
 const h=quickPickHTML(locations);for(const s of ['Semua blok','Semua Pisang','Semua Padi','Semua Kelapa','Kosongkan'])assert.ok(h.includes(s),s);
 assert.equal(cropGroups([]).length,0);assert.ok(quickPickHTML([]).includes('Semua blok'));
});
test('all selects everything, crop adds its blocks without dropping others, clear empties',()=>{
 assert.equal(quickPickWant('*',false,'Padi'),true);assert.equal(quickPickWant('',true,'Pisang'),false);
 assert.equal(quickPickWant('Pisang',false,'Pisang'),true);assert.equal(quickPickWant('Pisang',true,'Padi'),true);assert.equal(quickPickWant('Pisang',false,'Padi'),false);
});
test('buttons click the existing checkboxes so their change handlers keep running',()=>{
 const changed=[],boxes=locations.map((l,i)=>({checked:false,dataset:{i},click(){this.checked=!this.checked;changed.push(l.nama);}}));
 const buttons=['*','Pisang',''].map(qp=>({dataset:{qp},onclick:null}));
 bindQuickPick({querySelectorAll:()=>buttons},()=>boxes,cb=>locations[cb.dataset.i].divisi);
 buttons[1].onclick();assert.deepEqual(boxes.map(b=>b.checked),[true,false,true,false,false]);
 buttons[0].onclick();assert.ok(boxes.every(b=>b.checked));
 buttons[2].onclick();assert.ok(boxes.every(b=>!b.checked));
 assert.equal(changed.length,2+3+5);
});
