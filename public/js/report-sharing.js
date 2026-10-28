import {reportWeek} from './report-week.js';
// Daily Report sebagai gambar JPEG (langsung terlihat di chat WhatsApp). Klik 1: siapkan + pratinjau; klik 2: bagikan
// (navigator.share butuh klik pengguna yang baru, sama seperti tombol PDF).
// Tombol mandiri untuk halaman publik (kartu laporan selesai, tanpa login): laporan sudah ada di halaman, tidak diambil ulang.
export function imageShareButton(container,A,options){
  container.innerHTML='<button class="btn primary" data-img>Bagikan gambar ke WhatsApp</button><small data-share-status role="status"></small><div class="dr-img-preview" data-img-preview hidden></div>';
  imageShare(container,A,options);
}
// options.buat (opsional) = async () => ({files, text}) untuk gambar selain realisasi (mis. rencana kerja harian)
function imageShare(container,A,options){
  const button=container.querySelector('[data-img]'),status=container.querySelector('[data-share-status]'),preview=container.querySelector('[data-img-preview]'),label=button.textContent;
  let files=null,preparing=false,text='';
  const caption=()=>text||`DAILY REPORT ${options.divisi?options.divisi.toUpperCase()+' ':''}${options.from===options.to?options.from:options.from+' s.d. '+options.to}`;
  button.onclick=async()=>{
    if(preparing)return;
    if(!files&&options.buat){preparing=true;button.disabled=true;status.textContent='Menyiapkan gambar…';try{
      ({files,text}=await options.buat());
      preview.innerHTML=files.map(f=>`<img alt="${f.name}" src="${URL.createObjectURL(f)}">`).join('');preview.hidden=false;
      status.textContent=`${files.length} gambar siap. Klik sekali lagi untuk memilih WhatsApp.`;button.textContent='Kirim gambar · pilih WhatsApp';
    }catch(e){files=null;status.textContent=e.message||'Gambar belum dapat dibuat';}finally{preparing=false;button.disabled=false;}return;}
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
  return {reset(){files=null;text='';preview.hidden=true;preview.innerHTML='';status.textContent='';button.textContent=label;}};
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Rencana kerja harian dari Rencana Mingguan → gambar + teks WhatsApp (default: besok). Hanya divisi milik akun ini.
// Rencana mingguan tidak dikerjakan semua setiap hari: mandor mencentang kegiatan/blok untuk tanggal itu sebelum gambar dibuat.
// Semua dicentang manual (tidak ada centang otomatis). Kegiatan rutin (siram, semprot, pupuk, …) selalu tampil, tidak disembunyikan.
export function planShare(container,A,divisions){
  if(!container||!divisions?.length){if(container)container.innerHTML='';return;}
  const besok=new Date(Date.now()+7*3600e3+864e5).toISOString().slice(0,10);
  container.innerHTML=`<div class="plan-share"><b>Bagikan rencana kerja harian ke WhatsApp</b><label>Tanggal <input type="date" data-plan-date value="${besok}"></label>${divisions.length>1?`<label>Divisi <select data-plan-div>${divisions.map(d=>`<option>${d}</option>`).join('')}</select></label>`:''}<button class="btn" type="button" data-plan-load>Pilih kegiatan</button><div class="plan-pick" data-plan-rows hidden></div><button class="btn primary" type="button" data-img hidden>Siapkan gambar rencana</button><small data-share-status role="status"></small><div class="dr-img-preview" data-img-preview hidden></div></div>`;
  const $=s=>container.querySelector(s),$$=s=>[...container.querySelectorAll(s)],tgl=()=>$('[data-plan-date]').value,div=()=>$('[data-plan-div]')?.value||divisions[0];
  let data=null;
  const chosen=()=>data?data.rows.filter((r,i)=>$(`[data-plan-row="${i}"]`)?.checked):[];
  const ctl=imageShare(container,A,{buat:async()=>{
    const rows=chosen();if(!rows.length)throw new Error('Centang minimal satu kegiatan yang dikerjakan tanggal ini.');
    const {planShareText,planImages}=await import('./report-image.js');
    return {text:planShareText({divisi:data.d,tanggal:data.t,rows,catatan:data.plan.catatan}),files:await planImages({divisi:data.d,tanggal:data.t,rows,catatan:data.plan.catatan,name:A.settings?.().nama||'PT VIGU FARM INDONESIA',createdBy:A.me?.()?.nama||A.me?.()?.username||''})};
  }});
  // Centang kegiatan = semua bloknya; tanda setengah bila hanya sebagian blok dipilih. Gambar lama dibuang bila pilihan berubah.
  const sync=()=>{for(const g of $$('[data-plan-grp-all]')){const rows=$$(`[data-plan-grp="${g.dataset.planGrpAll}"]`),n=rows.filter(r=>r.checked).length;g.checked=n===rows.length;g.indeterminate=n>0&&n<rows.length;}
    const n=chosen().length;$('[data-plan-count]').textContent=`${n} dari ${data.rows.length} pekerjaan dipilih`;ctl.reset();};
  const clear=()=>{data=null;ctl.reset();$('[data-plan-rows]').hidden=true;$('[data-plan-rows]').innerHTML='';$('[data-img]').hidden=true;};
  $('[data-plan-load]').onclick=async()=>{
    const t=tgl(),d=div(),box=$('[data-plan-rows]');clear();const status=$('[data-share-status]');if(!t){status.textContent='Pilih tanggal rencana.';return;}
    status.textContent='Memuat rencana mingguan…';try{
      const {from}=reportWeek(t),[plans,laporan]=await Promise.all([A.api.get('/api/daily/plans?'+new URLSearchParams({week:t,divisi:d})),A.api.get('/api/daily?'+new URLSearchParams({from,to:t,divisi:d}))]);
      const plan=plans.find(p=>p.divisi===d);if(!plan)throw new Error(`Belum ada rencana mingguan ${d} untuk minggu mulai ${from}. Buat dulu di Rencana Mingguan.`);
      const {rencanaHarian,targetRencana}=await import('./report-image.js'),rows=rencanaHarian({plan,divisi:d,tanggal:t,laporan});
      if(!rows.length)throw new Error(`Semua pekerjaan rencana ${d} minggu ini sudah selesai dilaporkan.`);
      if(t!==tgl()||d!==div())return;
      data={t,d,plan,rows};const acts=[...new Set(rows.map(r=>r.aktivitas))];
      box.innerHTML=`<div class="plan-pick-head"><span>Centang yang dikerjakan tanggal ${esc(t)}</span><button type="button" class="btn sm" data-plan-all>Semua</button><button type="button" class="btn sm" data-plan-none>Kosongkan</button></div>${acts.map((a,g)=>`<fieldset class="plan-pick-group"><legend><label><input type="checkbox" data-plan-grp-all="${g}"> <b>${esc(a)}</b></label></legend>${rows.map((r,i)=>r.aktivitas===a?`<label><input type="checkbox" data-plan-row="${i}" data-plan-grp="${g}"> <b>${esc(r.blok)}</b> · ${esc(targetRencana(r))}${r.keterangan?` · ${esc(r.keterangan)}`:''}</label>`:'').join('')}</fieldset>`).join('')}<small data-plan-count></small>`;
      box.hidden=false;$('[data-img]').hidden=false;sync();
    }catch(e){status.textContent=e.message;}};
  $('[data-plan-rows]').onchange=e=>{const g=e.target.dataset.planGrpAll;if(g!=null)for(const r of $$(`[data-plan-grp="${g}"]`))r.checked=e.target.checked;sync();};
  $('[data-plan-rows]').onclick=e=>{const all=e.target.closest('[data-plan-all]'),none=e.target.closest('[data-plan-none]');if(!all&&!none)return;for(const r of $$('[data-plan-row]'))r.checked=!!all;sync();};
  $$('[data-plan-date],[data-plan-div]').forEach(el=>el.onchange=clear);
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
