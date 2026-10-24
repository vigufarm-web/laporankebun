import {reportWeek} from './report-week.js';
export function reportActions(container,A,options) {
  if(options.owner)options={...options,...reportWeek(options.to||options.from||new Date(Date.now()+7*3600e3).toISOString().slice(0,10))};
  let file=null,shareText='',preparing=false;
  const params=new URLSearchParams(Object.fromEntries(Object.entries(options).filter(([,v])=>v!=null&&v!==''))),kind=options.owner?'owner':'daily';
  const url=`/api/reports/${kind}.pdf?${params}`;
  container.innerHTML='<a class="btn" data-pdf>↓ Unduh PDF</a><button class="btn" data-share>Bagikan ke WhatsApp</button><small data-share-status role="status"></small>';
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
