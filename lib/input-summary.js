import {salesReceivables} from './sales-receivables.js';
import {reportWeek} from './report-week.js';
const num=v=>Number(v)||0;
export function inputRows(table,rows){
 if(table!=='padi_penjualan')return rows;
 return rows.filter(r=>['Penjualan','Retur','Ongkir'].includes(r.tipe||'Penjualan')&&(!r.jenis||r.jenis==='Beras'));
}
export function inputSummary({tables,rowsOf,TABLES,today}){
 const week=reportWeek(today),year=Number(today.slice(0,4)),month=today.slice(0,7);
 return {today,tables:tables.map(table=>{
  const rows=inputRows(table,rowsOf(table)),date=TABLES[table].date,sales=table.endsWith('_penjualan');
  const metrics=sales?[{key:'amount',label:'Nilai baris (Rp)'},...(table==='pisang_penjualan'?[{key:'box',label:'Box'}]:[]),{key:'kg',label:'Berat (kg)'}]:[];
  const aggregate=rs=>({rows:rs.length,...(sales?{documents:new Set(rs.map(r=>r.no_sj?String(r[date]||'')+'|'+String(r.no_sj).trim():'').filter(Boolean)).size,amount:rs.reduce((s,r)=>s+(r.nominal!=null&&r.nominal!==''?num(r.nominal):table==='pisang_penjualan'?num(r.harga)*(num(r.jumlah_box)||num(r.berat_kg)):num(r.harga_kg)*num(r.berat_kg)),0),box:rs.reduce((s,r)=>s+num(r.jumlah_box),0),kg:rs.reduce((s,r)=>s+num(r.berat_kg),0)}:{})});
  const dated=(from,to)=>rows.filter(r=>date&&String(r[date]||'').slice(0,10)>=from&&String(r[date]||'').slice(0,10)<=to);
  const periods=[['week','Minggu ini',week.from,today],['month','Bulan ini',month+'-01',today],['year','Tahun ini',year+'-01-01',today],['previous','Tahun lalu',(year-1)+'-01-01',(year-1)+'-12-31']].map(([key,label,from,to])=>({key,label,from,to,...aggregate(dated(from,to))}));
  periods.push({key:'all',label:'Semua periode',...aggregate(rows)});
  const months=new Map();for(const r of rows){const ym=String(r[date]||'').slice(0,7);if(/^\d{4}-\d{2}$/.test(ym)){if(!months.has(ym))months.set(ym,[]);months.get(ym).push(r);}}
  return {...(sales?{receivables:salesReceivables(table,rows,today)}:{}),table,title:table==='padi_penjualan'?'Penjualan Beras':table==='pisang_penjualan'?'Penjualan Pisang':TABLES[table].title,date:date||null,metrics,sales,undated:rows.filter(r=>!date||!r[date]).length,periods,months:[...months].sort((a,b)=>b[0].localeCompare(a[0])).map(([month,rs])=>({month,...aggregate(rs)}))};
 })};
}
