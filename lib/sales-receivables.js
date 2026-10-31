import {gudangDariSJ} from '../public/js/schema.js';
const numeric=v=>Number.isFinite(Number(v))?Number(v):0;
const cents=v=>Math.round(numeric(v)*100),money=v=>v/100;
const nameKey=v=>String(v||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID');
const bananaNom=r=>r.nominal!=null&&r.nominal!==''?numeric(r.nominal):numeric(r.harga)*(numeric(r.jumlah_box)||numeric(r.berat_kg));
const riceNom=r=>r.nominal!=null&&r.nominal!==''?numeric(r.nominal):numeric(r.harga_kg)*numeric(r.berat_kg);
export function salesReceivables(table,rows,today){
 const nominal=table==='pisang_penjualan'?bananaNom:riceNom,ledger=new Map(),warnings={missingBuyer:0,missingDocument:0,paymentNotRecorded:0,positiveReturns:0,overpaidDocuments:0};
 const eligible=rows.filter(r=>['Penjualan','Retur','Ongkir'].includes(r.tipe||'Penjualan')&&(table!=='padi_penjualan'||!r.jenis||r.jenis==='Beras')&&(!r.tanggal||String(r.tanggal).slice(0,10)<=today));
 for(const [i,r]of eligible.entries()){
  const buyer=String(r.pembeli||'').trim().replace(/\s+/g,' ')||'Pembeli belum diisi',date=String(r.tanggal||'').slice(0,10),sj=String(r.no_sj||'').trim(),warehouse=String(r.gudang||'').trim()||gudangDariSJ(sj)||'';
  const key=sj?[nameKey(buyer),date,sj.toUpperCase(),warehouse.toUpperCase()].join('|'):'row:'+(r.id??i);
  let d=ledger.get(key);if(!d){d={buyer,date:date||null,no_sj:sj||null,warehouse:warehouse||null,amountCents:0,paidCents:0,salesCents:0,shippingCents:0,rows:0,paymentRecorded:false};ledger.set(key,d);}
  const amount=cents(nominal(r));d.amountCents+=amount;d.paidCents+=cents(r.dibayar);d.rows++;if(r.tipe==='Ongkir')d.shippingCents+=amount;else d.salesCents+=amount;
  if(r.dibayar!=null&&r.dibayar!=='')d.paymentRecorded=true;
  if(!r.pembeli?.trim())warnings.missingBuyer++;if(!sj)warnings.missingDocument++;if(r.dibayar==null||r.dibayar==='')warnings.paymentNotRecorded++;if(r.tipe==='Retur'&&amount>0)warnings.positiveReturns++;
 }
 const documents=[...ledger.values()].map(d=>{const balance=d.amountCents-d.paidCents,age=d.date&&Number.isFinite(Date.parse(d.date))?Math.max(0,Math.floor((Date.parse(today)-Date.parse(d.date))/86400000)):null;if(balance<0)warnings.overpaidDocuments++;return {buyer:d.buyer,date:d.date,no_sj:d.no_sj,warehouse:d.warehouse,rows:d.rows,amount:money(d.amountCents),sales:money(d.salesCents),shipping:money(d.shippingCents),paid:money(d.paidCents),outstanding:money(Math.max(0,balance)),credit:money(Math.max(0,-balance)),balance:money(balance),age_days:age,status:balance<=0?(balance<0?'Saldo lebih bayar / kredit':'Lunas'):d.paidCents>0?'Dibayar sebagian':d.paymentRecorded?'Belum bayar':'Pembayaran belum tercatat'};});
 const byBuyer=new Map();for(const d of documents){const key=nameKey(d.buyer);let b=byBuyer.get(key);if(!b){b={buyer:d.buyer,amount:0,paid:0,outstanding:0,credit:0,open_documents:0,oldest:null,age_buckets:[0,0,0,0,0],documents:[]};byBuyer.set(key,b);}for(const k of ['amount','paid','outstanding','credit'])b[k]+=d[k];if(d.outstanding>0){b.open_documents++;if(d.date&&(!b.oldest||d.date<b.oldest))b.oldest=d.date;const bucket=d.age_days==null?4:d.age_days<=30?0:d.age_days<=60?1:d.age_days<=90?2:3;b.age_buckets[bucket]+=d.outstanding;}if(d.outstanding>0||d.credit>0)b.documents.push(d);}
 const buyers=[...byBuyer.values()].filter(b=>b.outstanding>0||b.credit>0).map(b=>({...b,documents:b.documents.sort((a,z)=>(a.date||'9999').localeCompare(z.date||'9999'))})).sort((a,b)=>b.outstanding-a.outstanding||a.buyer.localeCompare(b.buyer,'id'));
 const sum=(ds,k)=>money(ds.reduce((s,d)=>s+cents(d[k]),0)),month=today.slice(0,7),periods=[['month','Bulan ini',month+'-01',today],['year','Tahun ini',today.slice(0,4)+'-01-01',today],['all','Seluruh data',null,today]].map(([key,label,from,to])=>{const ds=documents.filter(d=>!from||d.date&&d.date>=from&&d.date<=to);return {key,label,documents:ds.length,sales:sum(ds,'sales'),shipping:sum(ds,'shipping'),billed:sum(ds,'amount'),paid:sum(ds,'paid'),outstanding:sum(ds,'outstanding')};});
 return {as_of:today,periods,totals:{billed:sum(documents,'amount'),paid:sum(documents,'paid'),outstanding:sum(documents,'outstanding'),credit:sum(documents,'credit'),open_documents:documents.filter(d=>d.outstanding>0).length,buyers_with_outstanding:buyers.filter(b=>b.outstanding>0).length},buyers,warnings};
}
