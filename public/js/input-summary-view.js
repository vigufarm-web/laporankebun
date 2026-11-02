import {receivablesMarkup} from './sales-receivables-view.js';
export async function renderInputSummary(host,A){
 try{
  const data=await A.api.get('/api/excel/summary');if(!host?.isConnected)return;
  const esc=A.esc,num=v=>Number(v||0).toLocaleString('id-ID',{maximumFractionDigits:2});
  host.innerHTML=`<h3>Ringkasan untuk crosscheck</h3><p class="small muted">Sampai ${esc(data.today)} · jumlah baris mengikuti sheet Excel; surat jalan dihitung per tanggal dan nomor, bukan jumlah pembayaran. Total mencakup data tanpa tanggal; rekap periode hanya memakai tanggal transaksi.</p><label>Pilih data <select id="inputSummaryTable">${data.tables.map((t,i)=>`<option value="${i}">${esc(t.title)}</option>`).join('')}</select></label><div id="inputSummaryBody"></div>`;
  const select=host.querySelector('select'),body=host.querySelector('#inputSummaryBody');
  const render=()=>{const t=data.tables[Number(select.value)];if(!t){body.textContent='Belum ada data sesuai akses.';return;}
   const headers=['Periode','Baris',...(t.sales?['Surat jalan',...t.metrics.map(m=>m.label)]:[])];
   const cells=p=>[esc(p.label),num(p.rows),...(t.sales?[num(p.documents),...t.metrics.map(m=>num(p[m.key]))]:[])];
   const table=rows=>`<div class="table-wrap" style="max-height:340px;overflow:auto"><table class="data"><thead style="position:sticky;top:0;background:#e8f0ea"><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(p=>`<tr>${cells(p).map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
   body.innerHTML=`<div class="hub-links" style="margin:12px 0"><label>Bulan <input type="month" id="crossMonth" value="${esc(data.today.slice(0,7))}"></label><label>Periode <select id="crossPart"><option value="full">Sebulan penuh</option><option value="first">Tanggal 1–15</option><option value="second">Tanggal 16–akhir bulan</option></select></label></div><div id="crossSelected"></div>`+table(t.periods)+`<details style="margin-top:12px"><summary>Rincian tiap bulan (${t.months.length} bulan)</summary>${table(t.months.map(m=>({...m,label:m.month})))}</details><p class="small muted">${t.sales?'Nilai baris dijumlah sesuai nominal pada Excel; mutasi GKG ke PH tidak masuk Penjualan Beras.':'Jumlah baris digunakan untuk crosscheck; luasan, saldo, atau kegiatan berulang tidak dijumlah sembarangan.'}${t.undated?' '+num(t.undated)+' baris tanpa tanggal hanya masuk Semua periode.':''}</p>`;
   const month=body.querySelector('#crossMonth'),part=body.querySelector('#crossPart');
   const showSelected=()=>{const p=t.selectedPeriods?.find(p=>p.month===month.value&&p.part===part.value);body.querySelector('#crossSelected').innerHTML=table([p?{...p,label:p.from+' s.d. '+p.to}:{label:month.value+' · Tidak ada transaksi',rows:0}])+`<p class="small muted">Periode mengikuti tanggal surat jalan. Dibayar adalah pembayaran yang tercatat untuk SJ tersebut, bukan penerimaan kas berdasarkan tanggal transfer. Sisa tagihan tidak dikurangi saldo lebih bayar dari SJ lain.</p>`;};month.onchange=part.onchange=showSelected;showSelected();
   if(t.receivables){body.insertAdjacentHTML('beforeend',receivablesMarkup(t.receivables,esc,num));const search=body.querySelector('.ar-search');if(search)search.oninput=()=>body.querySelectorAll('.ar-buyer').forEach(row=>row.hidden=!row.dataset.buyer.includes(search.value.trim().toLocaleLowerCase('id-ID')));}
  };select.onchange=render;render();
 }catch(e){if(host?.isConnected)host.textContent='Ringkasan belum dapat dimuat: '+e.message;}
}
