// Halaman per komoditas (Pisang / Padi) + Infrastruktur.
// Setiap tab: ringkasan di atas, tabel data di bawah. Semua orang bisa melihat; tombol tambah/ubah hanya muncul
// untuk pengguna yang login dan punya izin pada tabel tersebut.
import { TABLES, POKOK_PER_HA, util, displayOf, padiFase, lahanProgress, aktivitasUntuk, stokBenih, nominalJual, isJual, iklimHarian, HARI_HUJAN_MM } from './schema.js';
import { loadGis, week, weekLabel, weekPicker, renderProgres, renderTanggalTanam, renderPanenJual, tanamRows } from './owner.js';

const $ = (s, el = document) => el.querySelector(s);
const n = util.n;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const sum = (arr, fn) => arr.reduce((t, x) => t + n(fn(x)), 0);
const keyB = util.key;
const tile = (lbl, v, note) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${v}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
const POKOK_HA = POKOK_PER_HA, SULAM = 0.1, MIN_UMUR_TANAM = 3; // 2.000 pkk/ha — sama dengan hitungan netto tertanam

// filter & isian awal untuk tabel bersama (progres tanam dipakai pisang & padi)
const lahanFilters = (A, kom) => {
  const P = A.ctx.rows;
  const kb = () => Object.fromEntries(P('lahan_blok').map((r) => [keyB(r.blok), r.peruntukan || 'Pisang']));
  const acts = () => aktivitasUntuk(A.ctx, kom).map((x) => x.aktivitas);
  return {
    lahan_blok: { filter: (r) => (r.peruntukan || 'Pisang') === kom, prefill: { peruntukan: kom } },
    lahan_harian: { filter: (r) => { const k = kb()[keyB(r.blok)]; return k ? k === kom : acts().includes(r.aktivitas); } },
    lahan_aktivitas: { filter: (r) => (r.untuk || 'Pisang') === kom || r.untuk === 'Semua', prefill: { untuk: kom } },
  };
};

export const KOM = {
  pisang: { nama: 'Pisang', icon: '🍌', key: 'Pisang', tabs: [
    { k: 'bibit', l: 'Stok Bibit', tables: ['pisang_bibit'] },
    // Tertanam: hanya untuk admin (permintaan user) — pokok tanam per blok, tanggal tanam, tabel Blok Tanam
    { k: 'tertanam', l: 'Tertanam', tables: ['pisang_blok', 'pisang_kegiatan'], excel: ['pisang_blok'], admin: true },
    // Blok Tanam (pokok, tanggal tanam, status) disembunyikan dari tampilan tapi ikut di Excel halaman ini
    { k: 'progres', l: 'Progres Tanam', tables: ['lahan_harian', 'lahan_blok', 'lahan_target', 'lahan_aktivitas'], excel: ['lahan_harian', 'lahan_blok', 'lahan_target', 'lahan_aktivitas', 'pisang_blok'], week: true }, // Target Tanam dipakai halaman Tim Kebun (/kebun)
    { k: 'panen', l: 'Panen', tables: ['pisang_box', 'pisang_estimasi', 'pisang_panen_pkk', 'pisang_handclass'], week: true },
  ] },
  padi: { nama: 'Padi', icon: '🌾', key: 'Padi', tabs: [
    { k: 'bibit', l: 'Stok Benih', tables: ['padi_benih'] },
    { k: 'tertanam', l: 'Tertanam', tables: ['padi_petak', 'padi_tanam', 'padi_kegiatan', 'padi_opt'] },
    { k: 'progres', l: 'Progres Tanam', tables: ['lahan_harian', 'lahan_blok', 'lahan_aktivitas'], week: true },
    { k: 'panen', l: 'Panen', tables: ['padi_panen', 'padi_giling'] },
  ] },
  iklim: { nama: 'Iklim', icon: '🌦️', key: 'Iklim', tabs: [
    { k: 'data', l: 'Cuaca Harian', tables: ['iklim'] },
  ] },
};
let iklimBulan = null; // bulan yang dilihat di halaman iklim (YYYY-MM)

export async function renderKomoditas(main, A, komKey, tabKey, sub) {
  const K = KOM[komKey];
  const tabs = K.tabs.filter((t) => !t.admin || A.isAdmin()); // tab khusus admin disembunyikan dari pengunjung
  const tab = tabs.find((t) => t.k === tabKey) || tabs[0];
  const table = tab.tables.includes(sub) ? sub : tab.tables[0];
  const { esc } = A;
  const rerender = () => renderKomoditas(main, A, komKey, tab.k, table);
  main.innerHTML = `
    <div class="page-head">
      <div><div class="crumb">${esc(A.settings().nama || 'PT VIGU FARM INDONESIA')}</div><h1>${K.icon} ${esc(K.nama)} · ${esc(tab.l)}</h1>
      ${tab.week ? `<p class="desc"><b>${weekLabel()}</b></p>` : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;justify-content:flex-end"><div class="actions" id="kXl"></div><div id="kWeek"></div></div>
    </div>
    ${tabs.length > 1 ? `<div class="tabs">${tabs.map((t) => `<a href="#/k/${komKey}/${t.k}" class="${t === tab ? 'on' : ''}">${esc(t.l)}${t.admin ? ' 🔒' : ''}</a>`).join('')}</div>` : ''}
    <div id="kSum"></div>
    <h2 class="o-h">📋 Data ${esc(tab.l.toLowerCase())}</h2>
    ${tab.tables.length > 1 ? `<div class="tabs sub">${tab.tables.map((t) => `<a href="#/k/${komKey}/${tab.k}/${t}" class="${t === table ? 'on' : ''}">${esc(TABLES[t].title)} <span class="muted">(${A.ctx.rows(t).filter((r) => (lahanFilters(A, K.key)[t]?.filter || (() => true))(r)).length})</span></a>`).join('')}</div>` : ''}
    <div id="kTbl"></div>`;
  if (tab.week) $('#kWeek').replaceWith(weekPicker(rerender));
  // Excel khusus halaman ini: download → isi → upload; tabel progres (bersama pisang & padi) hanya baris komoditas ini
  A.excelPanel($('#kXl'), { tables: tab.excel || tab.tables, kom: ['Pisang', 'Padi'].includes(K.key) ? K.key : null, label: `${K.nama} · ${tab.l}`, onDone: rerender });
  const sumEl = $('#kSum');
  const S = SUMMARY[`${komKey}_${tab.k}`];
  if (S) await S(sumEl, A, K, rerender);
  if (!$('#kTbl')) return; // halaman sudah diganti sebelum ringkasan selesai dimuat
  const opt = K.key === 'Pisang' || K.key === 'Padi' ? lahanFilters(A, K.key)[table] || {} : {};
  A.renderTable($('#kTbl'), table, { embed: true, ...opt, onChange: rerender });
}

// ================================================================ estimasi vs realisasi panen pisang (box per bulan)
// realisasi = Box Panen (Packing House). MIX = gabungan kelas → tidak dibandingkan per kelas (permintaan user), tetap masuk total box
function estimasiVsRealisasi(el, A) {
  const { fmtNum } = A; const P = A.ctx.rows;
  const est = P('pisang_estimasi').filter((r) => r.bulan);
  const head = '<h3>Estimasi vs realisasi panen (box)</h3>';
  if (!est.length) { el.innerHTML = `<div class="card o-card">${head}<div class="small muted">Belum ada estimasi. Tambahkan di tabel "Estimasi Panen" di bawah, atau lewat tombol ⬇ Excel halaman ini.</div></div>`; return; }
  const months = [...new Set(est.map((r) => String(r.bulan).slice(0, 7)))].sort();
  const box = P('pisang_box');
  const kls = (r, k) => r.kelas === k;
  const now = util.today(), ymNow = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lbl = (ym) => `${BULAN[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
  const tot = { e: [0, 0, 0, 0], r: [0, 0, 0, 0], eJalan: 0 }; // eJalan = estimasi bulan yang sudah/sedang berjalan
  const rows = months.map((m) => {
    const E = est.filter((r) => String(r.bulan).slice(0, 7) === m);
    const e = [sum(E, (r) => r.box), sum(E, (r) => r.box_a), sum(E, (r) => r.box_b), sum(E, (r) => r.box_c)];
    const B = box.filter((r) => String(r.tanggal).slice(0, 7) === m);
    const r = [sum(B, (x) => x.jumlah_box), ...['A', 'B', 'C'].map((k) => sum(B.filter((x) => kls(x, k)), (x) => x.jumlah_box))];
    const akhir = B.map((x) => x.tanggal).sort().pop();
    const mix = sum(B.filter((x) => x.kelas === 'MIX'), (x) => x.jumlah_box);
    const ket = (m > ymNow ? 'belum berjalan' : m === ymNow ? `berjalan${akhir ? ' · s/d ' + A.fmtDate(akhir) : ''}` : 'selesai') + (mix ? ` · termasuk ${fmtNum(mix)} box MIX` : '');
    e.forEach((v, i) => (tot.e[i] += v)); if (m <= ymNow) { r.forEach((v, i) => (tot.r[i] += v)); tot.eJalan += e[0]; }
    const pct = e[0] ? r[0] / e[0] : null;
    const warna = m >= ymNow || pct == null ? 'inherit' : pct >= 1 ? 'var(--ok)' : 'var(--warn)';
    return `<tr><td>${lbl(m)}<div class="small muted">${ket}</div></td>${e.map((v) => `<td class="num">${fmtNum(v)}</td>`).join('')}${m > ymNow ? '<td class="muted" colspan="4" style="text-align:center">belum ada realisasi</td><td class="num muted">–</td>' : `${r.map((v, i) => `<td class="num"${i === 0 ? ' style="font-weight:600"' : ''}>${fmtNum(v)}</td>`).join('')}<td class="num" style="color:${warna};font-weight:600">${pct == null ? '–' : fmtNum(pct * 100, 0) + '%'}</td>`}</tr>`;
  });
  const pctT = tot.eJalan ? tot.r[0] / tot.eJalan : null;
  el.innerHTML = `<div class="card o-card" style="overflow:auto">${head}
    <table class="mini"><tr><th rowspan="2">Bulan</th><th class="num" colspan="4" style="text-align:center">Estimasi</th><th class="num" colspan="4" style="text-align:center">Realisasi (Packing House)</th><th class="num" rowspan="2">Capaian</th></tr>
    <tr><th class="num">Box</th><th class="num">A</th><th class="num">B</th><th class="num">C</th><th class="num">Box</th><th class="num">A</th><th class="num">B</th><th class="num">C</th></tr>
    ${rows.join('')}
    <tr style="font-weight:600"><td>Total</td>${tot.e.map((v) => `<td class="num">${fmtNum(v)}</td>`).join('')}${tot.r.map((v) => `<td class="num">${fmtNum(v)}</td>`).join('')}<td class="num" title="Dibanding estimasi bulan yang sudah/sedang berjalan">${pctT == null ? '–' : fmtNum(pctT * 100, 0) + '%'}</td></tr></table>
    <div class="small muted" style="margin-top:6px">Capaian = realisasi ÷ estimasi box; capaian total hanya dibanding bulan yang sudah/sedang berjalan. Bulan berjalan dihitung sampai data box terakhir. Box MIX (gabungan kelas) tidak dibandingkan per kelas A/B/C, tetapi tetap masuk total box. Estimasi diubah lewat tabel "Estimasi Panen" di bawah atau tombol ⬇ Excel / ⬆ Upload Excel.</div></div>`;
}

// ================================================================ ringkasan per tab
const SUMMARY = {
  // ---------------- IKLIM
  async iklim_data(el, A, K, rerender) {
    const { fmtNum, esc, fmtDate, ctx } = A;
    const hari = iklimHarian(ctx.rows('iklim'));
    if (!hari.length) { el.innerHTML = '<div class="empty">Belum ada data iklim.</div>'; return; }
    const months = [...new Set(hari.map((d) => d.tanggal.slice(0, 7)))].sort();
    if (!iklimBulan || !months.includes(iklimBulan)) iklimBulan = months[months.length - 1];
    const m = iklimBulan, hm = hari.filter((d) => d.tanggal.startsWith(m));
    const lbl = (ym) => `${BULAN[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
    const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const rekap = (ds) => ({ hari: ds.length, hujan: sum(ds, (d) => d.hujan), hh: ds.filter((d) => n(d.hujan) >= HARI_HUJAN_MM).length, tavg: avg(ds.map((d) => d.tavg)), tmin: ds.some((d) => d.tmin != null) ? Math.min(...ds.filter((d) => d.tmin != null).map((d) => d.tmin)) : null, tmax: ds.some((d) => d.tmax != null) ? Math.max(...ds.filter((d) => d.tmax != null).map((d) => d.tmax)) : null, havg: avg(ds.map((d) => d.havg)), wavg: avg(ds.map((d) => d.wavg)), wmax: ds.some((d) => d.wmax != null) ? Math.max(...ds.filter((d) => d.wmax != null).map((d) => d.wmax)) : null, maxHujan: ds.reduce((x, d) => (n(d.hujan) > n(x?.hujan) ? d : x), null) });
    const R = rekap(hm);
    const arahCnt = {}; for (const d of hm) if (d.arah) arahCnt[d.arah] = (arahCnt[d.arah] || 0) + 1;
    const arah = Object.entries(arahCnt).sort((a, b) => b[1] - a[1])[0]?.[0];
    const f1 = (v, d = 1) => (v == null ? '–' : fmtNum(v, d));
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px" class="no-print">
        <button class="btn" id="iPrev" ${months.indexOf(m) <= 0 ? 'disabled' : ''}>‹</button>
        <select id="iSel" class="btn">${months.map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${lbl(x)}</option>`).join('')}</select>
        <button class="btn" id="iNext" ${months.indexOf(m) >= months.length - 1 ? 'disabled' : ''}>›</button>
        <span class="small muted">Stasiun Cuaca VIGU Farm · ${R.hari} hari ada data di bulan ini</span>
      </div>
      <div class="kpis">
        ${tile('Curah hujan', `${f1(R.hujan)} <small>mm</small>`, `${lbl(m)}${R.maxHujan && n(R.maxHujan.hujan) ? ` · tertinggi ${f1(R.maxHujan.hujan)} mm (${fmtDate(R.maxHujan.tanggal)})` : ''}`)}
        ${tile('Hari hujan', `${R.hh} <small>hari</small>`, `curah hujan ≥ ${HARI_HUJAN_MM} mm`)}
        ${tile('Suhu rata-rata', `${f1(R.tavg)} <small>°C</small>`, `terendah ${f1(R.tmin)} · tertinggi ${f1(R.tmax)} °C`)}
        ${tile('Kelembapan rata-rata', `${f1(R.havg, 0)} <small>%</small>`, 'sensor luar')}
        ${tile('Angin', `${f1(R.wavg)} <small>m/s</small>`, `maks ${f1(R.wmax)} m/s · arah dominan ${esc(arah || '–')}`)}
      </div>
      <div class="card o-card"><h3>Hujan & suhu harian · ${lbl(m)}</h3><div class="chart-box" style="height:300px"><canvas id="iC"></canvas></div></div>
      <div class="cols-2" style="margin-top:14px">
        <div class="card o-card" style="overflow:auto"><h3>Rekap harian · ${lbl(m)}</h3><table class="mini">
          <tr><th>Tanggal</th><th class="num">T-min</th><th class="num">T-max</th><th class="num">T-rata</th><th class="num">Lembap %</th><th class="num">Hujan mm</th><th class="num">Angin maks</th><th>Arah</th></tr>
          ${hm.map((d) => `<tr${n(d.hujan) >= HARI_HUJAN_MM ? ' style="background:#eff6ff"' : ''}><td class="nowrap">${fmtDate(d.tanggal)}</td><td class="num">${f1(d.tmin)}</td><td class="num">${f1(d.tmax)}</td><td class="num">${f1(d.tavg)}</td><td class="num">${f1(d.havg, 0)}</td><td class="num"><b>${f1(d.hujan)}</b></td><td class="num">${f1(d.wmax)}</td><td>${esc(d.arah || '')}</td></tr>`).join('')}
        </table></div>
        <div class="card o-card" style="overflow:auto"><h3>Rekap per bulan</h3><table class="mini">
          <tr><th>Bulan</th><th class="num">Hari data</th><th class="num">Hujan (mm)</th><th class="num">Hari hujan</th><th class="num">Suhu rata</th><th class="num">Lembap %</th></tr>
          ${months.map((x) => { const r = rekap(hari.filter((d) => d.tanggal.startsWith(x))); return `<tr${x === m ? ' style="background:#fff7e6"' : ''}><td><a href="#" data-m="${x}">${lbl(x)}</a></td><td class="num">${r.hari}</td><td class="num"><b>${f1(r.hujan)}</b></td><td class="num">${r.hh}</td><td class="num">${f1(r.tavg)}</td><td class="num">${f1(r.havg, 0)}</td></tr>`; }).join('')}
        </table><p class="small muted" style="margin:6px 0 0">Hujan harian = angka kumulatif terbesar dari alat pada hari itu; bulan = jumlah hujan harian. Bulan dengan hari data sedikit belum lengkap.</p></div>
      </div>`;
    const go = (x) => { iklimBulan = x; rerender(); };
    $('#iSel', el).onchange = (e) => go(e.target.value);
    $('#iPrev', el).onclick = () => go(months[months.indexOf(m) - 1]);
    $('#iNext', el).onclick = () => go(months[months.indexOf(m) + 1]);
    el.querySelectorAll('[data-m]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); go(a.dataset.m); }));
    A.chart($('#iC', el), { data: { labels: hm.map((d) => +d.tanggal.slice(8)), datasets: [
      { type: 'bar', label: 'Hujan (mm)', backgroundColor: '#60a5fa', data: hm.map((d) => d.hujan), yAxisID: 'y' },
      { type: 'line', label: 'Suhu maks', borderColor: '#dc2626', backgroundColor: '#dc2626', pointRadius: 2, data: hm.map((d) => d.tmax), yAxisID: 'y1' },
      { type: 'line', label: 'Suhu rata-rata', borderColor: '#f59e0b', backgroundColor: '#f59e0b', pointRadius: 2, data: hm.map((d) => d.tavg), yAxisID: 'y1' },
      { type: 'line', label: 'Suhu min', borderColor: '#0891b2', backgroundColor: '#0891b2', pointRadius: 2, data: hm.map((d) => d.tmin), yAxisID: 'y1' }] },
      options: { scales: { y: { position: 'left', title: { display: true, text: 'mm' }, beginAtZero: true }, y1: { position: 'right', title: { display: true, text: '°C' }, grid: { drawOnChartArea: false } } } } });
  },
  // ---------------- PISANG
  async pisang_bibit(el, A) {
    const { fmtNum, fmtDate, ctx } = A; const P = ctx.rows;
    const rows = P('pisang_bibit').map((r) => ({ r, saldo: n(r.qty_datang) - n(r.afkir) + n(r.splitting) - n(r.mortal) - n(r.ditanam), umur: n(r.umur_datang_bln) + util.daysSince(r.tanggal_datang) / 30.44 }));
    const saldo = sum(rows, (x) => x.saldo), siap = sum(rows.filter((x) => x.umur >= MIN_UMUR_TANAM), (x) => x.saldo);
    // kebutuhan: rencana blok pisang yang belum selesai tanam
    const lb = P('lahan_blok').filter((r) => (r.peruntukan || 'Pisang') === 'Pisang').map((r) => ({ r, p: lahanProgress(r, ctx) }));
    const lastAct = aktivitasUntuk(ctx, 'Pisang').slice(-1)[0]?.aktivitas;
    const sisaHa = sum(lb, (x) => n(x.r.luas_ha) * (1 - (x.p.per.find((p) => p.akt === lastAct)?.pct || 0)));
    const butuh = Math.round(sisaHa * POKOK_HA * (1 + SULAM));
    el.innerHTML = `<div class="kpis">
      ${tile('Stok bibit', fmtNum(saldo), 'pokok (semua batch)')}
      ${tile(`Siap tanam (≥ ${MIN_UMUR_TANAM} bln)`, fmtNum(siap), 'perkiraan dari umur batch')}
      ${tile('Kebutuhan sisa rencana', fmtNum(butuh), `${fmtNum(sisaHa, 2)} ha belum tanam × ${fmtNum(POKOK_HA)} pkk/ha + sulam ${SULAM * 100}%`)}
      ${tile(saldo >= butuh ? 'Kelebihan bibit' : 'Kekurangan bibit', `<span style="color:${saldo >= butuh ? 'var(--ok)' : 'var(--danger)'}">${fmtNum(Math.abs(saldo - butuh))}</span>`, 'stok − kebutuhan')}
    </div>
    ${rows.length ? `<div class="card o-card"><h3>Stok per batch</h3><table class="mini"><tr><th>Datang</th><th>Keterangan</th><th>Klon</th><th class="num">Datang</th><th class="num">Ditanam</th><th class="num">Mati+afkir</th><th class="num">Stok</th><th class="num">Umur (bln)</th></tr>
      ${rows.sort((a, b) => String(b.r.tanggal_datang).localeCompare(String(a.r.tanggal_datang))).map((x) => `<tr><td>${fmtDate(x.r.tanggal_datang)}</td><td>${A.esc(x.r.keterangan || '')}</td><td>${A.esc(x.r.klon || '')}</td><td class="num">${fmtNum(n(x.r.qty_datang) + n(x.r.splitting))}</td><td class="num">${fmtNum(x.r.ditanam)}</td><td class="num">${fmtNum(n(x.r.afkir) + n(x.r.mortal))}</td><td class="num"><b>${fmtNum(x.saldo)}</b></td><td class="num">${fmtNum(x.umur, 1)}</td></tr>`).join('')}</table></div>` : ''}`;
  },
  async pisang_progres(el, A) { await progres(el, A, 'Pisang'); },
  // khusus admin: tertanam per blok (luas netto & pokok sama dengan Ringkasan)
  async pisang_tertanam(el, A) {
    const { fmtNum, esc, ctx } = A; const P = ctx.rows;
    const t = tanamRows(A, 'Pisang');
    const st = {}; for (const x of t) { st[x.st || '-'] ??= { b: 0, l: 0, p: 0 }; st[x.st || '-'].b++; st[x.st || '-'].l += n(x.luas); st[x.st || '-'].p += n(x.pokok); }
    const tk = new Set(t.map((x) => keyB(x.blok)));
    const belum = P('pisang_blok').filter((r) => r.status === 'Belum Tanam' && !tk.has(keyB(r.nama_blok)));
    el.innerHTML = `<div class="kpis">
      ${tile('Luas tertanam (netto)', `${fmtNum(sum(t, (x) => x.luas), 2)} <small>ha</small>`, `${t.length} blok · lahan (gross) ${fmtNum(sum(t, (x) => x.gross), 2)} ha`)}
      ${tile('Pokok tanam', fmtNum(sum(t, (x) => x.pokok)), `hidup ${fmtNum(sum(t, (x) => x.pop))} (setelah kehilangan & sulam)`)}
      ${Object.entries(st).map(([k, v]) => tile(`Status ${esc(k)}`, `${v.b} <small>blok</small>`, `${fmtNum(v.l, 2)} ha · ${fmtNum(v.p)} pkk tanam`)).join('')}
      ${belum.length ? tile('Blok belum tanam', `${belum.length} <small>blok</small>`, `${fmtNum(sum(belum, (r) => r.luas_ha), 2)} ha (luas peta)`) : ''}
    </div><h2 class="o-h">Tanggal tanam per blok</h2><div id="kT"></div>`;
    renderTanggalTanam($('#kT', el), A, 'Pisang');
  },
  async pisang_panen(el, A) {
    renderPanenJual(el.appendChild(document.createElement('div')), A, 'Pisang');
    estimasiVsRealisasi(el.appendChild(document.createElement('div')), A);
    const P = A.ctx.rows;
    monthlyChart(el, A, 'Total box panen per bulan', [{ label: 'Total box', color: '#2f6b3f', rows: P('pisang_box'), fn: (r) => r.jumlah_box }]); // total saja, tanpa per kelas (permintaan user)
  },
  async pisang_jual(el, A) {
    renderPanenJual(el.appendChild(document.createElement('div')), A, 'Pisang', /Penjualan|terjual/);
    const P = A.ctx.rows;
    monthlyChart(el, A, 'Penjualan pisang per bulan (Rp juta)', [{ label: 'Penjualan', color: '#d4a017', rows: P('pisang_penjualan').filter(isJual), fn: (r) => nominalJual(r) / 1e6 }]);
  },
  // ---------------- PADI
  async padi_bibit(el, A) {
    const { fmtNum, esc, fmtDate, ctx } = A; const P = ctx.rows;
    const rows = P('padi_benih');
    const vars = [...new Set(rows.map((r) => r.varietas).filter(Boolean))];
    const per = vars.map((v) => { const x = rows.filter((r) => keyB(r.varietas) === keyB(v)); return { v, masuk: sum(x.filter((r) => r.jenis === 'Masuk'), (r) => r.qty_kg), pakai: sum(x.filter((r) => r.jenis === 'Pakai'), (r) => r.qty_kg), afkir: sum(x.filter((r) => r.jenis === 'Afkir'), (r) => r.qty_kg), stok: stokBenih(ctx, v), last: x.reduce((m, r) => (r.tanggal > m ? r.tanggal : m), '') }; });
    el.innerHTML = `<div class="kpis">
      ${tile('Stok benih', `${fmtNum(stokBenih(ctx), 1)} <small>kg</small>`, `${vars.length} varietas`)}
      ${tile('Benih masuk', `${fmtNum(sum(per, (x) => x.masuk), 1)} <small>kg</small>`, 'total')}
      ${tile('Benih dipakai', `${fmtNum(sum(per, (x) => x.pakai), 1)} <small>kg</small>`, 'untuk semai')}
    </div>
    <div class="card o-card"><h3>Stok per varietas</h3>${per.length ? `<table class="mini"><tr><th>Varietas</th><th class="num">Masuk</th><th class="num">Dipakai</th><th class="num">Afkir</th><th class="num">Stok (kg)</th><th>Mutasi terakhir</th></tr>
      ${per.map((x) => `<tr><td><b>${esc(x.v)}</b></td><td class="num">${fmtNum(x.masuk, 1)}</td><td class="num">${fmtNum(x.pakai, 1)}</td><td class="num">${fmtNum(x.afkir, 1)}</td><td class="num"><b>${fmtNum(x.stok, 1)}</b></td><td>${fmtDate(x.last)}</td></tr>`).join('')}</table>` : '<div class="empty">Belum ada data benih. Login lalu tambah mutasi benih (Masuk / Pakai / Afkir).</div>'}</div>`;
  },
  async padi_tertanam(el, A) {
    const { fmtNum, esc, ctx } = A; const P = ctx.rows;
    const t = P('padi_tanam').map((r) => ({ r, fase: padiFase(r, ctx) }));
    const aktif = t.filter((x) => !['Sudah Panen', 'Belum Tanam'].includes(x.fase));
    const fase = {}; for (const x of aktif) { fase[x.fase] ??= { n: 0, l: 0 }; fase[x.fase].n++; fase[x.fase].l += n(x.r.luas_tanam_ha); }
    // status per blok (kolom Status di Petak Sawah)
    const pet = [...P('padi_petak')].sort((a, b) => String(a.nama_petak).localeCompare(String(b.nama_petak), 'id', { numeric: true }));
    const tan = pet.filter((r) => r.status === 'Sudah Tanam'), blm = pet.filter((r) => r.status !== 'Sudah Tanam');
    const luasAll = sum(pet, (r) => r.luas_ha), luasT = sum(tan, (r) => r.luas_ha);
    const panenBy = {}; for (const r of P('padi_panen')) panenBy[keyB(r.petak)] = (panenBy[keyB(r.petak)] || 0) + n(r.gkp_kg);
    el.innerHTML = `<div class="kpis">
      ${tile('Padi tertanam', `${fmtNum(luasT, 2)} <small>ha</small>`, `${tan.length} dari ${pet.length} blok · ${luasAll ? fmtNum((luasT / luasAll) * 100, 0) : 0}% luas`)}
      ${tile('Belum tanam', `${fmtNum(luasAll - luasT, 2)} <small>ha</small>`, `${blm.length} blok`)}
      ${tile('Total luas blok padi', `${fmtNum(luasAll, 2)} <small>ha</small>`, `${pet.length} blok`)}
      ${Object.entries(fase).map(([k, v]) => tile(esc(k), `${fmtNum(v.l, 2)} <small>ha</small>`, `${v.n} petak`)).join('')}
    </div>
    <div class="card o-card"><h3>Status tanam per blok</h3>
      <div class="bar" style="height:12px;margin-bottom:10px"><i style="width:${luasAll ? (luasT / luasAll) * 100 : 0}%"></i></div>
      ${pet.length ? `<table class="mini"><tr><th>Blok</th><th class="num">Luas (ha)</th><th>Status</th></tr>
        ${pet.map((r) => `<tr><td><b>${esc(r.nama_petak)}</b></td><td class="num">${fmtNum(r.luas_ha, 2)}</td><td>${r.status === 'Sudah Tanam' ? '<span class="tag">✅ Sudah tanam</span>' : esc(r.status || 'Belum tanam')}</td></tr>`).join('')}
        <tr><td><b>Total</b></td><td class="num"><b>${fmtNum(luasAll, 2)}</b></td><td>${tan.length} sudah tanam</td></tr></table>` : '<div class="empty">Belum ada data blok padi.</div>'}
      <p class="small muted" style="margin:6px 0 0">Status diubah di tabel Petak Sawah di bawah (login admin).</p></div>
    ${t.length ? '<h2 class="o-h">Tanggal tanam per petak</h2><div id="kT"></div>' : ''}`;
    if (t.length) renderTanggalTanam($('#kT', el), A, 'Padi');
  },
  async padi_progres(el, A) { await progres(el, A, 'Padi'); },
  async padi_panen(el, A) {
    const { fmtNum, esc, ctx } = A; const P = ctx.rows;
    const pn = P('padi_panen'), gl = P('padi_giling');
    const gabah = sum(pn, (r) => r.gkp_kg), beras = sum(gl, (r) => r.beras_kg), karung = sum(pn, (r) => r.jumlah_karung);
    // panen padi digabung: semua blok & semua tahap jadi satu total
    const blok = [...new Set(pn.map((r) => keyB(r.petak)).filter(Boolean))];
    const nama = blok.map((k) => pn.find((r) => keyB(r.petak) === k).petak).sort((a, b) => String(a).localeCompare(String(b), 'id', { numeric: true }));
    const luas = sum(blok, (k) => n(P('padi_petak').find((x) => keyB(x.nama_petak) === k)?.luas_ha));
    const top = document.createElement('div');
    top.innerHTML = `<div class="kpis">
      ${tile('Total gabah dipanen', `${fmtNum(gabah, 2)} <small>kg</small>`, `${fmtNum(karung)} karung · ${fmtNum(karung ? gabah / karung : 0, 2)} kg/karung`)}
      ${tile('Luas blok terpanen', `${fmtNum(luas, 2)} <small>ha</small>`, `${nama.length} blok: ${nama.map(esc).join(', ')}`)}
      ${tile('Hasil per hektar', luas ? `${fmtNum(gabah / 1000 / luas, 2)} <small>ton/ha</small>` : '–', 'total gabah ÷ luas blok terpanen')}
      ${tile('Beras masuk gudang', `${fmtNum(beras, 2)} <small>kg</small>`, `${gl.length} kali giling`)}
      ${tile('Rendemen', gabah && beras ? fmtNum((beras / gabah) * 100, 2) + '%' : '–', 'total beras ÷ total gabah')}
    </div>
    <p class="small muted" style="margin:0 0 14px">Semua blok digabung jadi satu total. Rincian per blok (satu baris per blok) ada di tabel data di bawah.</p>`;
    el.appendChild(top);
  },
  async padi_jual(el, A) {
    const { fmtNum, ctx } = A; const P = ctx.rows;
    const masuk = sum(P('padi_giling'), (r) => r.beras_kg);
    const keluar = P('padi_penjualan').filter((r) => r.tipe !== 'Mutasi Internal');
    const kel = sum(keluar, (r) => r.berat_kg);
    const top = document.createElement('div');
    top.innerHTML = `<div class="kpis">
      ${tile('Stok beras', `${fmtNum(masuk - kel, 1)} <small>kg</small>`, 'beras masuk − keluar (semua gudang)')}
      ${tile('Beras masuk', `${fmtNum(masuk, 1)} <small>kg</small>`, 'hasil giling')}
      ${tile('Beras keluar', `${fmtNum(kel, 1)} <small>kg</small>`, `${keluar.length} surat jalan (jual + sampel)`)}
      ${tile('Nilai penjualan', 'Rp ' + fmtNum(sum(P('padi_penjualan').filter(isJual), (r) => (r.nominal != null ? r.nominal : n(r.berat_kg) * n(r.harga_kg)))), 'total semua periode')}
    </div>`;
    el.appendChild(top);
    renderPanenJual(el.appendChild(document.createElement('div')), A, 'Padi', /Penjualan|terjual/);
    monthlyChart(el, A, 'Penjualan beras/padi per bulan (Rp juta)', [{ label: 'Penjualan', color: '#65a30d', rows: A.ctx.rows('padi_penjualan').filter(isJual), fn: (r) => (r.nominal != null ? n(r.nominal) : n(r.berat_kg) * n(r.harga_kg)) / 1e6 }]);
  },
  // ---------------- INFRASTRUKTUR
  async infra_proyek(el, A) {
    const { fmtNum, esc, fmtDate, ctx } = A; const P = ctx.rows;
    const pr = P('infra_proyek'), pf = TABLES.infra_proyek.f.find((f) => f.k === 'progres').fn;
    el.innerHTML = `<div class="kpis">
      ${tile('Proyek berjalan', pr.filter((r) => r.status === 'Berjalan').length, `${pr.length} proyek tercatat`)}
      ${tile('Selesai', pr.filter((r) => r.status === 'Selesai').length, '')}
    </div>
    <div class="card o-card">${pr.length ? `<table class="mini"><tr><th>Proyek</th><th>Status</th><th style="width:22%">Progres</th><th>Mulai</th><th>Target</th></tr>
      ${pr.map((r) => { const p = pf(r, ctx); return `<tr><td><b>${esc(r.nama_proyek)}</b> <span class="small muted">${esc(r.jenis || '')} ${r.lokasi ? '· ' + esc(r.lokasi) : ''}</span></td><td><span class="tag">${esc(r.status || '-')}</span></td><td><div class="bar"><i style="width:${Math.min(100, (p || 0) * 100)}%"></i></div> <span class="small">${p == null ? '' : fmtNum(p * 100, 0) + '%'}</span></td><td>${fmtDate(r.tgl_mulai)}</td><td>${fmtDate(r.target_selesai)}</td></tr>`; }).join('')}</table>` : '<div class="empty">Belum ada proyek infrastruktur.</div>'}</div>`;
  },
};

async function progres(el, A, kom) {
  const { fmtNum, esc, ctx } = A;
  const gis = await loadGis(A);
  if (!el.isConnected) return; // halaman sudah diganti
  el.innerHTML = '<div id="kp"></div><h2 class="o-h">Progres per blok × tahap</h2><div id="km"></div>';
  renderProgres($('#kp', el), A, gis, kom);
  const acts = aktivitasUntuk(ctx, kom).map((a) => a.aktivitas);
  const bl = ctx.rows('lahan_blok').filter((r) => (r.peruntukan || 'Pisang') === kom).map((r) => ({ r, p: lahanProgress(r, ctx) }));
  const heat = (p) => (p >= 0.98 ? 'background:#bbf7d0' : p >= 0.5 ? 'background:#fef08a' : p > 0 ? 'background:#fed7aa' : 'color:#bbb');
  $('#km', el).innerHTML = `<div class="card o-card" style="overflow:auto">${bl.length ? `<table class="mini heat"><tr><th>Blok</th><th class="num">Luas</th>${acts.map((a) => `<th class="h" style="text-align:center">${esc(a)}</th>`).join('')}<th>Total</th></tr>
    ${bl.sort((a, b) => String(a.r.blok).localeCompare(String(b.r.blok), 'id', { numeric: true })).map((x) => `<tr><td><b>${esc(x.r.blok)}</b></td><td class="num">${fmtNum(x.r.luas_ha, 2)}</td>${x.p.per.map((p) => `<td class="h" style="${heat(p.pct)}" title="${fmtNum(p.ha, 2)} ha">${p.pct ? Math.round(p.pct * 100) + '%' : '·'}</td>`).join('')}<td style="min-width:90px"><div class="bar"><i style="width:${x.p.total * 100}%"></i></div></td></tr>`).join('')}</table>` : `<div class="empty">Belum ada rencana blok ${esc(kom.toLowerCase())}.</div>`}</div>`;
}

function monthlyChart(el, A, title, series, stacked) {
  const { b } = week();
  const end = b.slice(0, 7);
  const months = Array.from({ length: 12 }, (_, i) => { const [y, m] = end.split('-').map(Number); return util.iso(new Date(y, m - 1 - (11 - i), 1)).slice(0, 7); });
  const card = document.createElement('div');
  card.className = 'card o-card'; card.style.marginTop = '14px';
  card.innerHTML = `<h3>${A.esc(title)}</h3><div class="chart-box"><canvas></canvas></div>`;
  el.appendChild(card);
  A.chart(card.querySelector('canvas'), { type: 'bar', data: { labels: months.map((m) => `${BULAN[+m.slice(5) - 1]} ${m.slice(2, 4)}`), datasets: series.map((s) => ({ label: s.label, backgroundColor: s.color, data: months.map((m) => sum(s.rows.filter((r) => String(r.tanggal).slice(0, 7) === m), s.fn)) })) },
    options: stacked ? { scales: { x: { stacked: true }, y: { stacked: true } } } : {} });
}
