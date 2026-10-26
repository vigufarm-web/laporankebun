import {dailyHKMarkup} from './daily-hk.js';
import { reportActions } from './report-sharing.js';
import { quickDaily } from './daily-quick.js';
const DIVISI = ['Pisang', 'Padi', 'Infra'];
const ROLE = { Pisang: 'daily_pisang', Padi: 'daily_padi', Infra: 'daily_infra' };
const UNIT = ['ha', 'pokok', 'stem', 'tandan', 'box', 'kg', 'meter', 'rit', 'unit', 'HK', 'HM', 'KM', '%', 'lainnya'];
const ACTIVITY = {
  Pisang: [['Bud injection','stem'],['DnD / marking','stem'],['Steam spray','stem'],['Propping','pokok'],['Bagging','stem'],['SBC','stem'],['Fungisida / insektisida spray','ha'],['Herbisida spray','ha'],['Spray daun anti jamur','ha'],['Deleafing','ha'],['Deleafing & weeding','ha'],['Regular pruning','ha'],['Pemupukan urea','pokok'],['Pemupukan urea tugal','pokok'],['Pemupukan KCl','pokok'],['Aplikasi kapur pertanian','ha'],['Siram irigasi mesin','ha'],['Siram manual','ha'],['Kontrol irigasi dripline','ha'],['Sulam tanam','pokok'],['Pasang stik ridger','ha'],['Bedder','ha'],['Panen','tandan'],['Selector','tandan'],['Penimbangan','kg'],['Final rinsing','tandan'],['Labeling','box'],['Packing','box'],['Vacuum packing','box'],['Siram bibit','unit'],['Grading bibit','unit'],['Tambah media bibit','unit'],['Perawatan paranet','unit'],['Pengawasan','HK']],
  Padi: [['Pengaturan irigasi','ha'],['Pengaturan irigasi & usir burung','ha'],['Pengusiran burung','ha'],['Panen padi','ha'],['Jemur padi','kg'],['Perontokan padi','kg'],['Penimbangan padi','kg'],['Pengangkutan gabah','kg'],['Pengolahan lahan','ha'],['Bajak lahan','ha'],['Perataan lahan','ha'],['Persemaian','kg'],['Tanam padi','ha'],['Penyulaman','ha'],['Pemupukan','ha'],['Penyemprotan','ha'],['Pengendalian OPT','ha'],['Penyiangan','ha'],['Pembersihan saluran','meter'],['Pengawasan','HK']],
  Infra: [['Mobil support operasional kebun','KM'],['Kontrol irigasi dripline','ha'],['Perbaikan irigasi','meter'],['Pembuatan nursery','unit'],['Pembuatan wingwall','unit'],['Pengisian air tandon','rit'],['Pengiriman air','rit'],['Bajak discplough','ha'],['Bajak ridger','ha'],['Land clearing','ha'],['Pembuatan parit','meter'],['Pembersihan parit','meter'],['Loading tanah galian','rit'],['Langsir tanah','rit'],['Perataan tanah','ha'],['Perbaikan jalan','meter'],['Perbaikan listrik','unit'],['Perbaikan pompa','unit'],['Perawatan alat berat','unit'],['Operasional excavator','HM'],['Operasional bulldozer','HM'],['Operasional traktor','HM'],['Operasional dump truck','KM'],['Operasional kendaraan','KM'],['Pekerjaan GIS / pemetaan','ha'],['Pengawasan','HK']],
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const iso = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const fmt = (n) => n == null || n === '' ? '—' : new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(n));
const safe = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const blankItem = () => ({ aktivitas: '', blok: '', target: '', realisasi: '', satuan: 'ha', hk_rencana: '', hk_realisasi: '', alat: '', meter_awal: '', meter_akhir: '', ritase: '', keterangan: '', plan_item_id: null, di_luar_rencana: 1 });
const isDone = (r) => ['Selesai', 'Dikirim'].includes(r.status);

function editableDivisions(A) {
  const u = A.me();
  if (!u) return [];
  if (A.isAdmin()) return DIVISI;
  return DIVISI.filter((d) => (u.peran || []).includes(ROLE[d]));
}

function progress(r) {
  const rows = r.items.filter((x) => Number(x.target) > 0);
  if (!rows.length) return null;
  return rows.reduce((a, x) => a + Math.min(1, Number(x.hasil_sdhi ?? x.realisasi ?? 0) / Number(x.target)), 0) / rows.length;
}

function reportCard(r, canEdit) {
  const p = progress(r), livePhotos = r.photos.filter((x) => !x.deleted_at);
  return `<article class="card dr-card" data-id="${r.id}">
    <div class="dr-card-head"><div><span class="dr-div ${r.divisi.toLowerCase()}">${safe(r.divisi)}</span><h3>${safe(r.dibuat_oleh || 'Data awal')}</h3><div class="small muted">Penginput · ${safe(new Date(r.tanggal + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div></div><span class="st ${isDone(r) ? 'ok' : 'wait'}">${safe(r.status)}</span></div>
    <div class="dr-metrics"><span><b>${r.items.length}</b><small>kegiatan</small></span><span><b>${fmt(r.apel_hadir)}</b><small>HK tercatat</small></span><span><b>${livePhotos.length}</b><small>foto aktif</small></span><span><b>${p == null ? '—' : Math.round(p * 100) + '%'}</b><small>hasil kerja</small></span></div>
    ${r.kendala ? `<div class="dr-alert"><b>Kendala:</b> ${safe(r.kendala)}</div>` : ''}
    <div class="actions"><button class="btn sm dr-view">Lihat lengkap</button>${canEdit ? '<button class="btn sm dr-edit">Lanjutkan laporan</button>' : ''}</div>
  </article>`;
}

const divIcon = { Pisang: '🍌', Padi: '🌾', Infra: '🚜' };
const minusDays = (date, n) => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() - n); return iso(d); };
const monthStart = (date) => date.slice(0, 7) + '-01';
const weekStart = (date, nextOnWeekend = false) => { const d=new Date(date+'T00:00:00'), day=d.getDay()||7; d.setDate(d.getDate()-day+1+(nextOnWeekend&&day>=6?7:0)); return iso(d); };
const plusDays = (date,n) => { const d=new Date(date+'T00:00:00'); d.setDate(d.getDate()+n); return iso(d); };
const weekLabel = (date) => { const start=weekStart(date),end=plusDays(start,6); return `${new Date(start+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short'})} – ${new Date(end+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})}`; };

function ownerRows(reports) {
  return reports.flatMap((r) => r.items.map((x) => ({ ...x, report: r })));
}

export function ownerTable(reports, query = '') {
  const has = v => v !== null && v !== undefined && v !== '';
  const grouped = new Map();
  for (const x of ownerRows(reports).filter(x=>!query || [x.aktivitas,x.blok,x.report.tanggal,x.report.divisi].join(' ').toLowerCase().includes(query.toLowerCase()))) {
    if (!has(x.realisasi) && !has(x.hk_realisasi)) continue;
    const key=[x.report.tanggal,x.report.divisi,String(x.aktivitas).toLowerCase().replace(/\s/g,''),String(x.satuan||'').toLowerCase()].join('|');
    const g=grouped.get(key)||{...x,blocks:new Set(),notes:new Set(),realisasi:null,hasil_sdhi:null,target:null,target_hk_minggu:null,hk_realisasi:null,cumulative:{hasil_sdhi:new Map(),target:new Map(),target_hk_minggu:new Map()}};
    String(x.blok||'').split(/\s*,\s*/).filter(Boolean).forEach(b=>g.blocks.add(b));
    if(x.keterangan)g.notes.add(x.keterangan);
    for(const k of ['realisasi','hk_realisasi'])if(has(x[k]))g[k]=(g[k]??0)+Number(x[k]);
    const blockKey=String(x.blok||'').split(',').map(v=>v.trim().toLowerCase()).sort().join(',');
    for(const k of ['hasil_sdhi','target','target_hk_minggu'])if(has(x[k])){const prior=g.cumulative[k].get(blockKey)||0,value=Math.max(prior,Number(x[k]));g[k]=(g[k]??0)+value-prior;g.cumulative[k].set(blockKey,value);}

    grouped.set(key,g);
  }
  const rows=[...grouped.values()];
  if (!rows.length) return '<div class="empty">Belum ada hasil kerja pada pilihan ini.</div>';
  const quantity=(v,u='')=>has(v)?'<b>'+fmt(v)+'</b>'+(u&&u!=='lainnya'?' '+safe(u):''):'';
  const weekly=rows.some(x=>Number(x.target)>0||Number(x.target_hk_minggu)>0), cumulative=weekly||rows.some(x=>has(x.hasil_sdhi)&&Number(x.hasil_sdhi)!==Number(x.realisasi));
  const columns=[
    {label:'Tanggal',show:true,cell:x=>safe(new Date(x.report.tanggal+'T00:00:00').toLocaleDateString('id-ID',{day:'2-digit',month:'short'}))},
    {label:'Divisi',show:new Set(rows.map(x=>x.report.divisi)).size>1,cell:x=>'<span class="dr-div '+x.report.divisi.toLowerCase()+'">'+safe(x.report.divisi)+'</span>'},
    {label:'Blok / lokasi',show:rows.some(x=>x.blocks.size),cell:x=>'<b>'+safe([...x.blocks].join(', '))+'</b>'},
    {label:'Pekerjaan',show:true,cell:x=>'<b>'+safe(x.aktivitas)+'</b>'+(x.notes.size?'<details class="dr-source"><summary>Catatan</summary><small class="dr-cell-note">'+safe([...x.notes].join('\n'))+'</small></details>':'')},
    {label:'HI — Hasil hari ini',numeric:true,show:rows.some(x=>has(x.realisasi)),cell:x=>quantity(x.realisasi,x.satuan)},
    {label:'SDHI — Hasil minggu ini',numeric:true,show:cumulative,cell:x=>quantity(x.hasil_sdhi,x.satuan)},
    {label:'HK',numeric:true,show:rows.some(x=>has(x.hk_realisasi)),cell:x=>quantity(x.hk_realisasi)},
    {label:'Rencana minggu',numeric:true,show:weekly,cell:x=>Number(x.target)>0?quantity(x.target,x.satuan):Number(x.target_hk_minggu)>0?quantity(x.target_hk_minggu,'HK')+'<small class=muted> · tenaga</small>':'<small class=muted>Belum ditetapkan</small>'},
    {label:'Capaian',numeric:true,show:weekly,cell:x=>Number(x.target)>0&&has(x.hasil_sdhi)?'<span class="dr-pct">'+Math.round(Number(x.hasil_sdhi)/Number(x.target)*100)+'%</span>':''},
    {label:'Status',show:rows.some(x=>!isDone(x.report)),cell:x=>'<span class="st '+(isDone(x.report)?'ok':'wait')+'">'+safe(x.report.status)+'</span>'}
  ].filter(c=>c.show);
  return '<div class="table-wrap dr-owner-table"><table class="data"><thead><tr>'+columns.map(c=>'<th'+(c.numeric?' class="num"':'')+'>'+c.label+'</th>').join('')+'</tr></thead><tbody>'+rows.map(x=>'<tr>'+columns.map(c=>'<td'+(c.numeric?' class="num"':'')+'>'+c.cell(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}

function ownerGallery(reports) {
  const photos = reports.flatMap((r) => r.photos.filter((p) => !p.deleted_at).map((p) => ({ ...p, report:r }))).sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0,24);
  if (!photos.length) return '<div class="dr-photo-empty"><span>📷</span><b>Belum ada foto pada periode ini</b><small>Foto kegiatan akan muncul otomatis di sini dan tersimpan selama 7 hari terakhir.</small></div>';
  return `<div class="dr-owner-gallery">${photos.map((p) => { const activities=p.report.items.slice(0,2).map(x=>x.aktivitas).join(' · '); return `<a class="dr-owner-photo" href="${p.url}" target="_blank"><div class="dr-owner-photo-img"><img src="${p.thumbnail_url || p.url}" loading="lazy" decoding="async" alt="${safe(p.caption||activities||'Foto kegiatan')}"><span class="dr-div ${p.report.divisi.toLowerCase()}">${safe(p.report.divisi)}</span></div><div class="dr-owner-photo-info"><b>${safe(p.caption||p.jenis||'Foto kegiatan')}</b><span>${new Date(p.report.tanggal+'T00:00:00').toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short',year:'numeric'})} · ${safe(p.report.dibuat_oleh||'Data awal')}</span></div></a>`; }).join('')}</div>`;
}

export async function renderDaily(main, A) {
  const today = iso(new Date()), allowed = editableDivisions(A), owner = !A.dailyFocus?.() && (A.isAdmin() || (A.me()?.peran || []).includes('management') || allowed.length === 0);
  if (!owner) return renderMandor(main, A, allowed, today);
  let selected = '', mode = '7', all = [], query = '';
  main.innerHTML = `<div class="page-head"><div><div class="crumb">Owner › Operasional Kebun</div><h1>Dashboard Kegiatan Kebun</h1><p class="desc">Pantau pekerjaan, tenaga kerja, hasil hari ini (HI), dan progres sampai hari ini (SDHI) seluruh divisi.</p></div><div class="actions">${A.isAdmin() ? '<button class="btn primary" id="drAdd">＋ Buat laporan</button>' : '<span class="tag">Dashboard Owner</span>'}</div></div>
    <div class="dr-period card"><div class="dr-period-buttons"><button class="btn" data-mode="0">Hari ini</button><button class="btn active" data-mode="7">7 hari</button><button class="btn" data-mode="14">14 hari</button></div><span class="sp"></span><span class="small muted" id="drPeriodLabel"></span></div>
    <div class="actions" id="drExports"></div><div class="dr-division-cards" id="drDivCards"></div><div class="kpis dr-kpis" id="drSummary"></div><div class="card dr-owner-data"><div class="dr-owner-head"><div><h2 id="drDataTitle">Data Kegiatan Semua Divisi</h2><p class="small muted" id="drDataSub"></p></div><div class="actions"><button class="btn sm" id="drAll">Semua divisi</button></div></div><label class="dr-search">Cari pekerjaan, blok, atau tanggal<input type="search" id="drSearch" placeholder="Contoh: D04, irigasi, panen…" autocomplete="off"></label><div id="drOwnerTable"></div></div><div class="card dr-photo-panel"><div class="dr-owner-head"><div><h2>Foto Kegiatan Lapangan</h2><p class="small muted" id="drPhotoSub">Mengikuti divisi dan periode yang dipilih</p></div><span class="tag" id="drPhotoCount">0 foto</span></div><div id="drOwnerGallery"></div></div>`;

  const range = () => [minusDays(today,mode==='0'?0:mode==='14'?13:6),today];
  const filtered = () => { const [from,to]=range(); return all.filter(r=>r.tanggal>=from&&r.tanggal<=to&&(!selected||r.divisi===selected)); };
  const draw = () => { const periodReports=filtered(), [from,to]=range(), label=`${new Date(from+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short'})} – ${new Date(to+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})}`; $('#drPeriodLabel',main).textContent=label; const base=all.filter(r=>(!from||r.tanggal>=from)&&(!to||r.tanggal<=to)); $('#drDivCards',main).innerHTML=DIVISI.map(d=>{const rs=base.filter(r=>r.divisi===d),rows=ownerRows(rs),hk=rows.reduce((n,x)=>n+Number(x.hk_realisasi??0),0),blocks=new Set(rows.map(x=>x.blok).filter(Boolean)).size;return `<button class="dr-division-card ${selected===d?'active':''}" data-div="${d}"><span class="dr-division-icon">${divIcon[d]}</span><span><b>${d}</b><small>Daily Report</small></span><span class="dr-division-stats"><b>${rows.length}</b><small>kegiatan</small><b>${fmt(hk)}</b><small>HK</small><b>${blocks}</b><small>lokasi</small></span></button>`;}).join(''); const rows=ownerRows(periodReports),hk=rows.reduce((n,x)=>n+Number(x.hk_realisasi??0),0),blocks=new Set(rows.map(x=>x.blok).filter(Boolean)).size,complete=periodReports.filter(isDone).length,photoCount=periodReports.reduce((n,r)=>n+r.photos.filter(p=>!p.deleted_at).length,0); $('#drSummary',main).innerHTML=`<div class="kpi"><div class="lbl">Total Kegiatan</div><div class="val">${rows.length}</div><div class="note">${periodReports.length} laporan</div></div><div class="kpi"><div class="lbl">Alokasi Hari Kerja</div><div class="val">${fmt(hk)} HK</div><div class="note">Alokasi HK kegiatan, bukan jumlah orang</div></div><div class="kpi"><div class="lbl">Lokasi Tercatat</div><div class="val">${blocks}</div><div class="note">lokasi pekerjaan</div></div><div class="kpi"><div class="lbl">Laporan Selesai</div><div class="val">${complete}/${periodReports.length}</div><div class="note">periode dipilih</div></div>`; $('#drDataTitle',main).textContent=`Data Kegiatan ${selected||'Semua Divisi'}`; $('#drDataSub',main).textContent=label; $('#drOwnerTable',main).innerHTML=ownerTable(periodReports,query); $('#drPhotoSub',main).textContent=`${selected||'Semua divisi'} · ${label}`; $('#drPhotoCount',main).textContent=`${photoCount} foto`; $('#drOwnerGallery',main).innerHTML=ownerGallery(periodReports);reportActions($('#drExports',main),A,{from:from||minusDays(today,730),to:to||today,divisi:selected}); $$('.dr-division-card',main).forEach(b=>b.onclick=()=>{selected=b.dataset.div;draw();}); };
  let requestId=0;
  const loadPeriod=async()=>{ const ticket=++requestId, [from,to]=range(); $('#drOwnerTable',main).textContent='Memuat laporan…'; try { const q=new URLSearchParams(from?{from,to}:{from:minusDays(today,730),to:today}); const result=await A.api.get('/api/daily?'+q); if(ticket!==requestId)return; all=result;draw(); }catch(e){if(ticket===requestId)$('#drOwnerTable',main).textContent=e.message;} };
  $$('.dr-period-buttons [data-mode]',main).forEach(b=>b.onclick=()=>{mode=b.dataset.mode;$$('.dr-period-buttons .btn',main).forEach(x=>x.classList.toggle('active',x===b));loadPeriod();}); $('#drAll',main).onclick=()=>{selected='';draw();};$('#drAdd',main)?.addEventListener('click',()=>openForm(null,A,loadPeriod));$('#drSearch',main).oninput=e=>{query=e.target.value.trim();$('#drOwnerTable',main).innerHTML=ownerTable(filtered(),query);};await loadPeriod();
}

async function renderMandor(main,A,allowed,today){
  const fromDefault=minusDays(today,13), defaultWeek=weekStart(today,true); main.innerHTML=`<div class="page-head"><div><div class="crumb">Tim Lapangan › Daily Report</div><h1>Input & Laporan Saya</h1><p class="desc">Susun rencana per blok untuk satu minggu, lalu catat hasil kerja dan foto setiap hari.</p></div><div class="actions"><button class="btn" id="drPlan">📅 Rencana Mingguan</button><button class="btn primary" id="drAdd">＋ Realisasi Hari Ini</button></div></div><div class="card dr-plan-strip"><div><b>Rencana minggu pelaksanaan</b><small>${weekLabel(defaultWeek)} · tanggal akhir dihitung otomatis</small></div><div id="drPlanList"></div></div><div class="card dr-filter"><label>Dari <input type="date" id="drFrom" value="${fromDefault}"></label><label>Sampai <input type="date" id="drTo" value="${today}"></label><button class="btn" id="drApply">Tampilkan</button></div><div class="actions" id="drExports"></div><div id="drSummary"></div><div class="dr-grid" id="drList"></div>`;
  const load=async()=>{reportActions($('#drExports',main),A,{from:$('#drFrom',main).value,to:$('#drTo',main).value,divisi:allowed.length===1?allowed[0]:''});const q=new URLSearchParams({from:$('#drFrom',main).value,to:$('#drTo',main).value}),[reports,plans]=await Promise.all([A.api.get('/api/daily?'+q),A.api.get('/api/daily/plans?week='+defaultWeek)]),sent=reports.filter(isDone).length,photos=reports.reduce((a,r)=>a+r.photos.filter(p=>!p.deleted_at).length,0);$('#drPlanList',main).innerHTML=plans.length?plans.map(p=>`<button class="btn sm dr-edit-plan" data-id="${p.id}"><b>${safe(p.divisi)}</b> · ${p.items.length} kegiatan · ${safe(p.status)}</button>`).join(''):'<span class="small muted">Belum ada rencana. Buat rencana per blok untuk minggu ini.</span>';$('#drSummary',main).innerHTML=`<div class="kpis dr-kpis"><div class="kpi"><div class="lbl">Laporan</div><div class="val">${reports.length}</div></div><div class="kpi"><div class="lbl">Selesai</div><div class="val">${sent}</div></div><div class="kpi"><div class="lbl">Foto aktif</div><div class="val">${photos}</div></div></div>`;$('#drList',main).innerHTML=reports.length?reports.map(r=>reportCard(r,allowed.includes(r.divisi))).join(''):'<div class="card empty">Belum ada laporan.</div>';$$('.dr-edit-plan',main).forEach(el=>el.onclick=()=>openWeeklyPlan(plans.find(p=>p.id===Number(el.dataset.id)),A,load));$$('.dr-card',main).forEach(el=>{const r=reports.find(x=>x.id===Number(el.dataset.id));$('.dr-view',el).onclick=()=>openDetail(r,A);$('.dr-edit',el)?.addEventListener('click',()=>openForm(r,A,load));});};$('#drApply',main).onclick=load;$('#drPlan',main).onclick=()=>openWeeklyPlan(null,A,load);$('#drAdd',main).onclick=()=>openForm(null,A,load);await load();
}

async function openWeeklyPlan(plan,A,afterSave){
  const allowed=editableDivisions(A), initialDiv=plan?.divisi||allowed[0], initialWeek=plan?.week_start||weekStart(iso(new Date()),true); let locations=[];
  try{locations=await A.api.get('/api/daily/locations');}catch(e){A.toast('Daftar lokasi belum dapat dimuat: '+e.message,true);}
  let blocks=[]; for(const x of plan?.items||[]){let b=blocks.find(v=>v.blok===x.blok);if(!b){b={blok:x.blok,items:[]};blocks.push(b);}b.items.push({...x});} if(!blocks.length)blocks=[{blok:'',items:[{aktivitas:'',target:'',satuan:'ha',hk_rencana:'',keterangan:''}]}];
  const md=A.openModal(`<form id="wpForm"><div class="modal-head"><h2>${plan?'Ubah':'Buat'} Rencana Mingguan</h2><button type="button" class="x">×</button></div><div class="modal-body"><div class="card dr-flow-note"><b>Satu minggu = Senin sampai Minggu</b><span>Pilih tanggal minggu pelaksanaan saja. Jika dibuat Sabtu/Minggu, bawaan sistem langsung memilih minggu berikutnya.</span></div><div class="form-grid"><div class="fld"><label>Minggu pelaksanaan *</label><input id="wpWeek" type="date" required value="${initialWeek}"><div class="hint" id="wpRange">${weekLabel(initialWeek)}</div></div><div class="fld"><label>Divisi *</label><select id="wpDiv" ${plan||allowed.length===1?'disabled':''}>${allowed.map(d=>`<option ${d===initialDiv?'selected':''}>${d}</option>`).join('')}</select></div><div class="fld full"><label>Catatan minggu</label><textarea id="wpNote" rows="2">${safe(plan?.catatan)}</textarea></div></div><div class="dr-section-title"><div><h3>Rencana per blok</h3><small class="muted">Blok dipilih dahulu, lalu tambahkan beberapa kegiatan di dalamnya.</small></div><button type="button" class="btn sm" id="wpAddBlock">＋ Blok</button></div><div id="wpBlocks"></div><datalist id="wpLocations"></datalist><datalist id="wpActivities"></datalist></div><div class="modal-foot"><button type="button" class="btn" id="wpCancel">Batal</button><span class="sp"></span><button type="submit" class="btn" data-status="Draf">Simpan draf</button><button type="submit" class="btn primary" data-status="Dikirim">Kirim rencana</button></div></form>`,true);
  let currentDiv=initialDiv,status=plan?.status||'Draf';
  const lists=()=>{const ordered=[...locations].sort((a,b)=>Number(!(a.divisi===currentDiv))-Number(!(b.divisi===currentDiv))||(a.rank??5)-(b.rank??5)||a.nama.localeCompare(b.nama,'id',{numeric:true}));$('#wpLocations',md).innerHTML=ordered.map(l=>`<option value="${safe(l.nama)}">${safe(l.jenis)} · ${safe(l.divisi)}</option>`).join('');$('#wpActivities',md).innerHTML=ACTIVITY[currentDiv].map(([a])=>`<option value="${safe(a)}"></option>`).join('');};
  const draw=()=>{lists();$('#wpBlocks',md).innerHTML=blocks.map((b,bi)=>`<section class="dr-plan-block"><div class="dr-plan-block-head"><label><span>Blok / lokasi ${bi+1} *</span><input list="wpLocations" data-block="${bi}" value="${safe(b.blok)}" placeholder="Cari petak, blok, embung…"></label><button type="button" class="btn sm danger wp-del-block" data-bi="${bi}">Hapus blok</button></div><div class="dr-plan-activities">${b.items.map((x,ii)=>`<div class="dr-plan-activity"><label class="wide">Kegiatan *<input list="wpActivities" data-bi="${bi}" data-ii="${ii}" data-k="aktivitas" value="${safe(x.aktivitas)}" placeholder="Cari atau ketik kegiatan lain"></label><label>Target<input type="number" min="0" step="any" data-bi="${bi}" data-ii="${ii}" data-k="target" value="${safe(x.target)}"></label><label>Satuan<select data-bi="${bi}" data-ii="${ii}" data-k="satuan">${UNIT.map(u=>`<option ${x.satuan===u?'selected':''}>${u}</option>`).join('')}</select></label><label>HK rencana<input type="number" min="0" step="any" data-bi="${bi}" data-ii="${ii}" data-k="hk_rencana" value="${safe(x.hk_rencana)}"></label><label class="wide">Keterangan<input data-bi="${bi}" data-ii="${ii}" data-k="keterangan" value="${safe(x.keterangan)}"></label><button type="button" class="btn sm danger wp-del-act" data-bi="${bi}" data-ii="${ii}">×</button></div>`).join('')}</div><button type="button" class="btn sm wp-add-act" data-bi="${bi}">＋ Kegiatan pada blok ini</button></section>`).join('');$$('[data-block]',md).forEach(el=>el.oninput=()=>blocks[Number(el.dataset.block)].blok=el.value);$$('[data-bi][data-ii][data-k]',md).forEach(el=>el.oninput=()=>{const x=blocks[Number(el.dataset.bi)].items[Number(el.dataset.ii)];x[el.dataset.k]=el.value;if(el.dataset.k==='aktivitas'){const hit=ACTIVITY[currentDiv].find(([a])=>a===el.value);if(hit){x.satuan=hit[1];draw();}}});$$('.wp-add-act',md).forEach(el=>el.onclick=()=>{blocks[Number(el.dataset.bi)].items.push({aktivitas:'',target:'',satuan:'ha',hk_rencana:'',keterangan:''});draw();});$$('.wp-del-act',md).forEach(el=>el.onclick=()=>{const b=blocks[Number(el.dataset.bi)];if(b.items.length===1)return A.toast('Minimal satu kegiatan per blok',true);b.items.splice(Number(el.dataset.ii),1);draw();});$$('.wp-del-block',md).forEach(el=>el.onclick=()=>{if(blocks.length===1)return A.toast('Minimal satu blok',true);blocks.splice(Number(el.dataset.bi),1);draw();});};
  draw();$('#wpAddBlock',md).onclick=()=>{blocks.push({blok:'',items:[{aktivitas:'',target:'',satuan:'ha',hk_rencana:'',keterangan:''}]});draw();};$('#wpWeek',md).onchange=e=>$('#wpRange',md).textContent=weekLabel(e.target.value);$('#wpDiv',md)?.addEventListener('change',e=>{currentDiv=e.target.value;draw();});$('#wpCancel',md).onclick=A.closeModal;$$('button[type="submit"]',md).forEach(b=>b.onclick=()=>status=b.dataset.status);
  $('#wpForm',md).onsubmit=async e=>{e.preventDefault();const items=blocks.flatMap(b=>b.items.map(x=>({...x,blok:b.blok}))).filter(x=>x.aktivitas.trim());if(!items.length||items.some(x=>!x.blok.trim()))return A.toast('Setiap kegiatan wajib memiliki blok/lokasi',true);const buttons=$$('button',md);buttons.forEach(b=>b.disabled=true);try{await A.api.post('/api/daily/plans',{id:plan?.id,week_start:$('#wpWeek',md).value,divisi:currentDiv,status,catatan:$('#wpNote',md).value,items});A.closeModal();A.toast(status==='Dikirim'?'Rencana mingguan dikirim':'Draf rencana tersimpan');await afterSave();}catch(err){A.toast(err.message,true);buttons.forEach(b=>b.disabled=false);}};
}

function itemTable(r) {
  if (!r.items.length) return '<div class="empty">Belum ada rencana kegiatan.</div>';
  return `<div class="table-wrap" style="max-height:none"><table class="data dr-table"><thead><tr><th>Aktivitas</th><th>Blok/Lokasi</th><th class="num">Rencana</th><th class="num">HI</th><th class="num">SDHI</th><th class="num">Capaian</th><th class="num">HK Rencana/Hasil</th>${r.divisi === 'Infra' ? '<th>Alat · HM/KM · Rit</th>' : ''}<th>Keterangan</th></tr></thead><tbody>${r.items.map((x) => { const sdhi=x.hasil_sdhi??x.realisasi, pct = Number(x.target) > 0 && sdhi != null ? Math.round(100 * Number(sdhi || 0) / Number(x.target)) + '%' : '—'; const meter = x.meter_awal != null || x.meter_akhir != null ? `${fmt(x.meter_awal)} → ${fmt(x.meter_akhir)}` : ''; return `<tr><td>${safe(x.aktivitas)}</td><td>${safe(x.blok || '—')}</td><td class="num">${fmt(x.target)} ${safe(x.satuan || '')}</td><td class="num">${fmt(x.realisasi)} ${safe(x.satuan || '')}</td><td class="num">${fmt(sdhi)} ${safe(x.satuan || '')}</td><td class="num"><b>${pct}</b></td><td class="num">${fmt(x.hk_rencana)} / ${fmt(x.hk_realisasi)}</td>${r.divisi === 'Infra' ? `<td>${safe(x.alat || '—')}<br><small>${safe(meter)}${x.ritase != null ? ` · ${fmt(x.ritase)} rit` : ''}</small></td>` : ''}<td>${safe(x.keterangan || '')}</td></tr>`; }).join('')}</tbody></table></div>`;
}

function openDetail(r, A) {
  const live = r.photos.filter((p) => !p.deleted_at), expired = r.photos.filter((p) => p.deleted_at).length;
  const md = A.openModal(`<div class="modal-head"><h2>${safe(r.divisi)} · ${safe(r.tanggal)}</h2><button class="x">×</button></div><div class="modal-body dr-detail">
    <div class="dr-overview"><div><small>Penginput</small><b>${safe(r.dibuat_oleh || 'Data awal')}</b></div><div><small>Status</small><b>${safe(r.status)}</b></div><div><small>Siklus</small><b>${safe(r.siklus || '—')}</b></div><div><small>Total HK pernyataan mandor</small><b>${fmt(r.apel_hadir)} HK</b></div></div>
    ${r.apel_catatan ? `<section><h3>Catatan tenaga kerja</h3><p>${safe(r.apel_catatan)}</p></section>` : ''}<section><h3>Rencana & Hasil Kerja</h3>${dailyHKMarkup(r)}${itemTable(r)}</section>
    <div class="cols-2"><section><h3>Kendala</h3><p>${safe(r.kendala || 'Tidak ada kendala dilaporkan.')}</p></section><section><h3>Tindak Lanjut</h3><p>${safe(r.tindak_lanjut || '—')}</p></section></div>
    <section><h3>Dokumentasi <span class="small muted">(${live.length} aktif${expired ? `, ${expired} telah dihapus` : ''})</span></h3>${live.length ? `<div class="dr-gallery">${live.map((p) => `<a href="${p.url}" target="_blank"><img src="${p.thumbnail_url || p.url}" loading="lazy" decoding="async" alt="${safe(p.caption || p.jenis)}"><span>${safe(p.jenis)}${p.caption ? ` · ${safe(p.caption)}` : ''}</span><small>s.d. ${safe(new Date(p.expires_at).toLocaleDateString('id-ID'))}</small></a>`).join('')}</div>` : '<div class="empty">Belum ada foto aktif.</div>'}</section>
  </div><div class="modal-foot"><span class="small muted">Foto bersifat sementara; isi laporan tetap tersimpan.</span><span class="sp"></span><button class="btn" id="drClose">Tutup</button></div>`, true);
  const exports=document.createElement('div');exports.className='actions';$('.dr-detail',md).prepend(exports);reportActions(exports,A,{from:r.tanggal,to:r.tanggal,divisi:r.divisi,reportId:r.id});
  $('#drClose', md).onclick = A.closeModal;
}

function itemEditor(x, i, infra, locations) {
  const input = (k, label, type = 'text', extra = '') => `<label>${label}<input data-i="${i}" data-k="${k}" type="${type}" value="${safe(x[k])}" ${extra}></label>`;
  const div = infra ? 'Infra' : window.__dailyDiv || 'Pisang';
  const known = ACTIVITY[div].some(([a]) => a === x.aktivitas), selected = known ? x.aktivitas : x.aktivitas ? '__other' : '';
  const chosen = new Set(String(x.blok || '').split(/\s*,\s*/).filter(Boolean));
  const orderedLocations = [...locations].sort((a,b) => Number(!(a.divisi === div)) - Number(!(b.divisi === div)) || (a.rank??5)-(b.rank??5) || a.nama.localeCompare(b.nama,'id',{numeric:true}));
  return `<div class="dr-item" data-row="${i}"><div class="dr-item-title"><b>Kegiatan ${i + 1} ${Number(x.di_luar_rencana)?'<span class="dr-extra">Tambahan di luar rencana</span>':'<span class="dr-planned">Dari rencana mingguan</span>'}</b><button type="button" class="btn sm danger dr-remove" data-i="${i}">Hapus</button></div><div class="dr-item-grid">
    <div class="dr-location-field full"><label>1. Blok / lokasi * <small>bisa pilih lebih dari satu</small></label><button type="button" class="dr-loc-toggle" data-i="${i}">${chosen.size ? `${chosen.size} lokasi dipilih · ${safe([...chosen].slice(0,3).join(', '))}${chosen.size>3?'…':''}` : '☐ Pilih blok / lokasi dari GIS'}</button><div class="dr-loc-picker" data-picker="${i}" hidden><input type="search" class="dr-loc-search" data-i="${i}" placeholder="Cari petak pisang, padi, embung, PH…"><div class="dr-loc-options">${orderedLocations.map(l=>`<label data-loc-label="${safe((l.nama+' '+l.jenis+' '+l.divisi).toLowerCase())}"><input type="checkbox" data-loc="${i}" value="${safe(l.nama)}" ${chosen.has(l.nama)?'checked':''}><span><b>${safe(l.nama)}</b><small>${safe(l.jenis)} · ${safe(l.divisi)}</small></span></label>`).join('')}</div><label class="dr-loc-manual"><span>Lokasi belum ada di GIS</span><input data-loc-manual="${i}" placeholder="Ketik lokasi lain" value="${safe([...chosen].filter(v=>!locations.some(l=>l.nama===v)).join(', '))}"></label><button type="button" class="btn sm dr-loc-done" data-i="${i}">Selesai pilih lokasi</button></div></div>
    <label class="dr-act-field">2. Cari & pilih kegiatan *<input class="dr-act-search" data-i="${i}" type="search" placeholder="Ketik nama kegiatan…"><select class="dr-activity" data-i="${i}" required><option value="">Pilih pekerjaan…</option>${ACTIVITY[div].map(([a]) => `<option ${selected === a ? 'selected' : ''}>${a}</option>`).join('')}<option value="__other" ${selected === '__other' ? 'selected' : ''}>Pekerjaan lainnya…</option></select></label><label class="dr-custom" style="${selected === '__other' ? '' : 'display:none'}">Nama pekerjaan lain<input data-custom="${i}" value="${selected === '__other' ? safe(x.aktivitas) : ''}"></label>
    <div class="fld"><label>Target mingguan</label><div class="dr-auto-field">${fmt(x.target)} ${safe(x.satuan||'')}</div></div>${input('realisasi', 'HI — hasil hari ini', 'number', 'step="any" min="0"')}<div class="fld"><label>SDHI — otomatis</label><div class="dr-auto-field">Akumulasi HI blok ini</div></div>
    <label>Satuan<select data-i="${i}" data-k="satuan">${UNIT.map((u) => `<option ${x.satuan === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label><div class="fld"><label>HK rencana</label><div class="dr-auto-field">${fmt(x.hk_rencana)}</div></div>${input('hk_realisasi', 'HK hasil', 'number', 'step="any" min="0"')}
    ${infra ? `${input('alat', 'Alat / kendaraan')}${input('meter_awal', 'HM/KM awal', 'number', 'step="any" min="0"')}${input('meter_akhir', 'HM/KM akhir', 'number', 'step="any" min="0"')}${input('ritase', 'Ritase', 'number', 'step="any" min="0"')}` : ''}
    <label class="full">Keterangan<input data-i="${i}" data-k="keterangan" value="${safe(x.keterangan)}"></label></div></div>`;
}

async function openForm(report, A, afterSave) {
  const md = A.openModal('<div class="modal-head"><b>Daily Report</b><button type="button" class="btn sm" id="qDetailed">Form lengkap & foto</button><button class="x">×</button></div><div class="modal-body" id="quickHost"></div>', true);
  md.classList.add('qd-modal');
  $('#qDetailed',md).onclick=()=>{A.closeModal();openDetailedForm(report,A,afterSave);};
  await quickDaily($('#quickHost',md),A,report,async()=>{A.closeModal();A.toast('Laporan tersimpan');await afterSave();});
}
async function openDetailedForm(report, A, afterSave) {
  const allowed = editableDivisions(A), initialDiv = report?.divisi || allowed[0]; let items = report?.items?.map((x) => ({ ...blankItem(), ...x })) || [];
  let locations = [];
  try { locations = await A.api.get('/api/daily/locations'); } catch (e) { A.toast('Daftar lokasi GIS belum dapat dimuat: ' + e.message, true); }
  if (!report) { try { const plans=await A.api.get(`/api/daily/plans?week=${iso(new Date())}&divisi=${initialDiv}`),plan=plans[0]; if(plan?.items?.length)items=plan.items.map(x=>({...blankItem(),...x,plan_item_id:x.id,di_luar_rencana:0,realisasi:'',hk_realisasi:''})); } catch {} }
  if(!items.length)items=[blankItem()];
  const md = A.openModal(`<form id="drForm"><div class="modal-head"><h2>${report ? 'Ubah' : 'Buat'} Daily Report</h2><button type="button" class="x">×</button></div><div class="modal-body">
    <div class="card" style="margin-bottom:14px"><b>Realisasi harian</b><div class="small muted">Kegiatan dari rencana minggu ini sudah dimuat otomatis. Pekerjaan mendadak tetap boleh ditambahkan dan akan ditandai “Tambahan”.</div></div>
    <div class="form-grid dr-form-head"><div class="fld"><label>Tanggal *</label><input id="drTanggal" type="date" required value="${safe(report?.tanggal || iso(new Date()))}"></div><div class="fld"><label>Divisi *</label><select id="drDivisi" ${report || allowed.length === 1 ? 'disabled' : ''}>${allowed.map((d) => `<option ${d === initialDiv ? 'selected' : ''}>${d}</option>`).join('')}</select></div><div class="fld"><label>Penginput</label><div class="dr-auto-field">Otomatis dari akun login</div></div><div class="fld"><label>Siklus / periode</label><input id="drSiklus" value="${safe(report?.siklus || '')}" placeholder="contoh: Padi MT-1 2026"></div><div class="fld"><label>Total HK hari ini · pernyataan mandor</label><input id="drHadir" type="number" min="0" step="any" placeholder="Contoh: 64" value="${safe(report?.apel_hadir)}"></div><div class="fld full"><label>Catatan tenaga kerja</label><textarea id="drApel" rows="2">${safe(report?.apel_catatan)}</textarea></div></div>
    <div id="drHKCheck"></div><div class="dr-section-title"><h3>Hasil Kerja Hari Ini</h3><button type="button" class="btn sm" id="drAddItem">＋ Kegiatan tambahan</button></div><div id="drItems"></div>
    <div class="form-grid"><div class="fld full"><label>Kendala</label><textarea id="drKendala" rows="3">${safe(report?.kendala)}</textarea></div><div class="fld full"><label>Tindak lanjut</label><textarea id="drTindak" rows="3">${safe(report?.tindak_lanjut)}</textarea></div></div>
    <div class="card dr-upload"><h3>Foto langsung</h3><p class="small muted">Pilih dari galeri atau kamera. Foto dikompres sebelum diunggah dan otomatis terhapus setelah 7 hari berdasarkan tanggal laporan.</p><div class="form-grid"><div class="fld"><label>Jenis</label><select id="drFotoJenis"><option>Apel</option><option selected>Kegiatan</option><option>Kendala</option></select></div><div class="fld"><label>Keterangan foto</label><input id="drFotoCaption" placeholder="contoh: Panen blok D08"></div><div class="fld full"><label>Pilih foto</label><input id="drFoto" type="file" accept="image/jpeg,image/png,image/webp" multiple></div></div>${report?.photos?.some((p) => !p.deleted_at) ? `<div class="small">Foto aktif saat ini: ${report.photos.filter((p) => !p.deleted_at).length}</div>` : ''}</div>
  </div><div class="modal-foot"><button type="button" class="btn" id="drCancel">Batal</button><span class="sp"></span><button type="submit" class="btn" data-status="Draf">Simpan draf</button><button type="submit" class="btn primary" data-status="Selesai">Selesaikan laporan</button></div></form>`, true);

  let currentDiv = initialDiv;
  const updateHK=()=>{$('#drHKCheck',md).innerHTML=dailyHKMarkup({apel_hadir:$('#drHadir',md).value,items});};
  $('#drHadir',md).oninput=updateHK;
  const drawItems = () => {
    updateHK();
    window.__dailyDiv = currentDiv;
    const box = $('#drItems', md); box.innerHTML = items.map((x, i) => itemEditor(x, i, currentDiv === 'Infra', locations)).join('');
    $$('[data-i][data-k]', box).forEach((el) => el.addEventListener('input', () => { items[Number(el.dataset.i)][el.dataset.k] = el.value; updateHK(); }));
    $$('.dr-activity', box).forEach((el) => el.addEventListener('change', () => { const i = Number(el.dataset.i), value = el.value, custom = el.closest('.dr-item-grid').querySelector('.dr-custom'); if (value === '__other') { custom.style.display = ''; items[i].aktivitas = custom.querySelector('input').value; } else { items[i].aktivitas = value; const hit = ACTIVITY[currentDiv].find(([a]) => a === value); if (hit) items[i].satuan = hit[1]; drawItems(); } }));
    $$('.dr-act-search', box).forEach((el) => el.addEventListener('input', () => { const select=el.parentElement.querySelector('.dr-activity'), q=el.value.trim().toLowerCase(), current=items[Number(el.dataset.i)].aktivitas; select.innerHTML='<option value="">Pilih pekerjaan…</option>'+ACTIVITY[currentDiv].filter(([a])=>!q||a.toLowerCase().includes(q)).map(([a])=>`<option ${current===a?'selected':''}>${safe(a)}</option>`).join('')+'<option value="__other">Pekerjaan lainnya…</option>'; }));
    $$('[data-custom]', box).forEach((el) => el.addEventListener('input', () => { items[Number(el.dataset.custom)].aktivitas = el.value; }));
    $$('.dr-loc-toggle', box).forEach(el=>el.onclick=()=>{const p=$(`[data-picker="${el.dataset.i}"]`,box);p.hidden=!p.hidden;});
    $$('.dr-loc-search', box).forEach(el=>el.oninput=()=>{const q=el.value.trim().toLowerCase();$$('[data-loc-label]',el.parentElement).forEach(l=>l.hidden=q&&!l.dataset.locLabel.includes(q));});
    const updateLocations=(i)=>{const picker=$(`[data-picker="${i}"]`,box), vals=$$(`[data-loc="${i}"]:checked`,picker).map(c=>c.value),manual=$(`[data-loc-manual="${i}"]`,picker).value.split(/\s*,\s*/).filter(Boolean);items[i].blok=[...new Set([...vals,...manual])].join(', ');const btn=$(`.dr-loc-toggle[data-i="${i}"]`,box), n=vals.length+manual.length;btn.textContent=n?`${n} lokasi dipilih · ${[...vals,...manual].slice(0,3).join(', ')}${n>3?'…':''}`:'☐ Pilih blok / lokasi dari GIS';};
    const expandLocations=(i)=>{const blocks=[...new Set(String(items[i].blok||'').split(/\s*,\s*/).filter(Boolean))];if(blocks.length<=1){$(`[data-picker="${i}"]`,box).hidden=true;return;}const base=items[i], expanded=blocks.map((blok,j)=>({...base,blok,target:j?'':base.target,realisasi:j?'':base.realisasi,hk_realisasi:j?'':base.hk_realisasi}));items.splice(i,1,...expanded);A.toast(`${blocks.length} blok dibuat menjadi ${blocks.length} baris rencana`);drawItems();};
    $$('[data-loc]',box).forEach(el=>el.onchange=()=>updateLocations(Number(el.dataset.loc)));$$('[data-loc-manual]',box).forEach(el=>el.oninput=()=>updateLocations(Number(el.dataset.locManual)));$$('.dr-loc-done',box).forEach(el=>el.onclick=()=>expandLocations(Number(el.dataset.i)));
    $$('.dr-remove', box).forEach((el) => el.onclick = () => { if (items.length === 1) return A.toast('Minimal satu kegiatan', true); items.splice(Number(el.dataset.i), 1); drawItems(); });
  };
  drawItems();
  $('#drAddItem', md).onclick = () => { items.push(blankItem()); drawItems(); };
  $('#drCancel', md).onclick = A.closeModal;
  $('#drDivisi', md)?.addEventListener('change', (e) => { currentDiv = e.target.value; drawItems(); });
  let submitStatus = report?.status || 'Draf';
  $$('button[type="submit"]', md).forEach((b) => b.onclick = () => { submitStatus = b.dataset.status; });
  $('#drForm', md).onsubmit = async (e) => {
    e.preventDefault();
    const activity = items.filter((x) => String(x.aktivitas || '').trim());
    if (!activity.length) return A.toast('Isi minimal satu kegiatan', true);
    if (activity.some((x) => !String(x.blok || '').trim())) return A.toast('Pilih minimal satu blok/lokasi untuk setiap kegiatan', true);
    if (submitStatus === 'Selesai') { const missing = []; if (activity.some((x) => x.realisasi === '' && x.hk_realisasi === '')) missing.push('hasil kerja/HK hasil'); if (!$('#drFoto', md).files.length && !(report?.photos || []).some((p) => !p.deleted_at)) missing.push('foto dokumentasi'); if (missing.length && !confirm(`Laporan belum lengkap: ${missing.join(', ')}.\n\nTetap selesaikan?`)) return; }
    const buttons = $$('button', md); buttons.forEach((b) => b.disabled = true);
    try {
      const saved = await A.api.post('/api/daily', { id: report?.id, tanggal: $('#drTanggal', md).value, divisi: currentDiv, siklus: $('#drSiklus', md).value, status: submitStatus, apel_hadir: $('#drHadir', md).value, apel_catatan: $('#drApel', md).value, kendala: $('#drKendala', md).value, tindak_lanjut: $('#drTindak', md).value, items: activity });
      const files = [...$('#drFoto', md).files];
      for (let i = 0; i < files.length; i++) {
        A.toast(`Mengunggah foto ${i + 1}/${files.length}…`);
        await (await import('./photos.js')).uploadPhoto(files[i],saved.id,text=>A.toast(text));
      }
      A.closeModal(); A.toast(submitStatus === 'Selesai' ? 'Laporan selesai' : 'Draf tersimpan'); await afterSave();
    } catch (err) { A.toast(err.message, true); buttons.forEach((b) => b.disabled = false); }
  };
}

async function compressPhoto(file) { return (await import('./photos.js')).compressPhoto(file); }
