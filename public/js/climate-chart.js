const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v).toLocaleString('id-ID',{maximumFractionDigits:1});
export function climateChartMarkup(period){
 if(!period)return '';
 const records=new Map((period.climate.days||[]).map(d=>[d.tanggal,d])),days=[];
 for(let date=new Date(period.from+'T00:00:00Z');date.toISOString().slice(0,10)<=period.to;date.setUTCDate(date.getUTCDate()+1)){const key=date.toISOString().slice(0,10);days.push({tanggal:key,...records.get(key)});}
 const chart=(field,title,unit,bars)=>{
  const values=days.filter(d=>d[field]!=null&&Number.isFinite(Number(d[field])));
  if(!values.length)return `<article><h3>${title}</h3><p class="muted">Belum ada pengamatan pada bulan ini.</p></article>`;
  const max=Math.max(1,...values.map(d=>Number(d[field])))*1.15,w=900,h=240,left=48,bottom=205,top=20,step=(w-left-20)/Math.max(1,days.length),y=v=>bottom-Number(v)/max*(bottom-top);
  let marks='',line=[];const flush=()=>{if(line.length)marks+=`<polyline points="${line.join(' ')}" fill="none" stroke="#d18021" stroke-width="2.5"/>`;line=[];};
  days.forEach((d,i)=>{const x=left+step*(i+.5),v=d[field];if(v==null){flush();marks+=`<path d="M${x-3} ${bottom-3}l6 6m0 -6l-6 6" stroke="#9aa5a0"><title>${d.tanggal}: belum tercatat</title></path>`;}else if(bars){marks+=`<rect x="${x-step*.3}" y="${y(v)}" width="${step*.6}" height="${Math.max(1,bottom-y(v))}" fill="#438faa"><title>${d.tanggal}: ${num(v)} ${unit}</title></rect>`;}else{line.push(`${x},${y(v)}`);marks+=`<circle cx="${x}" cy="${y(v)}" r="3" fill="#d18021"><title>${d.tanggal}: ${num(v)} ${unit}</title></circle>`;}if(i===0||i===days.length-1||i%5===0)marks+=`<text x="${x}" y="229" text-anchor="middle" font-size="12">${d.tanggal.slice(8)}</text>`;});flush();
  return `<article><h3>${title}</h3><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${title} ${esc(period.from)} sampai ${esc(period.to)}"><text x="8" y="18" font-size="12">${unit}</text>${[0,.5,1].map(f=>`<line x1="${left}" x2="880" y1="${y(max*f)}" y2="${y(max*f)}" stroke="#e0e7e2"/><text x="40" y="${y(max*f)+4}" text-anchor="end" font-size="12">${num(max*f)}</text>`).join('')}${marks}</svg><p class="small muted">${values.length} hari tercatat dari ${days.length} hari. Tanda × = belum tercatat.</p></article>`;
 };
 return `<section class="sum-panel climate-charts"><div class="sum-section-head"><h2>Grafik iklim · bulan ini</h2><span>${esc(period.from)} – ${esc(period.to)}</span></div>${chart('hujan','Curah hujan harian','mm',true)}${chart('tavg','Suhu rata-rata harian','°C',false)}<p class="small muted">Hari tanpa pengamatan tidak dianggap nol. Suhu dan curah hujan memakai grafik serta satuan terpisah.</p></section>`;
}
