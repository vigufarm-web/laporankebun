import {salesReceivables} from './sales-receivables.js';
import {gudangDariSJ} from '../public/js/schema.js';

const num=v=>Number.isFinite(Number(v))?Number(v):0;
const dateOf=r=>String(r.tanggal||'').slice(0,10);
const money='"Rp" #,##0.##;[Red]("Rp" #,##0.##);"Rp" 0';
const fill=argb=>({type:'pattern',pattern:'solid',fgColor:{argb}});

function formatSalesReport(wb,table,summary,buyers,details){
  const detail=wb.getWorksheet(table==='pisang_penjualan'?'Pisang - Penjualan':'Padi - Penjualan');
  if(detail){
    detail.getColumn(1).hidden=true;detail.getColumn(2).hidden=true;
    detail.views=[{state:'frozen',ySplit:1,showGridLines:false}];
    detail.getRow(1).height=36;
    const widths={'Tanggal SJ *':15,'No. Surat Jalan':33,'Asal Gudang':16,'Pembeli':30,'Jenis Barang':37,'Keterangan':48};
    detail.getRow(1).eachCell((c,i)=>{const col=detail.getColumn(i);col.width=widths[String(c.value)]||Math.min(26,Math.max(13,col.width||14));c.fill=fill('FF24583A');c.font={name:'Calibri',size:10,bold:true,color:{argb:'FFFFFFFF'}};c.alignment={vertical:'middle',wrapText:true};});
    for(let n=2;n<=detail.rowCount;n++)detail.getRow(n).eachCell({includeEmpty:true},(c,i)=>{c.fill=fill(n%2?'FFF3F7F2':'FFFFFFFF');c.font={name:'Calibri',size:10,color:{argb:'FF22352A'}};c.alignment={vertical:'middle',wrapText:i===6};});
    detail.getRow(1).eachCell((c,i)=>{if(/nominal|harga|dibayar|total/i.test(String(c.value)))detail.getColumn(i).numFmt=money;});
  }
  for(const ws of [summary,buyers,details]){
    ws.views=[{state:'frozen',ySplit:ws===summary?6:1,showGridLines:false}];
    ws.properties.tabColor={argb:ws===summary?'FF24583A':'FF6B936C'};
    ws.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,showGridLines:false};
    ws.eachRow((row,n)=>{if(ws!==summary&&n>1){row.height=21;row.eachCell({includeEmpty:true},c=>{c.fill=fill(n%2?'FFF3F7F2':'FFFFFFFF');c.font={name:'Calibri',size:10,color:{argb:'FF22352A'}};c.alignment={vertical:'middle'};});}});
  }
  summary.getRow(1).height=34;summary.getCell('A1').font={name:'Calibri',bold:true,size:17,color:{argb:'FF24583A'}};
  for(let n=7;n<=summary.rowCount;n++)if(n!==14&&n!==15){const row=summary.getRow(n);row.height=23;row.eachCell({includeEmpty:true},c=>{c.fill=fill(n%2?'FFF3F7F2':'FFFFFFFF');c.font={name:'Calibri',size:10,color:{argb:'FF22352A'}};c.alignment={vertical:'middle'};});}
  summary.getRow(12).eachCell({includeEmpty:true},c=>{c.fill=fill('FFE0ECDD');c.font={name:'Calibri',size:10,bold:true,color:{argb:'FF1E4D30'}};});
  if(detail){detail.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:2,fitToHeight:0};detail.pageSetup.printTitlesRow='1:1';}
  // Laporan ini untuk pemeriksaan; panduan impor Excel tidak relevan di aplikasi Penjualan.
  const guide=wb.getWorksheet('Petunjuk');if(guide)wb.removeWorksheet(guide.id);
  wb.views=[{activeTab:wb.worksheets.indexOf(summary)}];
}

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
  formatSalesReport(wb,table,summary,buyers,details);
  return {summary,buyers,details};
}
