import test from 'node:test';import assert from 'node:assert/strict';
import {salesReceivables} from '../lib/sales-receivables.js';
import {gudangDariSJ,lengkapiJual} from '../public/js/schema.js';
import {receivablesMarkup} from '../public/js/sales-receivables-view.js';
test('customer receivables aggregate invoice lines, shipping and returns without netting other customer credits',()=>{
 const rows=[{id:1,pembeli:'PT A',no_sj:'01/SMG',tanggal:'2026-10-01',tipe:'Penjualan',nominal:100,dibayar:30},{id:2,pembeli:'PT A',no_sj:'01/SMG',tanggal:'2026-10-01',tipe:'Ongkir',nominal:10},{id:3,pembeli:'PT A',no_sj:'01/SMG',tanggal:'2026-10-01',tipe:'Retur',nominal:-20},{id:4,pembeli:'PT A',no_sj:'02/SMG',tanggal:'2026-10-02',nominal:20,dibayar:40},{id:5,pembeli:'PT B',no_sj:'03/SMG',tanggal:'2026-09-01',nominal:50},{id:6,pembeli:'INTERNAL',tanggal:'2026-10-01',tipe:'Mutasi Internal',nominal:9999},{id:7,pembeli:'SAMPEL',tanggal:'2026-10-01',tipe:'Sampel',nominal:9999},{id:8,pembeli:'FUTURE',tanggal:'2026-12-01',nominal:9999}],before=JSON.stringify(rows),d=salesReceivables('pisang_penjualan',rows,'2026-10-31');
 assert.equal(d.totals.outstanding,110);assert.equal(d.totals.credit,20);assert.equal(d.totals.open_documents,2);assert.equal(d.buyers.find(b=>b.buyer==='PT A').outstanding,60);assert.equal(d.buyers.find(b=>b.buyer==='PT A').documents[0].rows,3);assert.equal(d.periods[0].sales,100);assert.equal(d.periods[0].shipping,10);assert.equal(d.buyers.find(b=>b.buyer==='PT B').age_buckets[1],50);assert.equal(JSON.stringify(rows),before);
});
test('missing dates and payment records stay distinct from verified nonpayment; unsupported rice transfers excluded',()=>{
 const d=salesReceivables('padi_penjualan',[{id:1,pembeli:'A',nominal:10,jenis:'Beras'},{id:2,pembeli:'B',tanggal:'2026-10-30',nominal:20,dibayar:0,jenis:'Beras'},{id:3,pembeli:'INTERNAL',nominal:999,jenis:'GKG',tipe:'Mutasi Internal'}],'2026-10-31');assert.equal(d.totals.outstanding,30);assert.equal(d.buyers.find(b=>b.buyer==='A').age_buckets[4],10);assert.equal(d.buyers.find(b=>b.buyer==='A').documents[0].status,'Pembayaran belum tercatat');assert.equal(d.buyers.find(b=>b.buyer==='B').documents[0].status,'Belum bayar');assert.equal(d.periods[0].billed,20);
});
test('SJ codes infer only unambiguous warehouses; product classification follows product text',()=>{
 assert.equal(gudangDariSJ('001/SJ/SMG/X/2026'),'SMG');assert.equal(gudangDariSJ('SJ-TEGAL-001'),'TGL');assert.equal(gudangDariSJ('123456'),null);assert.equal(gudangDariSJ('SMG-TGL'),null);
 const old=lengkapiJual({no_sj:'001/SMG',jenis_barang:'PISANG CAVENDISH FH A MATANG'});assert.equal(old.gudang,'SMG');assert.equal(old.kelas,'A');assert.equal(old.kondisi,'Matang');const revised=lengkapiJual({...old,no_sj:'001/TGL'},old);assert.equal(revised.gudang,'TGL');assert.equal(lengkapiJual({...old,gudang:'Manual'},old).gudang,'Manual');
});
test('private summary markup escapes customer names and does not label age as overdue',()=>{
 const d=salesReceivables('pisang_penjualan',[{id:1,pembeli:'<img src=x onerror=alert(1)>',nominal:10}],'2026-10-31'),esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');const html=receivablesMarkup(d,esc,String);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.match(html,/bukan keterlambatan/);assert.match(html,/Pembayaran belum tercatat/);
});
