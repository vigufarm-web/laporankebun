import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyBlockBreakdown} from '../lib/weekly-blocks.js';
import {weeklyProgressCards} from '../public/js/weekly-progress-cards.js';
import {ACTIVITY} from '../public/js/daily-catalog.js';
import {visibleActivityRows} from '../public/js/activity-visibility.js';

test('weekly cards group only effective owned work in the displayed week',()=>{
 const base={tanggal:'2026-10-28',aktivitas:'Bajak 2',blok:'E01a',hasil_ha:.52};
 const rows=[base,{...base,tanggal:'2026-10-29',hasil_ha:.44},{...base,blok:'E01b',hasil_ha:.1},{...base,tanggal:'2026-10-25',hasil_ha:9},{...base,tanggal:'2026-11-02',hasil_ha:9},{...base,diganti_aktual:1,hasil_ha:9},{...base,blok:'OTHER',hasil_ha:9},{...base,aktivitas:'Ridger',hasil_ha:9}];
 const blocks=weeklyBlockBreakdown(rows,{activity:'Bajak 2',from:'2026-10-26',to:'2026-10-31',names:new Set(['e01a','e01b'])});
 assert.deepEqual(blocks,[{name:'E01a',ha:.96},{name:'E01b',ha:.1}]);
 const html=weeklyProgressCards([{name:'Bajak 2',target:1,done:1.06,blocks},{name:'Dolomite',target:1,done:0,blocks:[]},{name:'Ecer Pupuk',target:1,done:1,blocks:[]}]);
 assert.match(html,/E01a/);assert.match(html,/0,96 ha/);assert.match(html,/E01b/);assert.match(html,/Belum ada realisasi minggu ini/);assert.ok(!html.includes('Ecer Pupuk'));
 assert.match(weeklyProgressCards([{name:'<script>',done:1,target:1,blocks:[{name:'<img>',ha:1}]}]),/&lt;img&gt;/);
});
test('admin lists hide Ecer Pupuk while the Daily catalog and stored rows remain intact',()=>{
 const rows=[{id:1,aktivitas:'Ecer Pupuk',hasil_ha:.2},{id:2,aktivitas:'Tanam',hasil_ha:.3}];
 assert.deepEqual(visibleActivityRows(rows).map(r=>r.id),[2]);assert.equal(rows.length,2);assert.equal(rows[0].hasil_ha,.2);
 assert.ok(ACTIVITY.Pisang.some(([name])=>name==='Ecer Pupuk'));
});
