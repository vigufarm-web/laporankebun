// Ringkasan PT VIGU FARM INDONESIA (halaman depan, terbuka untuk semua) + bagian-bagian yang
// dipakai ulang di halaman komoditas (progres tanam mingguan + peta, tanggal tanam, panen & penjualan).
import { util, displayOf, padiFase, lahanProgress, aktivitasUntuk, nominalJual, isJual, iklimHarian, HARI_HUJAN_MM, pisangTertanam } from './schema.js';

const $ = (s, el = document) => el.querySelector(s);
const n = util.n;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const PANEN_PERTAMA_BLN = 8.4; // median tanam → panen pertama pisang dari log panen kebun

function monday(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function isoWeek(d) { const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); const w1 = new Date(t.getFullYear(), 0, 4); return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7); }
const addD = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
const inR = (s, a, b) => s && s >= a && s <= b;
const sum = (arr, fn) => arr.reduce((t, x) => t + n(fn(x)), 0);
const keyB = util.key;
function ringArea(c) {
  const R = 6378137, rad = Math.PI / 180; let s = 0;
  for (let i = 0; i < c.length; i++) { const [x1, y1] = c[i], [x2, y2] = c[(i + 1) % c.length]; s += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad)); }
  return Math.abs((s * R * R) / 2);
}
function geoHa(g) {
  const poly = (p) => ringArea(p[0]) - p.slice(1).reduce((t, h) => t + ringArea(h), 0);
  return !g ? 0 : g.type === 'Polygon' ? poly(g.coordinates) / 1e4 : g.type === 'MultiPolygon' ? g.coordinates.reduce((t, p) => t + poly(p), 0) / 1e4 : 0;
}
// luas sama dengan halaman GIS: Area_New > Shape_Area > hitung dari geometri
const luasF = (f) => { const p = f.properties || {}; return Number(p.Area_New) > 0 ? p.Area_New / 1e4 : Number(p.Shape_Area) > 0 ? p.Shape_Area / 1e4 : geoHa(f.geometry); };
const barH = (p) => `<div class="bar"><i style="width:${Math.min(100, p * 100)}%;background:${p >= 0.98 ? 'var(--ok)' : p >= 0.5 ? '#65a30d' : 'var(--warn)'}"></i></div>`;
const tile = (lbl, v, note) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${v}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;

// ---------- minggu yang dilihat (dipakai bersama semua halaman)
let wkStart = null;
export function week() {
  wkStart ??= monday(util.today());
  const a = util.iso(wkStart), b = util.iso(addD(wkStart, 6));
  return { a, b, pa: util.iso(addD(wkStart, -7)), pb: util.iso(addD(wkStart, -1)), no: isoWeek(wkStart), mStart: b.slice(0, 7) + '-01' };
}
export function weekLabel() {
  const { a, b, no } = week(); const d1 = util.d(a), d2 = util.d(b);
  return `Minggu ke-${no} · ${d1.getDate()}${d1.getMonth() !== d2.getMonth() ? ' ' + BULAN[d1.getMonth()] : ''}–${d2.getDate()} ${BULAN[d2.getMonth()]} ${d2.getFullYear()}`;
}
// tombol pilih minggu; onChange dipanggil setelah minggu berganti
export function weekPicker(onChange) {
  const { a } = week();
  const el = document.createElement('div');
  el.className = 'actions no-print';
  el.innerHTML = `<button class="btn" data-w="-7">‹ Minggu lalu</button><input type="date" class="btn" value="${a}" style="padding:5px 8px"><button class="btn" data-w="7">Minggu depan ›</button><button class="btn" data-w="0">Minggu ini</button>`;
  el.onclick = (e) => { const b = e.target.closest('[data-w]'); if (!b) return; wkStart = b.dataset.w === '0' ? monday(util.today()) : addD(wkStart, Number(b.dataset.w)); onChange(); };
  el.querySelector('input').onchange = (e) => { if (e.target.value) { wkStart = monday(util.d(e.target.value)); onChange(); } };
  return el;
}

// ---------- layer peta (dimuat sekali per halaman)
export async function loadGis(A) {
  let layers = [];
  try { layers = await A.gisLayers(); } catch {}
  const gj = (re) => { const L0 = layers.find((x) => re.test(`${x.jenis} ${x.nama}`)); if (!L0) return null; try { return { rec: L0, fc: JSON.parse(L0.geojson) }; } catch { return null; } };
  return { blok: gj(/blok tanam/i), persil: gj(/persil/i) };
}

// ======================================================== LAHAN & SERAH TERIMA
export function serahTerima(gis) {
  if (!gis.persil) return null;
  // Lahan sudah dibeli: sudah serah terima = Status Sudah Bayar / Lahan Terpisah; belum serah terima = Status Belum ST.
  // Persil lain di peta = belum dibeli → tidak dihitung/dibandingkan. Persil lama yang sudah dipecah (Lahan Berubah) tidak dihitung.
  const F = gis.persil.fc.features;
  const sudah = F.filter((f) => ['Sudah Bayar', 'Lahan Terpisah'].includes(f.properties?.Status));
  const belum = F.filter((f) => f.properties?.Status === 'Belum ST');
  return { sudah, belum, haS: sum(sudah, luasF), haB: sum(belum, luasF), nama: gis.persil.rec.nama };
}
export function petaKomoditas(gis) {
  const out = {};
  if (gis.blok) for (const f of gis.blok.fc.features) { const k = f.properties?.Lahan || 'Lainnya'; out[k] = (out[k] || 0) + luasF(f); }
  return out;
}

// ======================================================== PROGRES TANAM MINGGUAN + PETA
// kom = 'Pisang' | 'Padi'
export function renderProgres(el, A, gis, kom) {
  const { esc, fmtNum, fmtDate, ctx } = A;
  const P = ctx.rows;
  const { a, b, pa, pb } = week();
  const isKom = (r) => (r.peruntukan || 'Pisang') === kom;
  const lbAll = P('lahan_blok');
  const lb = lbAll.filter(isKom).map((r) => ({ r, p: lahanProgress(r, ctx) }));
  const lbKom = Object.fromEntries(lbAll.map((r) => [keyB(r.blok), r.peruntukan || 'Pisang']));
  const acts = aktivitasUntuk(ctx, kom).map((x) => x.aktivitas);
  // baris harian ikut komoditas blok-nya; blok yang belum terdaftar ikut komoditas aktivitasnya
  const har = P('lahan_harian').filter((r) => (lbKom[keyB(r.blok)] ? lbKom[keyB(r.blok)] === kom : acts.includes(r.aktivitas)));
  const wk = har.filter((r) => inR(r.tanggal, a, b)), prev = har.filter((r) => inR(r.tanggal, pa, pb));
  const luas = sum(lb, (x) => x.r.luas_ha);
  const rows = acts.map((ak) => {
    const w = wk.filter((r) => r.aktivitas === ak), pv = prev.filter((r) => r.aktivitas === ak);
    return { ak, w: sum(w, (r) => r.hasil_ha), pv: sum(pv, (r) => r.hasil_ha), done: sum(lb, (x) => (x.p.per.find((p) => p.akt === ak)?.pct || 0) * n(x.r.luas_ha)), bl: [...new Set(w.map((r) => r.blok))] };
  });
  const days = new Set(wk.map((r) => r.tanggal)).size;
  el.innerHTML = `
    <div class="card o-card">
      <p class="sub">${esc(kom)} — hasil kerja (ha) per tahap · ${days} hari kerja tercatat minggu ini. "Total selesai" dihitung per blok (maks. 100% luas blok), dari rencana ${lb.length} blok ${fmtNum(luas, 2)} ha.</p>
      ${acts.length ? `<table class="mini">
        <tr><th>Tahap</th><th class="num">Minggu ini</th><th class="num">Minggu lalu</th><th class="num">Total selesai</th><th style="width:16%">dari ${fmtNum(luas, 2)} ha</th><th>Blok dikerjakan minggu ini</th></tr>
        ${rows.map((x) => `<tr${x.w ? ' style="background:#fff7e6"' : ''}><td><b>${esc(x.ak)}</b></td><td class="num">${x.w ? '<b>' + fmtNum(x.w, 2) + '</b>' : '–'}</td><td class="num muted">${x.pv ? fmtNum(x.pv, 2) : '–'}</td><td class="num">${fmtNum(x.done, 2)}</td><td>${barH(luas ? x.done / luas : 0)}</td><td>${x.bl.map((bk) => `<span class="tag">${esc(bk)}</span>`).join(' ')}</td></tr>`).join('')}
      </table>` : '<div class="small muted">Belum ada urutan aktivitas untuk komoditas ini.</div>'}
      ${!lb.length ? `<p class="small muted" style="margin:8px 0 0">Belum ada rencana blok ${esc(kom.toLowerCase())} di tabel Rencana Blok Lahan.</p>` : ''}
    </div>
    <div class="card o-card" style="margin-top:14px"><h3>Lokasi pekerjaan minggu ini · ${esc(kom)}</h3>
      <p class="sub">Oranye = dikerjakan minggu ini (klik untuk rincian). Hijau = sudah tanam. Kuning = rencana / persiapan. Abu-abu = blok komoditas lain.</p>
      <div class="o-map" style="height:420px;border-radius:8px;overflow:hidden"></div><div class="small muted o-map-note" style="margin-top:6px"></div>
    </div>`;
  const mapEl = $('.o-map', el), note = $('.o-map-note', el);
  if (!gis.blok) { mapEl.outerHTML = '<div class="small muted">Layer peta "Blok Tanam" belum ada.</div>'; return; }
  A.loadLib('leaflet').then(() => { if (mapEl.isConnected) drawMap(); });
  function drawMap() {
  const map = L.map(mapEl, { maxZoom: 21, scrollWheelZoom: false });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 21, attribution: 'Esri' }).addTo(map);
  const wkBy = {}; for (const r of wk) (wkBy[keyB(r.blok)] ??= []).push(r);
  const pisBy = Object.fromEntries(P('pisang_blok').map((r) => [keyB(r.nama_blok), r]));
  const pisT = pisangTertanam(ctx); // sudah tanam = Blok Tanam atau progres "Tanam" harian
  const lbBy = Object.fromEntries(lbAll.map((r) => [keyB(r.blok), r]));
  const tanamPadi = new Set([...P('padi_tanam').filter((r) => r.tgl_tanam && padiFase(r, ctx) !== 'Sudah Panen').map((r) => keyB(r.petak)), ...P('padi_petak').filter((r) => r.status === 'Sudah Tanam').map((r) => keyB(r.nama_petak))]);
  const seen = new Set(), mine = [];
  const lyr = L.geoJSON(gis.blok.fc, {
    style: (f) => {
      const k = keyB(f.properties?.Nama_Blok), own = (f.properties?.Lahan || '') === kom;
      const planted = kom === 'Pisang' ? pisT.has(k) : tanamPadi.has(k);
      const c = wkBy[k] ? '#f97316' : !own ? '#e5e7eb' : planted ? '#16a34a' : lbBy[k] || pisBy[k] ? '#fde047' : '#d9f99d';
      return { color: wkBy[k] ? '#9a3412' : '#1f2937', weight: wkBy[k] ? 2.5 : 1, fillColor: c, fillOpacity: own || wkBy[k] ? 0.75 : 0.35 };
    },
    onEachFeature: (f, l) => {
      const nm = f.properties?.Nama_Blok, k = keyB(nm); seen.add(k);
      if ((f.properties?.Lahan || '') === kom) mine.push(l);
      const pr0 = pisT.get(k), w = wkBy[k] || [];
      l.bindTooltip(esc(nm || ''), { permanent: true, direction: 'center', className: 'blk-label' });
      l.bindPopup(`<b style="font-size:14px">${esc(nm)}</b> <span class="small muted">${esc(f.properties?.Lahan || '')} · ${fmtNum(luasF(f), 2)} ha</span>
        ${kom === 'Pisang' && pr0 ? `<div>Tanam <b>${fmtDate(pr0.tgl)}</b> · umur ${fmtNum(util.daysSince(pr0.tgl) / 30.44, 1)} bln · ${esc(pr0.st || '')} · ${fmtNum(pr0.luas, 2)} ha${pr0.sumber === 'progres' ? ' <span class="small muted">(dari progres harian)</span>' : ''}</div>` : ''}
        ${w.length ? `<div style="margin-top:4px"><b>Pekerjaan minggu ini:</b><table>${w.sort((x, y) => x.tanggal.localeCompare(y.tanggal)).map((r) => `<tr><td>${fmtDate(r.tanggal)}</td><td>${esc(r.aktivitas)}</td><td>${fmtNum(r.hasil_ha, 2)} ha</td></tr>`).join('')}</table></div>` : '<div class="small muted">Tidak ada pekerjaan tercatat minggu ini.</div>'}`);
    },
  }).addTo(map);
  const hit = []; lyr.eachLayer((l) => wkBy[keyB(l.feature.properties?.Nama_Blok)] && hit.push(l));
  map.fitBounds(L.featureGroup(hit.length ? hit : mine.length ? mine : [lyr]).getBounds(), { padding: [30, 30], maxZoom: 18 });
  const miss = Object.keys(wkBy).filter((k) => !seen.has(k));
  note.innerHTML = miss.length ? `Blok dikerjakan minggu ini yang namanya tidak ada di peta: ${miss.map((k) => `<b>${esc(wkBy[k][0].blok)}</b>`).join(', ')} (cek penulisan nama blok).` : '';
  setTimeout(() => map.invalidateSize(), 50);
  }
}

// ======================================================== TANGGAL TANAM PER BLOK
export function tanamRows(A, kom) {
  const { ctx, fmtDate } = A; const P = ctx.rows;
  const out = [];
  if (!kom || kom === 'Pisang') {
    const firstPanen = {};
    for (const r of P('pisang_panen_pkk')) { const k = keyB(r.blok); if (!firstPanen[k] || r.tanggal < firstPanen[k]) firstPanen[k] = r.tanggal; }
    // Blok Tanam + blok yang sudah tercatat "Tanam" di Progres Harian (lihat pisangTertanam di schema.js)
    for (const [k, t] of pisangTertanam(ctx)) {
      const fp = firstPanen[k];
      out.push({ kom: '🍌 Pisang', blok: t.blok, luas: t.luas, tgl: t.tgl, umur: util.daysSince(t.tgl) / 30.44, st: t.st, pop: t.pop, netto: t.netto, sumber: t.sumber,
        panen: fp ? `Sudah panen sejak ${fmtDate(fp)}` : `± ${fmtDate(util.addDays(t.tgl, Math.round(PANEN_PERTAMA_BLN * 30.44)))}` });
    }
  }
  if (!kom || kom === 'Padi') {
    for (const r of P('padi_tanam').filter((r) => r.tgl_tanam)) {
      const fase = padiFase(r, ctx);
      out.push({ kom: '🌾 Padi', blok: displayOf('padi_tanam', r), luas: r.luas_tanam_ha, tgl: r.tgl_tanam, umur: util.daysSince(r.tgl_tanam) / 30.44, st: fase, pop: null,
        panen: fase === 'Sudah Panen' ? 'Sudah panen' : `± ${fmtDate(util.addDays(r.tgl_tanam, n(r.umur_panen_hst) || 100))}` });
    }
  }
  return out.sort((x, y) => String(y.tgl).localeCompare(String(x.tgl)));
}
export function renderTanggalTanam(el, A, kom) {
  const { esc, fmtNum, fmtDate } = A;
  const { a, b } = week();
  const rows = tanamRows(A, kom);
  const baru = rows.filter((x) => inR(x.tgl, a, b));
  el.innerHTML = `<div class="card o-card">
    <p class="sub">${rows.length} blok tertanam, total ${fmtNum(sum(rows, (x) => x.luas), 2)} ha${baru.length ? ` · <b>tanam baru minggu ini: ${baru.map((x) => esc(x.blok)).join(', ')}</b>` : ''}.${!kom || kom === 'Pisang' ? ` Perkiraan panen pertama pisang = tanggal tanam + ${String(PANEN_PERTAMA_BLN).replace('.', ',')} bulan (rata-rata kebun).` : ''}</p>
    ${rows.length ? `<table class="mini">
      <tr><th>Blok</th>${kom ? '' : '<th>Komoditas</th>'}<th class="num">Luas (ha)</th>${kom === 'Pisang' ? '<th class="num">Populasi</th>' : ''}<th>Tanggal tanam</th><th class="num">Umur (bln)</th><th>Status / fase</th><th>Panen</th></tr>
      ${rows.map((x) => `<tr${inR(x.tgl, a, b) ? ' style="background:#fff7e6"' : ''}><td><b>${esc(x.blok)}</b></td>${kom ? '' : `<td>${x.kom}</td>`}<td class="num">${fmtNum(x.luas, 2)}</td>${kom === 'Pisang' ? `<td class="num">${fmtNum(x.pop)}</td>` : ''}<td class="nowrap">${fmtDate(x.tgl)}</td><td class="num">${fmtNum(x.umur, 1)}</td><td>${esc(x.st || '')}</td><td class="small">${x.panen}</td></tr>`).join('')}
    </table>` : '<div class="empty">Belum ada data tanam.</div>'}</div>`;
}

// ======================================================== PANEN & PENJUALAN MINGGUAN
export function panenJualLines(A, kom) {
  const P = A.ctx.rows;
  const L = [];
  if (!kom || kom === 'Pisang') L.push(
    ['🍌 Pokok dipanen (PKK)', P('pisang_panen_pkk'), (r) => r.pkk_panen, 0, 'pkk'],
    ['🍌 Box pisang (PH)', P('pisang_box'), (r) => r.jumlah_box, 0, 'box']);
  if (!kom || kom === 'Padi') L.push(
    ['🌾 Beras masuk gudang', P('padi_giling'), (r) => r.beras_kg, 0, 'kg']);
  return L;
}
export function renderPanenJual(el, A, kom, only) {
  const { esc, fmtNum, fmtDate } = A;
  const { a, b, pa, pb, mStart } = week();
  let lines = panenJualLines(A, kom);
  if (only) lines = lines.filter((l) => only.test(l[0]));
  const fv = (v, d, u) => (u === 'Rp' ? 'Rp ' + fmtNum(v) : fmtNum(v, d) + ' ' + u);
  const bl = util.d(b), yr = bl.getFullYear();
  const yStart = `${yr}-01-01`, lyStart = `${yr - 1}-01-01`, lyEnd = `${yr - 1}-12-31`;
  el.innerHTML = `<div class="card o-card" style="overflow:auto"><table class="mini">
    <tr><th></th><th class="num">Minggu ini</th><th class="num">Minggu lalu</th><th class="num">Naik / turun</th><th class="num">Bulan ini<div class="small muted" style="font-weight:400">${BULAN[bl.getMonth()]} ${yr} s/d ${bl.getDate()}</div></th><th class="num">Tahun ini<div class="small muted" style="font-weight:400">${yr} s/d ${bl.getDate()} ${BULAN[bl.getMonth()]}</div></th><th class="num">Tahun lalu<div class="small muted" style="font-weight:400">${yr - 1}</div></th><th class="num">Total<div class="small muted" style="font-weight:400">semua data</div></th></tr>
    ${lines.map(([l, rows, fn, d, u, src]) => {
      const w = sum(rows.filter((r) => inR(r.tanggal, a, b)), fn), p = sum(rows.filter((r) => inR(r.tanggal, pa, pb)), fn), m = sum(rows.filter((r) => inR(r.tanggal, mStart, b)), fn);
      const ty = sum(rows.filter((r) => inR(r.tanggal, yStart, b)), fn), ly = sum(rows.filter((r) => inR(r.tanggal, lyStart, lyEnd)), fn), tot = sum(rows, fn);
      const noDate = rows.filter((r) => !r.tanggal).length;
      const li = (src || rows).reduce((x, r) => (r.tanggal > x ? r.tanggal : x), '');
      const belum = !w && (!li || li < a);
      const ch = p && !belum ? (w - p) / p : null;
      return `<tr><td${l.startsWith(' ') ? ' class="muted" style="padding-left:20px"' : ''}><b>${esc(l.trim())}</b></td>
        <td class="num"><b>${w ? fv(w, d, u) : belum ? `<span class="small muted" style="font-weight:400">belum diinput${li ? ' (terakhir ' + fmtDate(li) + ')' : ''}</span>` : '–'}</b></td>
        <td class="num muted">${p ? fv(p, d, u) : '–'}</td>
        <td class="num" style="color:${ch == null ? '' : ch >= 0 ? 'var(--ok)' : 'var(--danger)'}">${ch == null ? '' : (ch >= 0 ? '▲ ' : '▼ ') + fmtNum(Math.abs(ch) * 100, 0) + '%'}</td>
        <td class="num">${m ? fv(m, d, u) : '–'}</td>
        <td class="num">${ty ? fv(ty, d, u) : '–'}</td>
        <td class="num">${ly ? fv(ly, d, u) : '–'}</td>
        <td class="num"><b>${tot ? fv(tot, d, u) : '–'}</b>${noDate ? `<div class="small" style="color:var(--warn)">${noDate} tanpa tanggal</div>` : ''}</td></tr>`;
    }).join('')}
  </table><p class="small muted" style="margin:6px 0 0">Total = semua data yang tercatat (termasuk yang belum ada tanggalnya). Tahun ini dihitung sampai akhir minggu yang dipilih.</p></div>`;
}

// ======================================================== HALAMAN DEPAN
export async function renderOwner(main, A) {
  const { esc, fmtNum, fmtDate, ctx } = A;
  const P = ctx.rows;
  main.innerHTML = `
    <div class="page-head">
      <div><div class="crumb">Ringkasan kebun</div><h1>${esc(A.settings().nama || 'PT VIGU FARM INDONESIA')}</h1>
      <p class="desc"><b>${weekLabel()}</b>. Semua angka dihitung otomatis dari data yang diinput tim di lapangan.</p></div>
      <div id="wp"></div>
    </div>
    <div id="o1"></div>
    <h2 class="o-h">2. Progres kebun</h2><div id="o2a"></div><div id="o2b"></div>
    <h2 class="o-h">3. Panen</h2><div id="o4"></div>
    <div id="o5"></div>`;
  const wp = weekPicker(() => renderOwner(main, A));
  wp.insertAdjacentHTML('beforeend', '<button class="btn primary" onclick="window.print()">🖨 Cetak / PDF</button>');
  $('#wp').replaceWith(wp);
  const gis = await loadGis(A);

  // 1. informasi kebun
  const st = serahTerima(gis), peta = petaKomoditas(gis);
  const pisT = tanamRows(A, 'Pisang'), padiT = tanamRows(A, 'Padi').filter((x) => x.st !== 'Sudah Panen');
  const bibit = sum(P('pisang_bibit'), (r) => n(r.qty_datang) - n(r.afkir) + n(r.splitting) - n(r.mortal) - n(r.ditanam));
  $('#o1').innerHTML = `
    <h2 class="o-h">1. Informasi kebun</h2>
    <div class="kpis">
      ${st ? tile('Lahan sudah serah terima', `${fmtNum(st.haS, 2)} <small>ha</small>`, `${st.sudah.length} persil`) : ''}
      ${Object.keys(peta).length ? tile('Luas blok kebun (peta)', `${fmtNum(sum(Object.values(peta), (v) => v), 2)} <small>ha</small>`, Object.entries(peta).map(([k, v]) => `${esc(k)} ${fmtNum(v, 2)}`).join(' · ')) : ''}
      ${(() => { const baru = pisT.filter((x) => x.sumber === 'progres'), net = pisT.filter((x) => x.netto != null); return tile('🍌 Pisang tertanam', `${fmtNum(sum(pisT, (x) => x.luas), 2)} <small>ha</small>`, `${pisT.length} blok · luas bruto (= tabel progres) · netto ${fmtNum(sum(net, (x) => x.netto), 2)} ha untuk ${net.length} blok · ${fmtNum(sum(pisT, (x) => x.pop))} pokok${baru.length ? ` · ${baru.length} blok baru dari progres harian (${baru.map((x) => esc(x.blok)).join(', ')}): netto & pokok belum diinput` : ''}`); })()}
      ${tile('🍌 Stok bibit pisang', fmtNum(bibit), 'pokok siap / di nursery')}
      ${P('padi_panen').length ? tile('🌾 Panen padi (total)', `${fmtNum(sum(P('padi_panen'), (r) => r.gkp_kg), 1)} <small>kg gabah</small>`, `${new Set(P('padi_panen').map((r) => keyB(r.petak))).size} blok · ${fmtNum(sum(P('padi_panen'), (r) => r.jumlah_karung))} karung`) : ''}
      ${(() => { const pt = P('padi_petak'), tn = pt.filter((r) => r.status === 'Sudah Tanam'); return tile('🌾 Padi tertanam', `${fmtNum(sum(tn, (r) => r.luas_ha), 2)} <small>ha</small>`, `${tn.length} dari ${pt.length} blok (${fmtNum(sum(pt, (r) => r.luas_ha), 2)} ha)`); })()}
      ${(() => { const h = iklimHarian(P('iklim')); if (!h.length) return ''; const m = h[h.length - 1].tanggal.slice(0, 7), hm = h.filter((d) => d.tanggal.startsWith(m)); const t = hm.filter((d) => d.tavg != null);
        return tile(`🌦️ Iklim ${BULAN[+m.slice(5) - 1]} ${m.slice(0, 4)}`, `${fmtNum(sum(hm, (d) => d.hujan), 1)} <small>mm hujan</small>`, `${hm.filter((d) => n(d.hujan) >= HARI_HUJAN_MM).length} hari hujan · suhu rata-rata ${t.length ? fmtNum(sum(t, (d) => d.tavg) / t.length, 1) : '–'} °C`); })()}
    </div>`;
  renderProgres($('#o2a'), A, gis, 'Pisang');
  if (P('lahan_blok').some((r) => r.peruntukan === 'Padi')) renderProgres($('#o2b'), A, gis, 'Padi');
  renderPanenJual($('#o4'), A, null);

  // data terakhir masuk
  const lastIn = (t) => P(t).reduce((m, r) => (r.tanggal > m ? r.tanggal : m), '');
  const src = [['Progres tanam', 'lahan_harian'], ['Panen PKK', 'pisang_panen_pkk'], ['Box PH', 'pisang_box'], ['Beras masuk', 'padi_giling']];
  $('#o5').innerHTML = `<div class="card o-card" style="margin-top:14px"><h3>Data terakhir yang masuk</h3><div style="display:flex;flex-wrap:wrap;gap:8px">
    ${src.map(([l, t]) => { const d = lastIn(t); const late = d && util.daysSince(d) > 7; return `<span class="tag" style="${late ? 'background:#fee2e2;color:#991b1b' : ''}">${l}: ${d ? fmtDate(d) : 'belum ada'}${late ? ' ⚠' : ''}</span>`; }).join('')}
    </div><p class="small muted" style="margin:6px 0 0">⚠ = tidak ada input lebih dari 7 hari — angka minggu ini mungkin belum lengkap.</p></div>`;
}
