import {salesReceivables} from './sales-receivables.js';
import {gudangDariSJ} from '../public/js/schema.js';

const num=v=>Number.isFinite(Number(v))?Number(v):0;
const dateOf=r=>String(r.tanggal||'').slice(0,10);
const money='#,##0.00;[Red](#,##0.00);0';

// Nomor SJ biasanya berulang tiap bulan dan gudang. Rincian SJ yang sama
// harus berdekatan; nomor kosong diletakkan setelah nomor yang tersedia.
export function compareSalesSJ(a,b){
  const month=r=>/^\d{4}-\d{2}/.test(String(r.tanggal||r.date||''))?String(r.tanggal||r.date).slice(0,7):'9999-99';
  const sj=r=>String(r.no_sj||'').trim();
  const cmp=(x,y)=>String(x||'').localeCompare(String(y||''),'id',{numeric:true,sensitivity:'base'});
  const warehouse=r=>r.gudang||r.warehouse||gudangDariSJ(sj(r))||'';
  return cmp(month(a),month(b)) || cmp(warehouse(a),warehouse(b)) || (sj(a)?0:1)-(sj(b)?0:1) || cmp(sj(a),sj(b)) || cmp(a.tanggal||a.date,b.tanggal||b.date) || cmp(a.pembeli||a.buyer,b.pembeli||b.buyer);
}

// These sheets are snapshots. The editable transaction sheet remains the source of record.
export function addSalesExcelReport(wb,{table,rows,today}){
  if(!['pisang_penjualan','padi_penjualan'].includes(table))throw Error('Tabel bukan penjualan');
  const year=Number(today.slice(0,4)),ym=today.slice(0,7),yearStart=`${year}-01-01`,monthStart=`${ym}-01`;
  const previousStart=`${year-1}-01-01`,previousEnd=`${year-1}-12-31`;
  const available=rows.filter(r=>!dateOf(r)||dateOf(r)<=today);
  const unhandled=available.filter(r=>!['Penjualan','Retur','Ongkir','Sampel','Mutasi Internal'].includes(r.tipe||'Penjualan'));
  const current=available.filter(r=>dateOf(r)>=monthStart&&dateOf(r)<=today);
  const periodRows=(from,to)=>available.filter(r=>dateOf(r)&&dateOf(r)>=from&&dateOf(r)<=to);
  const ledger=salesReceivables(table,available,today);
  const eligibleQty=r=>['Penjualan','Retur'].includes(r.tipe||'Penjualan')&&(table!=='padi_penjualan'||!r.jenis||r.jenis==='Beras');
  const make=(label,rs)=>{const l=salesReceivables(table,rs,today),all=l.periods.find(p=>p.key==='all');return [label,all.documents,all.sales,all.shipping,all.billed,all.paid,all.outstanding,rs.filter(eligibleQty).reduce((s,r)=>s+num(r.jumlah_box),0),rs.filter(eligibleQty).reduce((s,r)=>s+num(r.berat_kg),0)];};
  const summary=wb.addWorksheet('Ringkasan Penjualan',{views:[{state:'frozen',ySplit:6}]});
  summary.columns=[{width:25},{width:16},{width:21},{width:19},{width:21},{width:21},{width:21},{width:15},{width:17}];
  summary.addRow([`RINGKASAN PENJUALAN ${table==='pisang_penjualan'?'PISANG':'BERAS'}`]);
  summary.addRow([`Posisi ${today}; periode mengikuti tanggal SJ, bukan tanggal bayar. Pembayaran adalah total tercatat saat unduh.`]);
  summary.addRow(['Penjualan bersih mencakup retur; tagihan mencakup ongkir. Box dan kg hanya penjualan serta retur.']);
  summary.addRow(['Piutang = sisa positif per SJ. Sampel, mutasi dan tanggal setelah posisi laporan tidak masuk tagihan; tanpa tanggal hanya di semua periode.']);
  summary.addRow([`Ringkasan adalah potret saat unduh dan tidak otomatis berubah saat rincian diedit di Excel.${unhandled.length?' Periksa '+unhandled.length+' baris bertipe lain yang tidak termasuk tagihan.':''}`]);
  summary.addRow(['Periode','Jumlah SJ','Penjualan bersih (Rp)','Ongkir (Rp)','Tagihan (Rp)','Dibayar (Rp)','Sisa tagihan (Rp)','Box','Berat (kg)']);
  const a=ym+'-15',b=ym+'-16',cut=today<a?today:a;
  for(const [label,rs] of [['Bulan ini',current],['Bulan ini 1–15',periodRows(monthStart,cut)],['Bulan ini 16–akhir',today<b?[]:periodRows(b,today)],['Tahun ini',periodRows(yearStart,today)],['Tahun lalu',periodRows(previousStart,previousEnd)],['Semua periode',available]])summary.addRow(make(label,rs));
  const months=[...new Set(available.map(dateOf).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).map(d=>d.slice(0,7)))].sort().reverse();
  summary.addRow([]);summary.addRow(['Rincian per bulan']);summary.addRow(['Periode','Jumlah SJ','Penjualan bersih (Rp)','Ongkir (Rp)','Tagihan (Rp)','Dibayar (Rp)','Sisa tagihan (Rp)','Box','Berat (kg)']);
  for(const m of months)summary.addRow(make(m,available.filter(r=>dateOf(r).startsWith(m+'-'))));
  summary.getRow(1).font={bold:true,size:15,color:{argb:'FF1F5637'}};
  for(const line of [6,15]){const r=summary.getRow(line);r.font={bold:true,color:{argb:'FFFFFFFF'}};r.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2F6B3F'}});r.alignment={wrapText:true,vertical:'middle'};r.height=32;}
  for(let n=7;n<=summary.rowCount;n++)if(n!==14&&n!==15){for(let c=3;c<=7;c++)summary.getCell(n,c).numFmt=money;for(let c=8;c<=9;c++)summary.getCell(n,c).numFmt='#,##0.##';}
  for(let n=2;n<=5;n++){summary.mergeCells(n,1,n,9);summary.getRow(n).alignment={wrapText:true,vertical:'middle'};summary.getRow(n).height=28;}
  summary.mergeCells('A1:I1');
  const buyers=wb.addWorksheet('Piutang Pembeli',{views:[{state:'frozen',ySplit:1}]});
  buyers.columns=[{header:'Pembeli',key:'buyer',width:35},{header:'SJ belum lunas',key:'docs',width:18},{header:'Tagihan (Rp)',key:'amount',width:21},{header:'Dibayar (Rp)',key:'paid',width:21},{header:'Sisa tagihan (Rp)',key:'outstanding',width:23},{header:'Lebih bayar (Rp)',key:'credit',width:21},{header:'Tanggal SJ terlama',key:'oldest',width:22}];
  for(const b of ledger.buyers)buyers.addRow({buyer:b.buyer,docs:b.open_documents,amount:b.amount,paid:b.paid,outstanding:b.outstanding,credit:b.credit,oldest:b.oldest||null});
  const details=wb.addWorksheet('Piutang per SJ',{views:[{state:'frozen',ySplit:1}]});
  details.columns=[{header:'Pembeli',key:'buyer',width:35},{header:'Tanggal SJ',key:'date',width:16},{header:'No. surat jalan',key:'sj',width:34},{header:'Asal gudang',key:'warehouse',width:16},{header:'Penjualan (Rp)',key:'sales',width:20},{header:'Ongkir (Rp)',key:'shipping',width:19},{header:'Tagihan (Rp)',key:'amount',width:20},{header:'Dibayar (Rp)',key:'paid',width:20},{header:'Sisa tagihan (Rp)',key:'outstanding',width:22},{header:'Lebih bayar (Rp)',key:'credit',width:20},{header:'Status',key:'status',width:29},{header:'Umur SJ (hari)',key:'age',width:19}];
  for(const d of ledger.buyers.flatMap(b=>b.documents).sort(compareSalesSJ))details.addRow({buyer:d.buyer,date:d.date,sj:d.no_sj,warehouse:d.warehouse,sales:d.sales,shipping:d.shipping,amount:d.amount,paid:d.paid,outstanding:d.outstanding,credit:d.credit,status:d.status,age:d.age_days});
  for(const ws of [buyers,details]){const h=ws.getRow(1);h.font={bold:true,color:{argb:'FFFFFFFF'}};h.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2F6B3F'}});h.alignment={wrapText:true,vertical:'middle'};h.height=30;ws.autoFilter={from:'A1',to:ws.getCell(1,ws.columnCount).address};}
  for(const col of [3,4,5,6])buyers.getColumn(col).numFmt=money;
  for(const col of [5,6,7,8,9,10])details.getColumn(col).numFmt=money;
  return {summary,buyers,details};
}
