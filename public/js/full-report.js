// Unduh laporan pertanggungjawaban lengkap (Excel). Tombol hanya untuk admin / peran "Unduh Laporan Lengkap";
// server tetap memeriksa izin. Periode dipilih dulu (awal: 1 Januari tahun ini s.d. hari ini).
export const canFullReport=A=>!!A?.me?.()&&(A.isAdmin?.()||(A.me()?.peran||[]).includes('unduh_laporan'));
export function fullReportControl(host,A){
  if(!host)return;if(!canFullReport(A)){host.innerHTML='';return;}
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
  host.innerHTML=`<button class="btn" type="button" data-fr-open>📥 Unduh Laporan Lengkap</button><div class="full-report" data-fr-panel hidden><b>Laporan pertanggungjawaban lengkap (Excel)</b><label>Dari <input type="date" data-fr-from value="${today.slice(0,4)}-01-01"></label><label>Sampai <input type="date" data-fr-to value="${today}"></label><button class="btn primary" type="button" data-fr-go>Unduh Excel</button><small data-fr-status role="status"></small></div>`;
  const $=s=>host.querySelector(s),status=$('[data-fr-status]'),go=$('[data-fr-go]');
  $('[data-fr-open]').onclick=()=>{$('[data-fr-panel]').hidden=!$('[data-fr-panel]').hidden;};
  go.onclick=async()=>{const from=$('[data-fr-from]').value,to=$('[data-fr-to]').value;if(!from||!to||from>to){status.textContent='Periksa periode Dari–Sampai.';return;}
    go.disabled=true;status.textContent='Menyiapkan laporan lengkap… (bisa beberapa detik)';
    try{const r=await fetch('/api/reports/lengkap.xlsx?'+new URLSearchParams({from,to}));if(!r.ok){let e='Laporan belum dapat dibuat';try{e=(await r.json()).error||e;}catch{}throw new Error(e);}
      const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`Laporan Lengkap Kebun ${from} sd ${to}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);status.textContent='✓ Laporan diunduh — cek folder Download.';}
    catch(e){status.textContent=e.message;A.toast?.(e.message,true);}finally{go.disabled=false;}};
}
