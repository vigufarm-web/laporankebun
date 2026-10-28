import test from 'node:test';import assert from 'node:assert/strict';
import {dailyImageLayout,dailyShareText,keteranganFoto,rowCells,wrapText,IMG} from '../public/js/report-image.js';
const measure=(s,font)=>String(s).length*(/bold/.test(font)?14:13); // perkiraan lebar huruf tanpa canvas
const item=(i,o={})=>({blok:'D'+String(i).padStart(2,'0'),aktivitas:'Bajak 2',alat:'Traktor',realisasi:0.4+i/100,hasil_sdhi:1.2,satuan:'ha',hk_realisasi:1,target:2.01,...o});
const report=(n,o={})=>({id:1,tanggal:'2026-10-27',divisi:'Pisang',status:'Selesai',kendala:'Hujan sore, traktor berhenti 2 jam.',tindak_lanjut:'Lanjut D04 besok pagi.',items:Array.from({length:n},(_,i)=>item(i+1)),photos:[],...o});
const texts=p=>p.ops.filter(o=>o.t==='text').map(o=>o.s);

test('daily image rows use the same columns and number format as the PDF',()=>{
 assert.deepEqual(rowCells(item(1,{meter_awal:2453.9,meter_akhir:2460.7})),['D01','Bajak 2\nTraktor\nMeter 2.453,9 - 2.460,7','0,41 ha','1,2 ha','1','2,01 ha']);
 assert.deepEqual(rowCells({blok:'P05',aktivitas:'Panen',target_hk_minggu:5}),['P05','Panen','-','-','-','5 HK']);
});
test('every activity, kendala and tindak lanjut appears and each image stays phone-sized',()=>{
 const L=dailyImageLayout({reports:[report(3)],from:'2026-10-27',to:'2026-10-27',divisi:'Pisang',measure});
 assert.equal(L.pages.length,1);const t=texts(L.pages[0]).join('|');
 for(const b of ['D01','D02','D03','Kendala','Hujan sore, traktor berhenti 2 jam.','Tindak lanjut','Daily Report Pisang'])assert.ok(t.includes(b),b);
 assert.ok(L.pages[0].height<=IMG.MAXH*1.25);
});
test('long reports are split into several images and the table header repeats',()=>{
 const L=dailyImageLayout({reports:[report(40)],from:'2026-10-27',to:'2026-10-27',measure});
 assert.ok(L.pages.length>1);
 for(const p of L.pages){assert.ok(p.height<=IMG.MAXH*1.25,'tinggi '+p.height);assert.ok(texts(p).includes('Blok'),'judul kolom di tiap gambar');}
 const blok=L.pages.flatMap(texts).filter(s=>/^D\d\d$/.test(s));assert.equal(blok.length,40,'tidak ada baris hilang atau dobel');
 assert.match(texts(L.pages.at(-1)).at(-1),new RegExp(`Gambar ${L.pages.length}/${L.pages.length}`));
});
test('photos are limited per report, expired photos skipped, rest mentioned',()=>{
 const photos=Array.from({length:7},(_,i)=>({id:i,url:'/api/daily/photo/'+i,caption:'Foto '+i,deleted_at:i===0?'2026-10-20':null}));
 const L=dailyImageLayout({reports:[report(1,{photos})],from:'2026-10-27',to:'2026-10-27',measure});
 assert.equal(L.photos.length,4);assert.ok(!L.photos.some(p=>p.id===0));
 assert.ok(L.pages.flatMap(texts).some(s=>s.includes('+ 2 foto lain')));
});
test('many reports are capped with a note and empty periods say so',()=>{
 const many=Array.from({length:8},(_,i)=>report(1,{id:i,tanggal:'2026-10-2'+i}));
 assert.ok(dailyImageLayout({reports:many,from:'2026-10-20',to:'2026-10-27',measure}).pages.flatMap(texts).some(s=>s.includes('Dan 2 laporan lain')));
 assert.ok(dailyImageLayout({reports:[],from:'2026-10-27',to:'2026-10-27',measure}).pages.flatMap(texts).some(s=>s.includes('Belum ada laporan')));
});
test('all foreman inputs are in the image (no morning-roll times): HK tercatat, mandor, catatan, ritase, keterangan, HK rencana, outside plan',()=>{
 assert.deepEqual(rowCells(item(1,{ritase:12,keterangan:'Tanah basah',di_luar_rencana:1,hk_rencana:2})),['D01','Bajak 2\nTraktor\nRitase 12\n(di luar rencana)\nKet: Tanah basah','0,41 ha','1,2 ha','1\nrnc 2','2,01 ha']);
 const L=dailyImageLayout({reports:[report(2,{apel_mulai:'06:30',apel_selesai:'07:00',apel_hadir:12,apel_catatan:'2 orang izin sakit',dibuat_oleh:'mandor_pisang'})],from:'2026-10-27',to:'2026-10-27',measure});
 const t=L.pages.flatMap(texts).join('|');
 for(const b of ['HK tercatat: 12','Mandor: mandor_pisang','Catatan tenaga kerja','2 orang izin sakit'])assert.ok(t.includes(b),b);
 assert.ok(!/Apel|06.30/.test(t),'jam apel tidak ditampilkan');
});
test('long words are wrapped instead of overflowing the column',()=>{
 const lines=wrapText(measure,'Pengendalian'.repeat(4),100,'25px x');assert.ok(lines.length>1);for(const l of lines)assert.ok(measure(l,'25px x')<=100);
});
test('no image is generated that only carries spacing (every image has report content)',()=>{
 for(const n of [1,5,9,14,20,33]){
  const photos=Array.from({length:3},(_,i)=>({id:i,url:'x'+i,caption:'F'+i}));
  const L=dailyImageLayout({reports:[report(n,{photos})],from:'2026-10-27',to:'2026-10-27',measure});
  for(const p of L.pages)assert.ok(p.ops.some(o=>o.t==='img'||(o.t==='text'&&(/^D\d\d$/.test(o.s)||/Kendala|Tindak lanjut|Hujan|Lanjut|^F\d/.test(o.s)))),'gambar tanpa isi pada '+n+' baris');
 }
});
test('WhatsApp caption summarises the report so the image has a readable description',()=>{
 const s=dailyShareText({reports:[report(10)],from:'2026-10-27',to:'2026-10-27',divisi:'Pisang'});
 assert.match(s,/^\*DAILY REPORT PISANG\* — Selasa, 27 Oktober 2026/);assert.match(s,/• D01 Bajak 2: 0,41 ha \(HK 1\)/);
 assert.match(s,/dan 2 kegiatan lain/);assert.match(s,/Kendala: Hujan sore/);
});
test('photo captions written by the foreman are shown, camera file names are hidden',()=>{
 assert.equal(keteranganFoto({caption:'1000500293.jpg'}),'');assert.equal(keteranganFoto({caption:'IMG_2041.HEIC',jenis:'Sesudah'}),'Sesudah');assert.equal(keteranganFoto({caption:'Bajak D04 sisi timur'}),'Bajak D04 sisi timur');
});
import {rencanaHarian,planShareText,planImageLayout,targetRencana} from '../public/js/report-image.js';
test('daily plan for a date: remaining weekly target for one-off work, per-time target for routine work, finished blocks hidden',()=>{
 const plan={divisi:'Pisang',hk_kegiatan:JSON.stringify([{key:'herbisida spray|ha',hk:4,times:2}]),items:[{id:1,urutan:1,blok:'D04',aktivitas:'Bajak 2',satuan:'ha',target:2},{id:2,urutan:2,blok:'D11',aktivitas:'Bajak 2',satuan:'ha',target:0.84},{id:3,urutan:3,blok:'A05',aktivitas:'Herbisida spray',satuan:'ha',target:1.2,keterangan:'pagi'}]};
 const laporan=[{divisi:'Pisang',status:'Selesai',tanggal:'2026-10-27',items:[{blok:'D04',aktivitas:'Bajak 2',satuan:'ha',realisasi:0.75},{blok:'D11',aktivitas:'Bajak 2',satuan:'ha',realisasi:0.84}]},
  {divisi:'Pisang',status:'Draf',tanggal:'2026-10-28',items:[{blok:'D04',aktivitas:'Bajak 2',satuan:'ha',realisasi:1}]},{divisi:'Pisang',status:'Selesai',tanggal:'2026-10-29',items:[{blok:'D04',aktivitas:'Bajak 2',satuan:'ha',realisasi:1}]}];
 const rows=rencanaHarian({plan,divisi:'Pisang',tanggal:'2026-10-29',laporan});
 assert.deepEqual(rows.map(r=>[r.blok,r.aktivitas,targetRencana(r)]),[['D04','Bajak 2','sisa 1,25 ha dari 2'],['A05','Herbisida spray','0,6 ha (rutin)']],'D11 selesai disembunyikan; draf & laporan di/sesudah tanggal tidak mengurangi');
 const s=planShareText({divisi:'Pisang',tanggal:'2026-10-29',rows,catatan:'Traktor servis jam 13'});
 assert.match(s,/^\*RENCANA KERJA PISANG\* — Kamis, 29 Oktober 2026/);assert.match(s,/• D04 Bajak 2: sisa 1,25 ha dari 2/);assert.match(s,/Catatan: Traktor servis/);
 const L=planImageLayout({divisi:'Pisang',tanggal:'2026-10-29',rows,catatan:'Traktor servis jam 13',measure});
 const t=L.pages.flatMap(texts).join(' ');for(const b of ['Rencana Kerja Pisang','D04','sisa 1,25 ha dari 2','0,6 ha (rutin)','pagi','Catatan rencana'])assert.ok(t.includes(b),b);
 assert.deepEqual(rencanaHarian({plan:null,divisi:'Pisang',tanggal:'2026-10-29'}),[]);
});
