import test from 'node:test';
import assert from 'node:assert/strict';
import {susunRencana} from '../public/js/schema.js';

test('lahan tambahan menunggu semua tahap prioritas sebelumnya', () => {
  const activities=['Land Clearing','Bajak 1','Tanam'];
  const data={
    lahan_blok:['Lama','Akhir Lama','A10','A11','E04e'].map(blok=>({blok,luas_ha:1,peruntukan:'Pisang'})),
    lahan_target:[{blok:'Lama',bulan:'2026-12-01'}, {blok:'Akhir Lama',bulan:'2026-12-01',prioritas:9}, ...['A10','A11','E04e'].map(blok=>({blok,bulan:'2027-01-01',prioritas:10}))],
    lahan_aktivitas:activities.map((aktivitas,i)=>({aktivitas,untuk:'Pisang',urutan:i+1,hari_per_ha:1,tim:1})),
    lahan_harian:[],pisang_blok:[],gis_layer:[]
  };
  const rows=susunRencana({rows:t=>data[t]||[]},'2026-11-10');
  const previous=rows.filter(r=>['Lama','Akhir Lama'].includes(r.blok));
  const additional=rows.filter(r=>['A10','A11','E04e'].includes(r.blok));
  assert.equal(previous.length,6); assert.equal(additional.length,9);
  assert.ok(additional.every(r=>r.mulai>=previous.map(x=>x.selesai).sort().at(-1)));
  const oldEnd=previous.map(r=>r.selesai).sort().at(-1);
  const first=additional.map(r=>r.mulai).sort()[0];
  assert.ok(first>=oldEnd, `${first} mulai sebelum ${oldEnd}`);
  for (const b of ['Lama','Akhir Lama','A10','A11','E04e']) {
    const jobs=rows.filter(r=>r.blok===b);
    assert.deepEqual(jobs.map(r=>r.aktivitas),activities);
    for(let i=1;i<jobs.length;i++) assert.ok(jobs[i].mulai>=jobs[i-1].selesai);
  }
});
