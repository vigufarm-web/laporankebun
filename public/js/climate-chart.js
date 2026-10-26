const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v).toLocaleString('id-ID',{maximumFractionDigits:1});
const valid=v=>v!=null&&v!==''&&Number.isFinite(Number(v));
export function climateChartMarkup(period){
 if(!period)return '';
 const records=new Map((period.climate.days||[]).map(d=>[d.tanggal,d])),days=[];
 for(let date=new Date(period.from+'T00:00:00Z');date.toISOString().slice(0,10)<=period.to;date.setUTCDate(date.getUTCDate()+1)){const key=date.toISOString().slice(0,10);days.push({tanggal:key,...records.get(key)});}
 const rain=days.filter(d=>valid(d.hujan)),temp=days.filter(d=>valid(d.tavg));
 const head=`<div class="sum-section-head"><div><h2>Curah hujan & suhu</h2><p class="small muted">Pengamatan harian · bulan ini</p></div><span>${esc(period.from)} – ${esc(period.to)}</span></div>`;
 if(!rain.length&&!temp.length)return `<section class="sum-panel climate-charts">${head}<p class="sum-empty">Belum ada pengamatan pada bulan ini.</p></section>`;
 const w=900,h=300,left=56,right=842,top=34,bottom=246,step=(right-left)/Math.max(1,days.length);
 const rainMax=Math.max(5,Math.ceil(Math.max(0,...rain.map(d=>Number(d.hujan)))*1.15/5)*5);
 const temps=temp.map(d=>Number(d.tavg)),tmin=temp.length?Math.floor((Math.min(...temps)-2)/5)*5:20,tmax=temp.length?Math.ceil((Math.max(...temps)+2)/5)*5:40;
 const ry=v=>bottom-Number(v)/rainMax*(bottom-top),ty=v=>bottom-(Number(v)-tmin)/(tmax-tmin)*(bottom-top);
 let bars='',points='',missing='',labels='',segments=[],line=[];
 const flush=()=>{if(line.length>1)segments.push(`<polyline points="${line.join(' ')}" fill="none" stroke="#d87724" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);line=[];};
 days.forEach((d,i)=>{
  const x=left+step*(i+.5),date=esc(d.tanggal);
  if(valid(d.hujan)){const v=Number(d.hujan),y=ry(v);bars+=v===0?`<path d="M${x-3} ${bottom}h6" stroke="#318cab" stroke-width="2"><title>${date}: 0 mm</title></path>`:`<rect x="${x-step*.28}" y="${y}" width="${step*.56}" height="${bottom-y}" rx="3" fill="#67aec4" opacity=".85"><title>${date}: ${num(v)} mm</title></rect>`;}
  else missing+=`<text x="${x}" y="${bottom+13}" text-anchor="middle" font-size="11" class="climate-missing">×<title>${date}: belum tercatat (curah hujan)</title></text>`;
  if(valid(d.tavg)){const y=ty(d.tavg);line.push(`${x},${y}`);points+=`<circle cx="${x}" cy="${y}" r="3.5" fill="#fff" stroke="#d87724" stroke-width="2"><title>${date}: ${num(d.tavg)} °C</title></circle>`;}
  else {flush();missing+=`<text x="${x}" y="${top-8}" text-anchor="middle" font-size="11" class="climate-missing">×<title>${date}: belum tercatat (suhu)</title></text>`;}
  if(days.length<=10||i===0||i===days.length-1||i%5===0)labels+=`<text x="${x}" y="279" text-anchor="middle" font-size="12">${d.tanggal.slice(8)}</text>`;
 });flush();
 const grid=[0,.25,.5,.75,1].map(f=>{const y=bottom-f*(bottom-top);return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#e4ebe6" stroke-dasharray="3 5"/><text x="${left-12}" y="${y+4}" text-anchor="end" font-size="11">${num(rainMax*f)}</text><text x="${right+12}" y="${y+4}" font-size="11">${num(tmin+(tmax-tmin)*f)}</text>`;}).join('');
 const total=rain.reduce((s,d)=>s+Number(d.hujan),0),avg=temp.length?temps.reduce((s,v)=>s+v,0)/temp.length:null;
 return `<section class="sum-panel climate-charts">${head}<div class="climate-overview"><div><span>Total hujan</span><strong>${rain.length?num(total)+' <small>mm</small>':'Belum tercatat'}</strong><small>${rain.length} / ${days.length} hari tercatat</small></div><div><span>Suhu rata-rata</span><strong>${avg!=null?num(avg)+' <small>°C</small>':'Belum tercatat'}</strong><small>${temp.length} / ${days.length} hari tercatat</small></div></div><div class="climate-legend"><span><i class="climate-rain-key"></i>Curah hujan · mm (kiri)</span><span><i class="climate-temp-key"></i>Suhu rata-rata harian · °C (kanan)</span></div><div class="climate-plot" tabindex="0" role="region" aria-label="Grafik gabungan curah hujan dan suhu, geser untuk melihat tanggal"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Curah hujan harian dan suhu rata-rata harian ${esc(period.from)} sampai ${esc(period.to)}"><text x="${left}" y="16" font-size="12">Hujan (mm)</text><text x="${right}" y="16" text-anchor="end" font-size="12">Suhu (°C)</text>${grid}${bars}${segments.join('')}${points}${missing}${labels}</svg></div><p class="small muted">Tanggal pengamatan · × = belum tercatat. Garis suhu terputus saat data kosong; hujan 0 mm tetap dihitung sebagai pengamatan.</p></section>`;
}
