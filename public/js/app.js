import { DIVISIONS, TABLES, ROLES, util, displayOf, canEdit, isAdmin, EXCEL_SHEETS } from './schema.js';
import { KOM, RECORD_ROUTES } from './navigation.js';
const renderGIS=(...args)=>import('./gis.js').then(m=>m.renderGIS(...args));
const renderOwner=(...args)=>import('./owner.js').then(m=>m.renderOwner(...args));
const renderLaporan=(...args)=>import('./laporan.js').then(m=>m.renderLaporan(...args));
const renderKomoditas=(...args)=>import('./komoditas.js').then(m=>m.renderKomoditas(...args));
const renderDaily=(...args)=>import('./daily.js').then(m=>m.renderDaily(...args));

let me = null;                                  // pengguna yang login
let server = {};                                // info server: online (database Turso) / vercel
const can = (t) => canEdit(me, t);              // boleh ubah tabel t?

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = util.n;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// ================================================================ API & cache
const api = {
  async req(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: /\/api\/(login|setup)$/.test(url) ? AbortSignal.timeout(30000) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !/\/api\/(login|me|setup)$/.test(url)) { me = null; renderUserChip(); openLogin(); }
    if(!r.ok && j.gisRevision && body && /\/api\/t\/gis_layer/.test(url)) {const {reviewGIS}=await import('./block-ui.js');const result=await reviewGIS(App,{layerId:Number(url.split('/').at(-1))||null,layer:body});return result;}
    if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; e.data = j; throw e; }
    return j;
  },
  get: (u) => api.req('GET', u), post: (u, b) => api.req('POST', u, b), put: (u, b) => api.req('PUT', u, b), del: (u) => api.req('DELETE', u),
};
const cache = {};      // tabel -> rows
const stamp = {};      // tabel -> "count|max(updated_at)"
async function loadTable(t) { cache[t] = await api.get(`/api/t/${t}`); }
function neededTables(route) {
  if(!route || ['hub','records','blocks','daily','pengguna','riwayat','excel','pengaturan'].includes(route.split('/')[0]))return [];
  if(route.startsWith('k/pisang'))return Object.keys(TABLES).filter(t=>t.startsWith('pisang_')||t.startsWith('lahan_'));
  if(route.startsWith('k/padi'))return Object.keys(TABLES).filter(t=>t.startsWith('padi_')||t.startsWith('lahan_'));
  if(route.startsWith('k/iklim'))return ['iklim'];
  if(route==='gis')return ['pisang_blok','padi_petak','padi_tanam','lahan_blok','lahan_harian','lahan_aktivitas','lahan_rencana'];
  return Object.keys(TABLES).filter(t=>!t.startsWith('daily_'));
}
async function syncAll(route=location.hash.replace(/^#\/?/,'')) {
  const info = await api.get('/api/tables');
  const jobs = [];
  const needed = new Set(neededTables(route));
  for (const [t, v] of Object.entries(info)) {
    if(t!=='gis_layer' && !needed.has(t))continue;
    if (t === 'gis_layer') { stamp[t] = `${v.c}|${v.u}`; continue; }
    const s = `${v.c}|${v.u}`;
    if (stamp[t] !== s || !cache[t]) { stamp[t] = s; jobs.push(loadTable(t)); }
  }
  await Promise.all(jobs);
  return info;
}
const ctx = { rows: (t) => cache[t] || [] };

// nilai field (termasuk kolom hitung)
function val(table, f, row) {
  if (f.t !== 'calc') return row[f.k];
  try { return f.fn(row, ctx); } catch { return null; }
}

// ================================================================ format
const nf = (d) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = [0, 1, 2, 3, 4].map(nf);
function fmtNum(v, d = 0) { return v == null || v === '' || !Number.isFinite(Number(v)) ? '' : NF[d].format(Number(v)); }
function fmtRp(v) { return v == null || v === '' ? '' : 'Rp ' + fmtNum(v); }
function fmtPct(v) { return v == null || v === '' ? '' : fmtNum(v * 100, 1) + '%'; }
function fmtDate(s) { const d = util.d(s); return d ? `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}` : ''; }
function fmtField(f, v) {
  const k = f.t === 'calc' ? f.fmt : f.t;
  switch (k) {
    case 'int': return fmtNum(v, 0);
    case 'num': return v == null || v === '' ? '' : fmtNum(v, Number.isInteger(Number(v)) ? 0 : (String(v).split('.')[1] || '').length > 2 ? 3 : 2);
    case 'num1': return fmtNum(v, 1);
    case 'num2': return fmtNum(v, 2);
    case 'money': return fmtRp(v);
    case 'pct': return fmtPct(v);
    case 'date': return fmtDate(v);
    default: return v ?? '';
  }
}
const isNumField = (f) => ['int', 'num', 'money'].includes(f.t) || (f.t === 'calc' && ['int', 'num', 'num1', 'num2', 'money', 'pct'].includes(f.fmt));
// kolom yang tidak boleh dijumlah di baris Total (rata-rata, nilai kumulatif, saldo berulang, ha lintas tahap yang berbeda)
const NOSUM = /^(tahun|urutan|hm_|umur|lat|lng|harga|intensitas|kadar|rata|kg_per|kg_karung|ton_ha|pct|target_hk|hst|progres|jam_bulan|km_awal|km_akhir|angin|hujan|suhu|lembap|hasil_ha|saldo_varietas|tampil)/;
const isSumField = (f) => isNumField(f) && !NOSUM.test(f.k) && !(f.t === 'calc' && ['num1', 'pct'].includes(f.fmt));

const thisYM = () => util.iso(util.today()).slice(0, 7);

// ================================================================ UI helpers
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 5000 : 2200);
}
function openModal(html, wide) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
  m.hidden = false;
  $('.x', m)?.addEventListener('click', closeModal);
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  return $('.modal', m);
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

// pustaka besar hanya dimuat saat dibutuhkan (peta, grafik, baca shapefile) — halaman pertama jauh lebih ringan
const LIBS = { leaflet: ['/vendor/leaflet.css', '/vendor/leaflet.js'], chart: ['/vendor/chart.umd.js'], shp: ['/vendor/shp.min.js'] };
const libPromise = {};
function loadLib(name) {
  return (libPromise[name] ??= Promise.all(LIBS[name].map((src) => new Promise((ok, fail) => {
    const el = src.endsWith('.css') ? Object.assign(document.createElement('link'), { rel: 'stylesheet', href: src }) : Object.assign(document.createElement('script'), { src });
    el.onload = ok; el.onerror = () => fail(new Error('Gagal memuat ' + src));
    document.head.appendChild(el);
  }))).then(() => {
    if (name === 'chart') { Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif'; Chart.defaults.color = '#66756c'; }
  }));
}
let charts = [];
async function chart(canvas, cfg) {
  await loadLib('chart');
  if (!canvas.isConnected) return null; // halaman sudah berganti
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }, cfg.options || {});
  const c = new Chart(canvas, cfg); charts.push(c); return c;
}
// export Excel dibuat di server (tanpa pustaka Excel 900 KB di browser)
async function downloadXlsx(filename, sheets) {
  const r = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheets }) });
  if (!r.ok) return toast('Export gagal', true);
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: filename });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// layer peta disimpan di memori; diambil ulang hanya bila berubah
let gisCache = null;
async function gisLayers() {
  const s = stamp.gis_layer;
  if (gisCache && gisCache.s === s) return gisCache.rows;
  const rows = await api.get('/api/t/gis_layer');
  gisCache = { s, rows }; return rows;
}

const emptyBox = (msg) => `<div class="empty"><div class="big">📭</div>${msg}</div>`;
const isDailyOnly = () => !!me && !isAdmin(me) && !(me.peran || []).includes('management') && (me.peran || []).some((r) => r.startsWith('daily_'));

// ================================================================ sidebar & router
const state = { tbl: {} };
let settings = {};

function renderSidebar(info, route) {
  const nav = (href, ico, label, active, extra = '') => `<a class="nav-item ${active ? 'active' : ''}" href="#/${href}"><span class="ico">${ico}</span>${label}${extra}</a>`;
  if (isDailyOnly()) { $('#sidebar').innerHTML = nav('daily', '📋', '<b>Input & Laporan Saya</b>', true); return; }
  let h = nav('', '🏢', '<b>Ringkasan</b>', route === '');
  h += nav('blocks','▦','Blok & Riwayat GIS',route==='blocks');
  h += nav('hub/infra','🚜','Infra & Lahan',route==='hub/infra');
  if (isAdmin(me)) h += nav('laporan', '📄', 'Laporan Owner', route === 'laporan'); // khusus admin
  if (me) h += nav('daily', '📋', '<b>Daily Report</b>', route === 'daily');
  for (const [k, K] of Object.entries(KOM)) {
    const on = route.startsWith('k/' + k);
    const tabs = K.tabs.filter((t) => !t.admin || isAdmin(me)); // tab khusus admin tidak tampil di menu pengunjung
    h += `<div class="nav-sec">${nav('hub/' + k, K.icon, K.nama, route==='hub/'+k)}`;
    if (tabs.length > 1) h += `<div class="nav-sub">${tabs.map((t) => nav(RECORD_ROUTES[k]?.[t.k] ? 'records/'+RECORD_ROUTES[k][t.k] : `k/${k}/${t.k}`, '', t.l, route === `k/${k}/${t.k}` || route.startsWith(`k/${k}/${t.k}/`))).join('')}</div>`;
    h += '</div>';
  }
  h += nav('gis', '🗺️', 'Peta & Lahan', route === 'gis');
  h += nav('excel', '📥', 'Input Excel', route === 'excel');
  if (me) h += `<div class="nav-label">Sistem</div>${nav('riwayat', '🕘', 'Riwayat Perubahan', route === 'riwayat')}${isAdmin(me) ? nav('pengguna', '👥', 'Pengguna & Akses', route === 'pengguna') + nav('pengaturan', '⚙️', 'Pengaturan & Backup', route === 'pengaturan') : ''}`;
  $('#sidebar').innerHTML = h;
}

// ================================================================ catatan mengambang per halaman (kendala dll) — hanya admin yang mengisi, kosong = tidak tampil
const noteMin = {};
function noteKey(r) {
  const [a, b, c] = r.split('/');
  if (!a) return 'ringkasan';
  if (a === 'k' && KOM[b]) return `k/${b}/${c || KOM[b].tabs[0].k}`;
  if (a === 'gis') return 'gis';
  if (a === 't' && TABLES[b]) return 't/' + b;
  return null; // halaman sistem tanpa catatan
}
function renderNote(r) {
  const key = noteKey(r), box = $('#note');
  let n = null;
  try { n = key && settings['note:' + key] ? JSON.parse(settings['note:' + key]) : null; } catch { n = null; }
  if (!key || (!n && !isAdmin(me))) { box.hidden = true; return; }
  box.hidden = false;
  if (!n) { box.className = 'fnote add'; box.innerHTML = '<button class="btn sm" id="nAdd" title="Catatan mengambang untuk halaman ini">📌 Tambah catatan</button>'; $('#nAdd').onclick = () => editNote(key, null, r); return; }
  let min = noteMin[key] === n.ts;
  try { min = min || localStorage.getItem('noteMin:' + key) === n.ts; } catch { /* penyimpanan browser tidak tersedia */ }
  box.className = 'fnote' + (min ? ' min' : '');
  box.innerHTML = min ? '<button class="note-pin" title="Buka catatan">📌</button>'
    : `<div class="note-hd"><b>📌 Catatan</b><span class="sp"></span>${isAdmin(me) ? '<button class="ic" id="nEd" title="Ubah / hapus">✏️</button>' : ''}<button class="ic" id="nMin" title="Kecilkan">–</button></div>
      <div class="note-tx">${esc(n.teks)}</div><div class="note-ft">${esc(n.oleh || '')} · ${new Date(n.ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</div>`;
  const setMin = (v) => { noteMin[key] = v ? n.ts : null; try { v ? localStorage.setItem('noteMin:' + key, n.ts) : localStorage.removeItem('noteMin:' + key); } catch { /* abaikan */ } renderNote(r); };
  if (min) $('.note-pin', box).onclick = () => setMin(false);
  else { $('#nMin').onclick = () => setMin(true); if (isAdmin(me)) $('#nEd').onclick = () => editNote(key, n, r); }
}
function editNote(key, n, r) {
  const md = openModal(`<div class="modal-head"><h2>📌 Catatan Halaman</h2><button class="x">×</button></div>
    <div class="modal-body"><div class="fld"><label>Isi catatan, mis. kendala di lapangan. Tampil mengambang di pojok kanan bawah untuk semua pengunjung halaman ini.</label><textarea id="nTx" rows="6">${esc(n?.teks || '')}</textarea></div></div>
    <div class="modal-foot">${n ? '<button class="btn danger" id="nDel">🗑 Hapus Catatan</button>' : ''}<span class="sp"></span><button class="btn" id="nBatal">Batal</button><button class="btn primary" id="nSimpan">Simpan</button></div>`);
  const save = async (teks) => {
    const v = teks ? JSON.stringify({ teks, oleh: me.nama || me.username, ts: new Date().toISOString() }) : null;
    try { await api.put('/api/settings', { ['note:' + key]: v }); } catch (e) { return toast('Gagal: ' + e.message); }
    settings['note:' + key] = v;
    closeModal(); renderNote(r); toast(v ? 'Catatan disimpan' : 'Catatan dihapus');
  };
  $('#nBatal', md).onclick = closeModal;
  $('#nSimpan', md).onclick = () => save($('#nTx', md).value.trim());
  if (n) $('#nDel', md).onclick = () => confirm('Hapus catatan ini?') && save('');
  $('#nTx', md).focus();
}

async function route() {
  let r = location.hash ? location.hash.replace(/^#\/?/, '') : /^\/daily\/?$/.test(location.pathname) ? 'daily' : '';
  if (isDailyOnly() && r !== 'daily') { location.hash = '#/daily'; return; }
  charts.forEach((c) => c.destroy()); charts = [];
  $('#sidebar').classList.remove('open');
  document.body.classList.toggle('public-summary-mode',!isAdmin(me)&&!isDailyOnly());
  const publicView=(!isAdmin(me)&&!isDailyOnly())||!r||r==='hub'||r.startsWith('hub/');
  if(publicView){
    $('#note').hidden=true;renderSidebar({},r);if(!isAdmin(me))$('#sidebar').innerHTML='<a class="nav-item active" href="#/">Ringkasan kebun</a>';
    return import('./public-summary.js').then(m=>m.renderPublicSummary($('#main'),App));
  }
  $('#main').classList.remove('summary-page');
  if(r==='daily'){renderSidebar({},r);$('#note').hidden=true;return renderDaily($('#main'),App).catch(e=>$('#main').innerHTML='<div class="card">'+esc(e.message)+'</div>');}
  let info;
  try { [info] = await Promise.all([syncAll(r), api.get('/api/settings').then((s) => { settings = s; }).catch(() => {})]); } catch (e) { $('#main').innerHTML = `<div class="card">Server tidak bisa dihubungi: ${esc(e.message)}</div>`; return; }
  renderSidebar(info, r);
  renderNote(r);
  const main = $('#main');
  main.innerHTML = '';
  window.scrollTo(0, 0);
  const [a, b, c, d] = r.split('/');
  if (!a || a==='hub') return import('./hub.js').then(m=>m.renderHub(main,App,b));
  if(a==='detail')return renderOwner(main,App);
  if(a==='records' && TABLES[b])return import('./hub.js').then(m=>m.renderRecords(main,App,b));
  if(a==='blocks')return import('./block-ui.js').then(m=>m.renderBlocks(main,App));
  if (a === 'owner') { location.hash = '#/'; return; }
  if (a === 'laporan') return isAdmin(me) ? renderLaporan(main, App) : (main.innerHTML = emptyBox('Laporan Owner khusus admin — silakan login sebagai admin.'));
  if (a === 'daily') { if (!me) { main.innerHTML = emptyBox('Daily Report hanya untuk pengguna yang sudah login.'); openLogin(); return; } return renderDaily(main, App).catch((e) => { main.innerHTML = `<div class="card">Daily Report gagal dimuat: ${esc(e.message)}</div>`; }); }
  if (a === 'k' && KOM[b]) return renderKomoditas(main, App, b, c, d);
  if (a === 'pengguna' && isAdmin(me)) return renderUsers(main);
  if (a === 't' && TABLES[b]) return renderTable(main, b);
  if (a === 'gis') return renderGIS(main, App);
  if (a === 'riwayat' && me) return renderLog(main);
  if (a === 'excel') return renderExcel(main);
  if (a === 'pengaturan' && isAdmin(me)) return renderSettings(main);
  main.innerHTML = emptyBox('Halaman tidak ditemukan');
}
window.addEventListener('hashchange', route);
$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');


// ================================================================ HALAMAN TABEL
function renderTable(main, table, opts = {}) {
  const T = TABLES[table];
  const d = DIVISIONS.find((x) => x.key === T.div);
  const S = (state.tbl[table] ??= { q: '', from: '', to: '', ref: '', sort: T.sort || '-id', limit: 50, sel: new Set() });
  const refF = T.f.find((f) => f.t === 'ref');
  const TC = T.f.filter((f) => !f.sembunyi); // kolom yang tampil di tabel
  const base = () => ctx.rows(table).filter((r) => !opts.filter || opts.filter(r));
  const refVals = refF ? [...new Set(base().map((r) => r[refF.k]).filter(Boolean))].sort() : [];
  const done = () => (opts.onChange ? opts.onChange() : draw());
  const addBtn = can(table) ? '<button class="btn primary" id="bAdd">＋ Tambah</button>' : me ? '<span class="tag" title="Akun Anda tidak bisa mengubah tabel ini">👁 Hanya lihat</span>' : '<span class="tag" title="Login sebagai admin untuk menambah / mengubah">🔒 Login untuk mengubah</span>';
  main.innerHTML = `
    <div class="page-head" ${opts.embed ? 'style="margin-bottom:10px"' : ''}>
      <div>${opts.embed ? `<h3 style="margin:0">${esc(T.title)}</h3>` : `<div class="crumb"><a href="#/">${d.icon} ${d.name}</a> › Tabel</div><h1>${esc(T.title)}</h1>`}${T.desc ? `<p class="desc">${esc(T.desc)}</p>` : ''}</div>
      <div class="actions">
        ${addBtn}
        <button class="btn" id="bExp">⬇ Export Excel</button>
      </div>
    </div>
    <div class="toolbar">
      <input class="search" id="fq" placeholder="Cari…" value="${esc(S.q)}">
      ${T.date ? `<label class="small muted">Dari</label><input type="date" id="ff" value="${S.from}"><label class="small muted">s/d</label><input type="date" id="ft" value="${S.to}">
        <button class="btn sm" id="fMonth">Bulan ini</button><button class="btn sm" id="fAll">Semua</button>` : ''}
      ${refF ? `<select id="fr"><option value="">Semua ${esc(refF.l)}</option>${refVals.map((v) => `<option ${v === S.ref ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : ''}
      <button class="btn sm danger" id="bDelSel" hidden>🗑 Hapus terpilih</button>
      <span class="info" id="info"></span>
    </div>
    <div class="table-wrap ${can(table) ? '' : 'ro'}"><table class="data" id="tbl"></table></div>
    <div id="more" style="margin-top:8px"></div>`;

  const draw = () => {
    if (!$('#tbl') || !$('#info')) return; // halaman sudah berganti
    let rows = base().map((r) => ({ r, v: Object.fromEntries(T.f.map((f) => [f.k, val(table, f, r)])) }));
    if (T.date && S.from) rows = rows.filter((x) => String(x.r[T.date] || '') >= S.from);
    if (T.date && S.to) rows = rows.filter((x) => String(x.r[T.date] || '') <= S.to);
    if (refF && S.ref) rows = rows.filter((x) => x.r[refF.k] === S.ref);
    if (S.q) { const q = S.q.toLowerCase(); rows = rows.filter((x) => T.f.some((f) => String(fmtField(f, x.v[f.k]) ?? '').toLowerCase().includes(q))); }
    const desc = S.sort.startsWith('-'), sk = S.sort.replace(/^-/, '');
    const sf = T.f.find((f) => f.k === sk);
    rows.sort((a, b) => {
      const va = sf ? a.v[sk] : a.r[sk], vb = sf ? b.v[sk] : b.r[sk];
      const c = sf && isNumField(sf) ? n(va) - n(vb) : String(va ?? '').localeCompare(String(vb ?? ''), 'id', { numeric: true });
      return desc ? -c : c || a.r.id - b.r.id;
    });
    const shown = rows.slice(0, S.limit);
    const tbl = $('#tbl');
    tbl.innerHTML = `<thead><tr><th class="chk"><input type="checkbox" id="chkAll"></th>${TC.map((f) => `<th data-k="${f.k}" class="${isNumField(f) ? 'num' : ''} ${f.t === 'calc' ? 'calc' : ''}" title="${f.t === 'calc' ? 'Dihitung otomatis' : ''}">${esc(f.l)}${sk === f.k ? (desc ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((x) => `<tr data-id="${x.r.id}" class="${S.sel.has(x.r.id) ? 'sel' : ''}"><td class="chk"><input type="checkbox" ${S.sel.has(x.r.id) ? 'checked' : ''}></td>${TC.map((f) => `<td class="${isNumField(f) ? 'num' : ''} ${f.t === 'calc' ? 'calc' : ''}">${esc(fmtField(f, x.v[f.k]))}</td>`).join('')}</tr>`).join('')}</tbody>
      ${rows.length && TC.some(isSumField) ? `<tfoot><tr><td class="chk"></td>${TC.map((f, i) => `<td class="${isNumField(f) ? 'num' : ''}">${isSumField(f) ? esc(fmtField(f.t === 'calc' ? f : { ...f, t: f.t === 'num' ? 'num2' : f.t }, rows.reduce((a, x) => a + n(x.v[f.k]), 0))) : i === 0 ? 'Total' : ''}</td>`).join('')}</tr></tfoot>` : ''}`;
    if (!rows.length) tbl.innerHTML += `<tbody><tr><td colspan="${TC.length + 1}">${emptyBox(base().length ? 'Tidak ada data yang cocok dengan filter.' : 'Belum ada data.')}</td></tr></tbody>`;
    $('#info').textContent = `${fmtNum(rows.length)} baris${rows.length > shown.length ? ` (tampil ${shown.length})` : ''}`;
    $('#more').innerHTML = rows.length > shown.length ? `<button class="btn sm" id="bMore">Tampilkan 50 berikutnya</button>` : '';
    $('#bMore')?.addEventListener('click', () => { S.limit += 50; draw(); });
    $('#bDelSel').hidden = !S.sel.size;
    $('#bDelSel').textContent = `🗑 Hapus ${S.sel.size} terpilih`;
    $$('thead th[data-k]', tbl).forEach((th) => (th.onclick = () => { S.sort = S.sort === th.dataset.k ? '-' + th.dataset.k : th.dataset.k; draw(); }));
    $$('tbody tr[data-id]', tbl).forEach((tr) => {
      const id = Number(tr.dataset.id);
      tr.onclick = (e) => {
        if (e.target.type === 'checkbox') { e.target.checked ? S.sel.add(id) : S.sel.delete(id); tr.classList.toggle('sel', e.target.checked); $('#bDelSel').hidden = !S.sel.size; $('#bDelSel').textContent = `🗑 Hapus ${S.sel.size} terpilih`; return; }
        if (e.target.closest('td.chk')) return;
        openForm(table, ctx.rows(table).find((r) => r.id === id), { onSaved: done });
      };
    });
    $('#chkAll').onchange = (e) => { shown.forEach((x) => (e.target.checked ? S.sel.add(x.r.id) : S.sel.delete(x.r.id))); draw(); };
    draw.rows = rows;
  };
  draw();

  $('#fq').oninput = (e) => { S.q = e.target.value; draw(); };
  if (T.date) {
    $('#ff').onchange = (e) => { S.from = e.target.value; draw(); };
    $('#ft').onchange = (e) => { S.to = e.target.value; draw(); };
    $('#fMonth').onclick = () => { const m = thisYM(); S.from = m + '-01'; S.to = util.iso(new Date(+m.slice(0, 4), +m.slice(5), 0)); $('#ff').value = S.from; $('#ft').value = S.to; draw(); };
    $('#fAll').onclick = () => { S.from = S.to = ''; $('#ff').value = $('#ft').value = ''; draw(); };
  }
  if (refF) $('#fr').onchange = (e) => { S.ref = e.target.value; draw(); };
  $('#bAdd')?.addEventListener('click', () => openForm(table, null, { onSaved: done, prefill: opts.prefill }));
  $('#bExp').onclick = () => exportRows(table, draw.rows.map((x) => x.r));
  $('#bDelSel').onclick = async () => {
    if (!confirm(`Hapus ${S.sel.size} baris dari "${T.title}"? (Backup otomatis tetap tersimpan saat server dinyalakan)`)) return;
    try {
      const r = await delLinked(() => api.post(`/api/t/${table}/hapus`, { ids: [...S.sel] }), () => api.post(`/api/t/${table}/hapus`, { ids: [...S.sel], cascade: true }));
      if (!r) return;
      S.sel.clear(); await syncAll(); toast(`${r.deleted} data terhapus${r.related ? ` + ${r.related} data terkait` : ''}`); done();
    } catch (e) { toast(e.message, true); }
  };
}

// hapus yang punya data terkait: tanya dulu, lalu hapus bersama data terkaitnya
async function delLinked(plain, cascade) {
  try { return await plain(); } catch (e) {
    if (e.status !== 409) throw e;
    const list = (e.data?.refs || []).map((x) => `• ${x.tabel}: ${x.n} data`).join('\n');
    if (!confirm(`Data ini dipakai oleh:\n${list}\n\nHapus juga semua data terkait tersebut?\n(Pilih Batal untuk membatalkan — tidak ada yang dihapus.)`)) return null;
    return cascade();
  }
}

// ================================================================ FORM
function refOptions(f) { if(['lahan_blok','pisang_blok','padi_petak'].includes(f.ref)&&App.blockOptions)return App.blockOptions.filter(b=>f.ref==='pisang_blok'?b.divisi==='Pisang':f.ref==='padi_petak'?b.divisi==='Padi':true).map(b=>b.nama); return [...new Set(ctx.rows(f.ref).map((r) => displayOf(f.ref, r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })); }

export async function openForm(table, row, { onSaved, prefill } = {}) {
  const group=TABLES[table].div;
  const needed=new Set([table,...neededTables(group==='pisang'?'k/pisang':group==='padi'?'k/padi':group==='lahan'?'gis':'')]);
  for(const t of [...needed])for(const f of TABLES[t]?.f || [])if(f.t==='ref')needed.add(f.ref);
  await Promise.all([...needed].filter(t=>!t.startsWith('daily_')).map(loadTable));
  const registry=await api.get('/api/blocks');
  App.blockOptions=registry.filter(b=>b.active&&b.layer_id&&b.ownership==='Sudah milik kebun');
  const T = TABLES[table];
  const isNew = !row;
  const ro = !can(table);
  if (ro && isNew) return me ? toast('Akun Anda tidak bisa menambah data di sini', true) : openLogin();
  const data = { ...(row || {}) };
  if (isNew) {
    if(T.date)data[T.date]=util.iso(util.today());
    for (const f of T.f) {
      if (f.t === 'date' && f.req) data[f.k] = util.iso(util.today());
      if (f.k === 'tahun') data[f.k] = util.today().getFullYear();
    }
    Object.assign(data, openForm.keep?.[table] || {}, prefill || {});
  }
  const input = (f) => {
    const v = data[f.k] ?? '';
    const id = `f_${f.k}`;
    if (f.t === 'calc') return `<div class="calcv" id="${id}"></div>`;
    if (f.t === 'area') return `<textarea id="${id}" rows="2">${esc(v)}</textarea>`;
    if (f.t === 'select') {
      const opts = [...f.opt]; if (v && !opts.includes(v)) opts.push(v);
      return `<select id="${id}"><option value=""></option>${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }
    if (f.t === 'ref' || f.sug) {
      const opts = f.t === 'ref' ? refOptions(f) : f.sug;
      return `<input id="${id}" list="dl_${f.k}" value="${esc(v)}" autocomplete="off"><datalist id="dl_${f.k}">${opts.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`;
    }
    if (f.t === 'date') return `<input id="${id}" type="date" value="${esc(String(v).slice(0, 10))}">`;
    if (['int', 'num', 'money'].includes(f.t)) return `<input id="${id}" type="number" step="${f.t === 'int' ? 1 : 'any'}" value="${esc(v)}" inputmode="decimal">`;
    return `<input id="${id}" value="${esc(v)}">`;
  };
  const md = openModal(`
    <div class="modal-head"><h2>${ro ? 'Detail' : isNew ? 'Tambah' : 'Ubah'} · ${esc(T.title)}</h2><button class="x">×</button></div>
    <div class="modal-body"><div class="form-grid">
      ${T.f.map((f) => `<div class="fld ${f.t === 'area' ? 'full' : ''}" data-k="${f.k}"><label>${esc(f.l)}${f.req ? ' <span class="req">*</span>' : ''}${f.t === 'calc' ? ' <span class="small">(otomatis)</span>' : ''}${f.t === 'ref' ? ` <a class="small" href="#/t/${f.ref}" title="Kelola ${esc(TABLES[f.ref].title)}">↗</a>` : ''}</label>${input(f)}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`).join('')}
    </div></div>
    <div class="modal-foot">${ro ? (me ? '<span class="small muted">👁 Hanya lihat — akun Anda tidak bisa mengubah data ini.</span>' : '<span class="small muted">🔒 Login sebagai admin untuk mengubah data ini.</span>') + '<span class="sp"></span><button class="btn" id="bCancel">Tutup</button>' : `
      ${!isNew ? '<button class="btn danger" id="bDel">🗑 Hapus</button>' : ''}
      <span class="sp"></span>
      <button class="btn" id="bCancel">Batal</button>
      ${isNew ? '<button class="btn" id="bSaveMore">Simpan & tambah lagi</button>' : ''}
      <button class="btn primary" id="bSave">Simpan</button>`}
    </div>`);
  if (ro) { $$('input, select, textarea', md).forEach((el) => (el.disabled = true)); $('#bCancel', md).onclick = closeModal; return; }
  const read = () => {
    const out = {};
    for (const f of T.f) if (f.t !== 'calc') { const el = $(`#f_${f.k}`, md); out[f.k] = el.value === '' ? null : el.value; }
    return out;
  };
  const refreshCalc = () => {
    const r = { ...data, ...read() };
    for (const f of T.f) if (f.t === 'calc') $(`#f_${f.k}`, md).textContent = fmtField(f, val(table, f, r)) || '–';
  };
  refreshCalc();
  md.addEventListener('input', refreshCalc);
  $('#bCancel', md).onclick = closeModal;
  setTimeout(() => $('input, select', md)?.focus(), 30);

  const save = async (more) => {
    let r = read();
    if (T.lengkapi) { r = T.lengkapi(r, isNew ? null : row); for (const f of T.f) if (f.t !== 'calc' && r[f.k] != null) { const el = $(`#f_${f.k}`, md); if (el && el.value !== String(r[f.k])) { if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === r[f.k])) el.add(new Option(r[f.k])); el.value = r[f.k]; } } } // mis. Penjualan: Bentuk/Kelas/Kondisi ⇄ Jenis Barang
    // nama induk diketik bebas (datalist): beda huruf besar/kecil/spasi → dibetulkan; aktivitas tak dikenal → ditolak; lainnya → konfirmasi
    const kunci = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const f of T.f.filter((x) => x.t === 'ref' && r[x.k] != null && r[x.k] !== '')) {
      const hit = refOptions(f).find((o) => kunci(o) === kunci(r[f.k]));
      if (hit) { if (hit !== r[f.k]) { r[f.k] = hit; $(`#f_${f.k}`, md).value = hit; } continue; }
      if (f.ref === 'lahan_aktivitas') { $(`.fld[data-k="${f.k}"]`, md).classList.add('err'); return toast(`${f.l} "${r[f.k]}" tidak ada di daftar ${TABLES[f.ref].title} — pilih dari daftar`, true); }
      if (!confirm(`${f.l} "${r[f.k]}" tidak ada di daftar ${TABLES[f.ref].title}.\nTetap simpan?`)) return;
    }
    let bad = false;
    for (const f of T.f) {
      const el = $(`.fld[data-k="${f.k}"]`, md);
      const miss = f.req && (r[f.k] == null || r[f.k] === '');
      el.classList.toggle('err', miss); bad ||= miss;
    }
    if (bad) return toast('Lengkapi kolom bertanda *', true);
    try {
      const res = isNew ? await api.post(`/api/t/${table}`, r) : await api.put(`/api/t/${table}/${row.id}`, r);
      await syncAll();
      toast(isNew ? 'Data tersimpan' : res?._related ? `Perubahan tersimpan · ${res._related} data terkait ikut diperbarui` : 'Perubahan tersimpan');
      if (more) {
        // bawa tanggal & pilihan referensi ke input berikutnya
        openForm.keep ??= {};
        openForm.keep[table] = Object.fromEntries(T.f.filter((f) => ['date', 'ref', 'select'].includes(f.t)).map((f) => [f.k, r[f.k]]));
        onSaved?.(); openForm(table, null, { onSaved });
      } else { closeModal(); onSaved?.(); }
    } catch (e) { toast('Gagal menyimpan: ' + e.message, true); }
  };
  $('#bSave', md).onclick = () => save(false);
  $('#bSaveMore', md)?.addEventListener('click', () => save(true));
  md.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); save(false); } });
  $('#bDel', md)?.addEventListener('click', async () => {
    if (!confirm('Hapus data ini?')) return;
    try {
      const r = await delLinked(() => api.del(`/api/t/${table}/${row.id}`), () => api.del(`/api/t/${table}/${row.id}?cascade=1`));
      if (!r) return;
      await syncAll(); toast(r.related ? `Data terhapus + ${r.related} data terkait` : 'Data terhapus'); closeModal(); onSaved?.();
    } catch (e) { toast(e.message, true); }
  });
}

// ================================================================ EXPORT
function sheetRows(table, rows) {
  const T = TABLES[table];
  return rows.map((r) => Object.fromEntries(T.f.map((f) => {
    const v = val(table, f, r);
    const k = f.t === 'calc' ? f.fmt : f.t;
    return [f.l, v == null || v === '' ? '' : ['int', 'num', 'num1', 'num2', 'money', 'pct'].includes(k) ? Number(v) : k === 'date' ? fmtDate(v) : v];
  })));
}
function exportRows(table, rows) {
  downloadXlsx(`${TABLES[table].title} ${util.iso(util.today())}.xlsx`, [{ name: TABLES[table].title, header: TABLES[table].f.map((f) => f.l), rows: sheetRows(table, rows) }]);
}
function exportAll() {
  const sheets = [];
  for (const d of DIVISIONS) for (const t of d.tables) sheets.push({ name: `${d.name.slice(0, 6)}-${TABLES[t].title}`, header: TABLES[t].f.map((f) => f.l), rows: sheetRows(t, ctx.rows(t)) });
  downloadXlsx(`Data Kebun ${util.iso(util.today())}.xlsx`, sheets);
}

// ================================================================ RIWAYAT & PENGATURAN
// ================================================================ INPUT EXCEL
function excelReportTable(rep) {
  if (!rep) return '<div class="small muted">Belum pernah sinkron.</div>';
  if (rep.gagal) return `<div style="color:var(--danger)">Sinkron gagal: ${esc(rep.gagal)}</div>`;
  const color = (s) => (s.startsWith('diperbarui') || s.startsWith('akan') ? 'var(--ok)' : s.startsWith('ada kesalahan') ? 'var(--danger)' : s.startsWith('tidak berubah') ? 'var(--muted)' : 'var(--warn)');
  return `${(rep.peringatan || []).map((p) => `<div class="card" style="background:#fff7e6;border-color:#f3d6a6;margin-bottom:8px">⚠ ${esc(p)}</div>`).join('')}
    <table class="mini"><tr><th>Sheet</th><th>Status</th><th class="num">Baris di Excel</th><th class="num">Baris baru</th><th class="num">Baris direvisi</th></tr>
    ${rep.sheets.map((s) => `<tr><td><b>${esc(s.sheet)}</b></td><td style="color:${color(s.status)}">${esc(s.status)}</td><td class="num">${fmtNum(s.baris)}</td><td class="num">${s.tambah ? '+' + fmtNum(s.tambah) : ''}</td><td class="num">${s.ubah ? fmtNum(s.ubah) : ''}</td></tr>
      ${s.koreksi?.length ? `<tr><td></td><td colspan="4" class="small" style="color:var(--ok)">✔ Dibetulkan otomatis (beda huruf besar/kecil atau spasi): ${s.koreksi.map(esc).join('; ')}</td></tr>` : ''}
      ${s.peringatan?.length ? `<tr><td></td><td colspan="4" class="small" style="color:var(--warn)">⚠ ${s.peringatan.map(esc).join('<br>⚠ ')}</td></tr>` : ''}
      ${s.jumlahError ? `<tr><td></td><td colspan="4" class="small" style="color:var(--danger)">${s.errors.map((e) => `Baris ${e.row}: ${esc(e.msg)}`).join('<br>')}${s.jumlahError > s.errors.length ? `<br>… dan ${s.jumlahError - s.errors.length} kesalahan lain` : ''}</td></tr>` : ''}`).join('')}
    </table>${rep.backup ? `<p class="small muted" style="margin:6px 0 0">Backup sebelum sinkron: ${esc(rep.backup)}</p>` : ''}`;
}
// ================================================================ Excel per halaman: download → isi/ubah → upload (hanya data halaman itu)
const EXCEL_TABLES = new Set(EXCEL_SHEETS.map((s) => s.table));
function excelPanel(el, { tables, kom, label, onDone }) {
  const T = (tables || []).filter((t) => EXCEL_TABLES.has(t));
  if (!el || !T.length) return;
  const qs = `tables=${T.join(',')}${kom ? `&kom=${encodeURIComponent(kom)}` : ''}&panel=${encodeURIComponent(label)}`;
  const bolehUp = !!me && T.every((t) => can(t));
  el.innerHTML = `<a class="btn" href="/api/excel/download?${qs}" title="Download data halaman ini ke Excel untuk diisi / diubah">⬇ Excel</a>${bolehUp ? '<button class="btn" id="xpUp" title="Upload Excel halaman ini — hanya data halaman ini yang diperbarui">⬆ Upload Excel</button><input type="file" id="xpF" accept=".xlsx" hidden>' : ''}`;
  if (!bolehUp) return;
  const f = $('#xpF', el);
  $('#xpUp', el).onclick = () => f.click();
  f.onchange = async () => {
    const file = f.files[0]; f.value = ''; if (!file) return;
    const buf = await file.arrayBuffer();
    const go = async (preview) => {
      const r = await fetch(`/api/excel/upload?${qs}${preview ? '&preview=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
    };
    const md = openModal(`<div class="modal-head"><h2>⬆ Upload Excel · ${esc(label)}</h2><button class="x">×</button></div>
      <div class="modal-body"><div class="small muted" style="margin-bottom:8px">File: <b>${esc(file.name)}</b> — hanya data halaman ini yang diperbarui, data halaman lain tidak tersentuh.</div><div id="xpB">Membaca file…</div></div>
      <div class="modal-foot"><span class="sp"></span><button class="btn" id="xpNo">Batal</button><button class="btn primary" id="xpOk" disabled>Terapkan</button></div>`, true);
    $('#xpNo', md).onclick = closeModal;
    try {
      const pv = await go(true);
      const n = pv.sheets.filter((s) => s.status.startsWith('akan')).length;
      const tidakAda = pv.sheets.every((s) => s.status.startsWith('sheet tidak ada'));
      $('#xpB', md).innerHTML = excelReportTable(pv) + (tidakAda ? '<p style="color:var(--danger)">File ini tidak berisi sheet untuk halaman ini. Pakai file dari tombol "⬇ Excel" di halaman ini.</p>' : n ? '' : '<p class="small muted">Tidak ada perubahan untuk diterapkan.</p>');
      const ok = $('#xpOk', md);
      ok.disabled = !n; if (n) ok.textContent = `Terapkan ${n} sheet`;
      ok.onclick = async () => {
        ok.disabled = true; ok.textContent = 'Menerapkan…';
        try { await go(false); closeModal(); await syncAll(); toast('Data dari Excel sudah diterapkan'); onDone?.(); }
        catch (e) { toast(e.message, true); ok.disabled = false; ok.textContent = `Terapkan ${n} sheet`; }
      };
    } catch (e) { $('#xpB', md).innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`; }
  };
}

async function renderExcel(main) {
  const st = await api.get('/api/excel/status');
  const rep = st.laporan;
  main.innerHTML = `<div class="page-head"><div><h1>📥 Input Excel</h1>
      <p class="desc">${st.online ? 'Isi data lewat Excel: download file berisi data terbaru, ubah/tambah/hapus baris, lalu upload kembali.' : 'Isi data lewat Excel: ubah, tambah, atau hapus baris di file Excel lalu <b>simpan</b> — aplikasi otomatis ikut ter-update dalam beberapa detik. Perubahan lewat aplikasi juga otomatis ditulis ke file Excel.'}</p></div>
      <div class="actions"><a class="btn primary" href="/api/excel/download">⬇ Download Excel (data terbaru)</a></div></div>
    <div class="cols-2">
      ${st.online ? `<div class="card"><h3>Isi lewat Excel (versi online)</h3>
        <ol class="small" style="margin:6px 0 0;padding-left:18px;line-height:1.7"><li>Klik <b>Download Excel</b> — isinya data terbaru.</li><li>Ubah / tambah / hapus baris, lalu simpan.</li><li>Upload file itu di kotak sebelah (khusus admin) → periksa ringkasan perubahan → <b>Terapkan</b>.</li></ol>
      </div>` : `<div class="card"><h3>File Excel input</h3>
        <div class="small muted">Lokasi file (di komputer server):</div>
        <div style="font-family:monospace;font-size:12.5px;background:#f3f6f4;padding:8px;border-radius:6px;margin:4px 0 10px;word-break:break-all">${esc(st.file)}</div>
        <table class="mini">
          <tr><td>Terakhir disimpan</td><td>${st.diubah ? new Date(st.diubah).toLocaleString('id-ID') : 'belum ada'}</td></tr>
          <tr><td>Sedang dibuka di Excel</td><td>${st.sedangDibuka ? '🟢 Ya' : 'Tidak'}</td></tr>
          ${st.stale ? `<tr><td colspan="2" style="color:var(--warn)">⚠ Ada perubahan dari aplikasi sejak ${new Date(st.staleSince).toLocaleString('id-ID')} yang belum masuk ke file (file sedang dibuka). Tutup Excel — file akan diperbarui otomatis. Kalau Excel disimpan sebelum itu, isi Excel yang dipakai.</td></tr>` : ''}
        </table>
        <p class="small muted" style="margin:10px 0 0">Buka file itu langsung di komputer ini (dobel klik), isi, lalu Ctrl+S. Dari HP/komputer lain: download → isi → upload di sini (khusus admin).</p>
      </div>`}
      <div class="card"><h3>Upload Excel</h3>
        ${isAdmin(me) ? `<p class="small muted">Pilih file Excel hasil isian. Aplikasi menampilkan dulu apa yang akan berubah sebelum diterapkan.</p>
          <input type="file" id="xF" accept=".xlsx"><div id="xP" style="margin-top:10px"></div>` : `<p class="small muted">${me ? 'Upload Excel khusus admin.' : 'Login sebagai admin untuk upload Excel.'}</p>`}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Hasil sinkron terakhir ${rep?.waktu ? `· ${new Date(rep.waktu).toLocaleString('id-ID')} · ${esc(rep.oleh || '')}` : ''}</h3>${excelReportTable(rep)}</div>`;
  const f = $('#xF');
  if (f) f.onchange = async () => {
    const file = f.files[0]; if (!file) return;
    const buf = await file.arrayBuffer();
    const send = async (preview) => {
      const r = await fetch('/api/excel/upload' + (preview ? '?preview=1' : ''), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
    };
    $('#xP').innerHTML = 'Membaca file…';
    try {
      const pv = await send(true);
      const n = pv.sheets.filter((s) => s.status.startsWith('akan')).length;
      $('#xP').innerHTML = `${excelReportTable(pv)}<div style="margin-top:10px;display:flex;gap:8px">${n ? `<button class="btn primary" id="xOk">Terapkan ${n} sheet</button>` : '<span class="small muted">Tidak ada perubahan untuk diterapkan.</span>'}<button class="btn" id="xNo">Batal</button></div>`;
      $('#xNo').onclick = () => { f.value = ''; $('#xP').innerHTML = ''; };
      $('#xOk')?.addEventListener('click', async () => {
        try { await send(false); await syncAll(); toast('Data dari Excel sudah diterapkan'); renderExcel(main); } catch (e) { toast(e.message, true); }
      });
    } catch (e) { $('#xP').innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`; }
  };
}
// pantau sinkron Excel di latar: kalau ada data baru dari Excel, muat ulang halaman yang sedang dibuka
let lastExcelTs = null;
setInterval(async () => {
  if (server.vercel || document.hidden || !me) return;
  try {
    const st = await api.get('/api/excel/status'); const ts = st.laporan?.waktu;
    if (lastExcelTs && ts && ts !== lastExcelTs && st.laporan.sheets?.some((s) => s.status === 'diperbarui') && $('#modal').hidden) {
      toast('Data diperbarui dari Excel'); route();
    }
    lastExcelTs = ts || lastExcelTs;
  } catch {}
}, 10000);

async function renderLog(main) {
  main.innerHTML = `<div class="page-head"><div><h1>🕘 Riwayat Perubahan</h1><p class="desc">Setiap tambah, ubah, dan hapus data tercatat di sini (500 terakhir).</p></div></div><div class="table-wrap" id="lg">Memuat…</div>`;
  const rows = await api.get('/api/log?limit=500');
  $('#lg').innerHTML = rows.length ? `<table class="data"><thead><tr><th>Waktu</th><th>Oleh</th><th>Aksi</th><th>Tabel</th><th>ID</th><th>Data</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="nowrap">${new Date(r.ts).toLocaleString('id-ID')}</td><td>${esc(r.oleh || '')}</td><td>${esc(r.aksi)}</td><td>${esc(TABLES[r.tabel]?.title || (r.tabel === '_users' ? 'Pengguna' : r.tabel))}</td><td>${r.row_id ?? ''}</td><td class="small muted" style="white-space:normal;max-width:600px">${esc(r.data || '')}</td></tr>`).join('')}</tbody></table>` : emptyBox('Belum ada perubahan.');
}

async function renderSettings(main) {
  const bk = await api.get('/api/backups');
  main.innerHTML = `<div class="page-head"><div><h1>⚙️ Pengaturan & Backup</h1></div></div>
    <div class="cols-2">
      <div class="card"><h3>Identitas</h3>
        <div class="fld"><label>Nama kebun / perusahaan (tampil di atas)</label><input id="sName" value="${esc(settings.nama || '')}" placeholder="Monitoring Kebun"></div>
        <div style="margin-top:10px"><button class="btn primary" id="sSave">Simpan</button></div>
      </div>
      <div class="card"><h3>Backup data</h3>
        <p class="small muted">${server.vercel ? 'Versi online: data tersimpan di database online (Turso). Klik "Download backup database" sesekali untuk menyimpan salinan di komputer.' : `Database: <code>${server.online ? 'online (Turso) — salinan cadangan tetap disimpan di komputer ini' : 'data/kebun.db'}</code>. Backup otomatis (terkompres .db.gz) dibuat saat server dinyalakan bila ada perubahan & sebelum setiap sinkron Excel — 10 terakhir disimpan di <code>data/backup</code>.`}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn primary" href="/api/backup">⬇ Download backup database</a>${server.vercel ? '' : '<button class="btn" id="bBk">Buat backup sekarang</button>'}<button class="btn" id="bExpAll">⬇ Export semua data (Excel)</button></div>
        ${bk.length ? `<table class="mini" style="margin-top:10px"><tr><th>File backup</th><th class="num">Ukuran</th></tr>${bk.slice(0, 8).map((b) => `<tr><td>${esc(b.file)}</td><td class="num">${fmtNum(b.size / 1024)} KB</td></tr>`).join('')}</table>` : ''}
      </div>
      <div class="card"><h3>Pindahkan / pulihkan database</h3>
        <p class="small muted">Ganti <b>seluruh</b> isi data dengan file database (.db hasil "Download backup database", atau .db.gz dari folder backup) — mis. memindahkan data dari komputer kantor ke versi online. Akun pengguna ikut dari file tersebut; semua orang perlu login ulang.</p>
        <input type="file" id="rsF" accept=".db,.gz"><div id="rsP" class="small" style="margin-top:8px"></div>
      </div>
      ${server.vercel ? '' : `<div class="card"><h3>Akses dari HP / komputer lain</h3>
        <p class="small">Selama server menyala, perangkat lain di jaringan WiFi yang sama bisa membuka alamat <b>Jaringan/HP</b> yang tampil di jendela server (contoh <code>http://192.168.x.x:3000</code>). Jika tidak bisa, izinkan Node.js di Windows Firewall (jaringan Private).</p>
      </div>
      <div class="card"><h3>Menambah kolom / tabel baru</h3>
        <p class="small">Struktur data ada di <code>public/js/schema.js</code>. Tambahkan field baru di tabel yang diinginkan, lalu tutup & jalankan ulang server — kolom baru otomatis dibuat tanpa menghapus data lama.</p>
      </div>`}
    </div>`;
  $('#sSave').onclick = async () => { await api.put('/api/settings', { nama: $('#sName').value }); settings.nama = $('#sName').value; applySettings(); toast('Tersimpan'); };
  $('#rsF').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm(`Ganti SELURUH data dengan isi "${file.name}"?
Data yang ada sekarang akan diganti (salinan cadangan dibuat dulu bila memungkinkan).`)) { e.target.value = ''; return; }
    $('#rsP').textContent = 'Mengirim & memulihkan…';
    try {
      let body = file;
      const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      if (!(head[0] === 0x1f && head[1] === 0x8b) && window.CompressionStream) body = await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob(); // dikompres agar muat batas upload online
      const r = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText);
      const n = Object.entries(j.counts || {}).filter(([k]) => !k.startsWith('_')).reduce((a, [, v]) => a + v, 0);
      alert(`Database dipulihkan: ${fmtNum(n)} baris data, ${fmtNum(j.counts?._users || 0)} akun.
Silakan login ulang — bisa dengan akun dari file, atau akun Anda sekarang (${me.username}).`);
      location.hash = '#/'; location.reload();
    } catch (err) { $('#rsP').innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`; e.target.value = ''; }
  };
  if ($('#bBk')) $('#bBk').onclick = async () => { const r = await api.post('/api/backup'); toast('Backup dibuat: ' + r.file); renderSettings(main); };
  $('#bExpAll').onclick = exportAll;
}
function applySettings() {
  const nm = settings.nama || 'PT VIGU FARM INDONESIA';
  $('#brandName').textContent = nm; document.title = nm;
}

// ================================================================ start
export const App = { tables: TABLES, api, cache, ctx, loadTable, openForm, renderTable, excelPanel, chart, loadLib, downloadXlsx, gisLayers, openModal, closeModal, toast, esc, fmtNum, fmtField, fmtDate, fmtPct, val, can, me: () => me, isAdmin: () => isAdmin(me), settings: () => settings, saveSettings: (o) => { Object.assign(settings, o); return isAdmin(me) ? api.put('/api/settings', o) : Promise.resolve(); } };
// ================================================================ LOGIN & PENGGUNA
const peranLabel = (u) => (u.peran || []).map((r) => ROLES[r]?.label || r).join(', ') || '—';
function renderUserChip() {
  const el = $('.top-right');
  el.innerHTML = me ? `<span class="user-chip" title="${esc(peranLabel(me))}">👤 ${esc(me.nama || me.username)} <span class="small">· ${esc(peranLabel(me))}</span></span>
    <button class="btn sm" id="uPw" style="margin-left:8px">Ganti password</button><button class="btn sm" id="uOut" style="margin-left:4px">Keluar</button>`
    : `<button class="btn sm login-btn" id="uIn">🔐 ${needSetup ? 'Buat Admin' : 'Login Admin'}</button>`;
  $('#uOut')?.addEventListener('click', async () => { await api.post('/api/logout'); me = null; renderUserChip(); route(); toast('Anda keluar — mode lihat saja'); });
  $('#uPw')?.addEventListener('click', changePassword);
  $('#uIn')?.addEventListener('click', openLogin);
}
let needSetup = false;
function openLogin() {
  if (!$('#modal').hidden && $('#authF')) return;
  const setup = needSetup;
  const md = openModal(`<div class="modal-head"><h2>${setup ? 'Buat akun admin pertama' : '🔐 Login Admin'}</h2><button class="x">×</button></div>
    <form id="authF"><div class="modal-body"><div class="grid" style="gap:10px">
      <p class="small muted" style="margin:0">${setup ? 'Belum ada pengguna. Akun admin ini dipakai untuk membuat akun bagian penjualan, panen, dll.' : 'Login untuk menambah & mengubah data. Tanpa login, ringkasan kebun tetap tersedia. Rincian input hanya untuk admin.'}</p>
      ${setup ? '<div class="fld"><label>Nama lengkap</label><input id="aNama" required></div>' : ''}
      <div class="fld"><label>Username</label><input id="aUser" autocomplete="username" required autocapitalize="none"></div>
      <div class="fld"><label>Password${setup ? ' (min. 6 karakter)' : ''}</label><input id="aPw" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required></div>
      ${setup ? '<div class="fld"><label>Ulangi password</label><input id="aPw2" type="password" autocomplete="new-password" required></div>' : ''}
      <div id="aErr" class="small" style="color:var(--danger);min-height:16px"></div>
    </div></div>
    <div class="modal-foot"><span class="sp"></span><button type="button" class="btn" id="aC">Batal</button><button class="btn primary">${setup ? 'Buat admin & masuk' : 'Masuk'}</button></div></form>`);
  $('#aC', md).onclick = closeModal;
  setTimeout(() => $(setup ? '#aNama' : '#aUser', md)?.focus(), 30);
  $('#authF', md).onsubmit = async (e) => {
    e.preventDefault();
    const err = (m) => ($('#aErr', md).textContent = m);
    const submit = md.querySelector('button.primary');
    if(submit.disabled)return;
    const label=submit.textContent;submit.disabled=true;submit.textContent='Menghubungkan…';err('Menunggu jawaban server…');
    try {
      if (setup) {
        if ($('#aPw', md).value !== $('#aPw2', md).value) return err('Password tidak sama');
        await api.post('/api/setup', { nama: $('#aNama', md).value, username: $('#aUser', md).value, password: $('#aPw', md).value });
      } else await api.post('/api/login', { username: $('#aUser', md).value, password: $('#aPw', md).value });
      closeModal(); await boot(); toast('Login berhasil — sekarang bisa menambah & mengubah data');
    } catch (x) { err(x.name==='TimeoutError'?'Server belum merespons dalam 30 detik. Isian Anda tetap ada; coba lagi setelah koneksi pulih.':x.message); } finally {submit.disabled=false;submit.textContent=label;}
  };
}
async function boot() {
  let r;
  try { r = await api.get('/api/me'); } catch (e) { $('#main').innerHTML = `<div class="card">Server tidak bisa dihubungi: ${esc(e.message)}</div>`; return; }
  try { settings = await api.get('/api/settings'); } catch { settings = {}; }
  applySettings();
  me = r.user || null;
  needSetup = !!r.setup;
  server = { online: !!r.online, vercel: !!r.vercel };
  renderUserChip();
  if (isDailyOnly() && location.hash !== '#/daily') location.hash = '#/daily';
  else route();
}
function changePassword() {
  const md = openModal(`<div class="modal-head"><h2>Ganti password</h2><button class="x">×</button></div>
    <div class="modal-body"><div class="grid" style="gap:10px">
      <div class="fld"><label>Password lama</label><input id="pL" type="password" autocomplete="current-password"></div>
      <div class="fld"><label>Password baru (min. 6 karakter)</label><input id="pB" type="password" autocomplete="new-password"></div>
      <div class="fld"><label>Ulangi password baru</label><input id="pB2" type="password" autocomplete="new-password"></div></div></div>
    <div class="modal-foot"><span class="sp"></span><button class="btn" id="pC">Batal</button><button class="btn primary" id="pS">Simpan</button></div>`);
  $('#pC', md).onclick = closeModal;
  $('#pS', md).onclick = async () => {
    if ($('#pB', md).value !== $('#pB2', md).value) return toast('Password baru tidak sama', true);
    try { await api.post('/api/password', { lama: $('#pL', md).value, baru: $('#pB', md).value }); closeModal(); toast('Password diganti'); } catch (e) { toast(e.message, true); }
  };
}

async function renderUsers(main) {
  const users = await api.get('/api/users');
  main.innerHTML = `<div class="page-head"><div><h1>👥 Pengguna & Akses</h1>
      <p class="desc">Semua pengguna bisa <b>melihat</b> seluruh data & Laporan Owner. Peran menentukan data apa yang boleh <b>diubah</b>. Satu orang boleh punya beberapa peran.</p></div>
      <div class="actions"><button class="btn primary" id="uAdd">＋ Tambah pengguna</button></div></div>
    <div class="cols-3">
      <div class="table-wrap"><table class="data"><thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Status</th><th>Login terakhir</th></tr></thead><tbody>
        ${users.map((u) => `<tr data-id="${u.id}"><td><b>${esc(u.nama)}</b></td><td>${esc(u.username)}</td><td>${(u.peran || []).map((r) => `<span class="tag">${esc(ROLES[r]?.label || r)}</span>`).join(' ')}</td><td>${u.aktif ? 'Aktif' : '<span style="color:var(--danger)">Nonaktif</span>'}</td><td>${u.last_login ? new Date(u.last_login).toLocaleString('id-ID') : '–'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="card"><h3>Peran & yang boleh diubah</h3><table class="mini">${Object.entries(ROLES).map(([, r]) => `<tr><td><b>${esc(r.label)}</b></td><td class="small">${esc(r.desc)}</td></tr>`).join('')}</table></div>
    </div>`;
  const form = (u) => {
    const md = openModal(`<div class="modal-head"><h2>${u ? 'Ubah' : 'Tambah'} pengguna</h2><button class="x">×</button></div>
      <div class="modal-body"><div class="form-grid">
        <div class="fld"><label>Nama</label><input id="uN" value="${esc(u?.nama || '')}"></div>
        <div class="fld"><label>Username</label><input id="uU" value="${esc(u?.username || '')}" ${u ? 'disabled' : ''} autocapitalize="none"></div>
        <div class="fld full"><label>${u ? 'Password baru (kosongkan bila tidak diganti)' : 'Password (min. 6 karakter)'}</label><input id="uP" type="password" autocomplete="new-password"></div>
        <div class="fld full"><label>Peran</label>${Object.entries(ROLES).map(([k, r]) => `<label style="display:flex;gap:8px;align-items:flex-start;color:var(--ink);font-size:13px;margin:4px 0"><input type="checkbox" value="${k}" class="uR" ${(u?.peran || []).includes(k) ? 'checked' : ''} style="width:auto;margin-top:2px"> <span><b>${esc(r.label)}</b> <span class="muted">— ${esc(r.desc)}</span></span></label>`).join('')}</div>
        ${u ? `<div class="fld"><label><input type="checkbox" id="uA" ${u.aktif ? 'checked' : ''} style="width:auto"> Akun aktif</label></div>` : ''}
      </div></div>
      <div class="modal-foot"><span class="sp"></span><button class="btn" id="uC">Batal</button><button class="btn primary" id="uS">Simpan</button></div>`);
    $('#uC', md).onclick = closeModal;
    $('#uS', md).onclick = async () => {
      const peran = $$('.uR', md).filter((c) => c.checked).map((c) => c.value);
      if (!peran.length) return toast('Pilih minimal 1 peran', true);
      try {
        if (u) await api.put(`/api/users/${u.id}`, { nama: $('#uN', md).value, peran, aktif: $('#uA', md).checked ? 1 : 0, password: $('#uP', md).value || undefined });
        else await api.post('/api/users', { nama: $('#uN', md).value, username: $('#uU', md).value, password: $('#uP', md).value, peran });
        closeModal(); toast('Pengguna tersimpan'); renderUsers(main);
      } catch (e) { toast(e.message, true); }
    };
  };
  $('#uAdd').onclick = () => form(null);
  $$('tr[data-id]', main).forEach((tr) => (tr.onclick = () => form(users.find((u) => u.id === Number(tr.dataset.id)))));
}

boot();

