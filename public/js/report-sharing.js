import {reportWeek} from './report-week.js';
// Daily Report sebagai gambar JPEG (langsung terlihat di chat WhatsApp). Klik 1: siapkan + pratinjau; klik 2: bagikan
// (navigator.share butuh klik pengguna yang baru, sama seperti tombol PDF).
// Tombol mandiri untuk halaman publik (kartu laporan selesai, tanpa login): laporan sudah ada di halaman, tidak diambil ulang.
export function imageShareButton(container,A,options){
  container.innerHTML='<button class="btn primary" data-img>Bagikan gambar ke WhatsApp</button><small data-share-status role="status"></small><div class="dr-img-preview" data-img-preview hidden></div>';
  imageShare(container,A,options);
}
function imageShare(container,A,options){
  const button=container.querySelector('[data-img]'),status=container.querySelector('[data-share-status]'),preview=container.querySelector('[data-img-preview]');
  let files=null,preparing=false,text='';
  const caption=()=>text||`DAILY REPORT ${options.divisi?options.divisi.toUpperCase()+' ':''}${options.from===options.to?options.from:options.from+' s.d. '+options.to}`;
  button.onclick=async()=>{
    if(preparing)return;
    if(!files){preparing=true;button.disabled=true;status.textContent='Menyiapkan gambar…';try{
      const {dailyReportImages,dailyShareText}=await import('./report-image.js');
      let reports=options.reports?[...options.reports]:await A.api.get('/api/daily?'+new URLSearchParams(Object.fromEntries(Object.entries({from:options.from,to:options.to,divisi:options.divisi}).filter(([,v])=>v))));
      if(options.reportId)reports=reports.filter(r=>r.id===Number(options.reportId));
      reports.sort((a,b)=>String(a.tanggal).localeCompare(String(b.tanggal))||String(a.divisi).localeCompare(String(b.divisi)));
      if(!reports.length)throw new Error('Belum ada laporan pada periode ini.');
      text=dailyShareText({reports,from:options.from,to:options.to,divisi:options.divisi});files=await dailyReportImages({reports,from:options.from,to:options.to,divisi:options.divisi,name:A.settings?.().nama||'PT VIGU FARM INDONESIA',createdBy:options.createdBy??(A.me?.()?.nama||A.me?.()?.username||'')});
      preview.innerHTML=files.map(f=>`<img alt="${f.name}" src="${URL.createObjectURL(f)}">`).join('');preview.hidden=false;
      status.textContent=`${files.length} gambar siap. Klik sekali lagi untuk memilih WhatsApp.`;button.textContent='Kirim gambar · pilih WhatsApp';
    }catch(e){files=null;status.textContent=e.message||'Gambar belum dapat dibuat';}finally{preparing=false;button.disabled=false;}return;}
    if(navigator.canShare?.({files})&&navigator.share){try{await navigator.share({files,title:'Daily Report',text:caption()});status.textContent='Pilihan berbagi dibuka. Pilih WhatsApp lalu grup/kontak tujuan.';}catch(e){if(e.name!=='AbortError')status.textContent='Berbagi gambar tidak tersedia di perangkat ini. Gambar diunduh — kirim lewat WhatsApp secara manual.';if(e.name!=='AbortError')unduh(files);}}
    else {unduh(files);window.open('https://wa.me/?text='+encodeURIComponent(caption()),'_blank','noopener,noreferrer');status.textContent='Gambar diunduh dan WhatsApp dibuka. Lampirkan gambar yang diunduh (ikon klip/kamera) sebelum mengirim.';}
  };
}
function unduh(files){for(const f of files){const u=URL.createObjectURL(f),a=document.createElement('a');a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500);}}
export function reportActions(container,A,options) {
  if(options.owner)options={...options,...reportWeek(options.to||options.from||new Date(Date.now()+7*3600e3).toISOString().slice(0,10))};
  let file=null,shareText='',preparing=false;
  const params=new URLSearchParams(Object.fromEntries(Object.entries(options).filter(([,v])=>v!=null&&v!==''))),kind=options.owner?'owner':'daily';
  const url=`/api/reports/${kind}.pdf?${params}`;
  container.innerHTML='<a class="btn" data-pdf>↓ Unduh PDF</a><button class="btn" data-share>Bagikan ke WhatsApp</button>'+(kind==='daily'?'<button class="btn primary" data-img>Bagikan gambar ke WhatsApp</button>':'')+'<small data-share-status role="status"></small>'+(kind==='daily'?'<div class="dr-img-preview" data-img-preview hidden></div>':'');
  if(kind==='daily')imageShare(container,A,options);
  const download=container.querySelector('[data-pdf]');download.href=url;download.download=`laporan-${kind}.pdf`;
  const button=container.querySelector('[data-share]'),status=container.querySelector('[data-share-status]');
  button.onclick=async()=>{
    if(preparing)return;
    if(!file){preparing=true;button.disabled=true;status.textContent='Menyiapkan PDF…';try{
      const [pdf,response]=await Promise.all([fetch(url),A.api.get('/api/reports/share?'+params)]);
      if(!pdf.ok){const j=await pdf.json();throw new Error(j.error||'PDF belum dapat dibuat');}
      file=new File([await pdf.blob()],`laporan-${kind}-${options.from||'harian'}.pdf`,{type:'application/pdf'});shareText=response.text;
      status.textContent='PDF siap. Klik sekali lagi untuk memilih WhatsApp.';button.textContent='Bagikan PDF · pilih WhatsApp';
    }catch(e){status.textContent=e.message;}finally{preparing=false;button.disabled=false;}return;}
    if(navigator.canShare?.({files:[file]})&&navigator.share){try{await navigator.share({files:[file],title:'Laporan Kebun',text:shareText});status.textContent='Pilihan berbagi dibuka.';}catch(e){if(e.name!=='AbortError'){status.textContent='Berbagi file tidak tersedia. Gunakan Unduh PDF dan lampirkan ke WhatsApp.';}}}
    else {
      const objectURL=URL.createObjectURL(file),a=document.createElement('a');a.href=objectURL;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(objectURL),1000);
      window.open('https://wa.me/?text='+encodeURIComponent(shareText),'_blank','noopener,noreferrer');
      status.textContent='PDF diunduh dan WhatsApp dibuka dengan ringkasan. Lampirkan PDF yang diunduh sebelum mengirim.';
    }
  };
}
