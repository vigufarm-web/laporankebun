// Halaman Tim Kebun (/kebun): target vs realisasi progres tanam pisang per bulan — hanya lihat, tanpa login.
// Data sama dengan aplikasi utama (otomatis dari Progres Harian, Rencana Blok, Blok Tanam, Target Tanam).
import { util, aktivitasUntuk, lahanProgress, pisangTertanam } from './schema.js';

const $ = (s, el = document) => el.querySelector(s);
const n = util.n, key = util.key;
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = (x) => (x == null || !isFinite(x) ? '–' : Number(x).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const f0 = (x) => Number(x || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
const pct = (a, b) => (b ? Math.min(100, (a / b) * 100) : 0);
const ymOf = (d) => String(d || '').slice(0, 7);
const lblBulan = (ym) => `${BULAN[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tglID = (s) => { const d = util.d(s); return d ? `${d.getDate()} ${BULAN[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : '–'; };
const HARI_KERJA = 6; // Senin–Sabtu (sama dengan jadwal Estimasi Land Prep)
// hari kerja (Senin–Sabtu) dari a s/d b (termasuk keduanya)
function hariKerja(a, b) { let c = 0; const d = new Date(a); d.setHours(0, 0, 0, 0); const e = new Date(b); e.setHours(0, 0, 0, 0); while (d <= e) { if (d.getDay() !== 0) c++; d.setDate(d.getDate() + 1); } return c; }
const akhirBulan = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5), 0);
// tanggal setelah menambah n hari kerja (Senin–Sabtu) dari hari ini
function tambahHariKerja(a, nHari) { const d = new Date(a); d.setHours(0, 0, 0, 0); let sisa = Math.ceil(nHari); while (sisa > 1) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0) sisa--; } return d; }

async function muat() {
  const T = ['lahan_blok', 'lahan_harian', 'lahan_aktivitas', 'lahan_target', 'pisang_blok'];
  const [rows, set] = await Promise.all([Promise.all(T.map((t) => fetch('/api/t/' + t).then((r) => (r.ok ? r.json() : [])))), fetch('/api/settings').then((r) => r.json()).catch(() => ({}))]);
  const data = Object.fromEntries(T.map((t, i) => [t, rows[i]]));
  if (set.nama) $('#nm').textContent = set.nama;
  render({ rows: (t) => data[t] || [] });
}

function render(ctx) {
  const P = ctx.rows, el = $('#kb');
  const today = util.today(), ymNow = ymOf(iso(today));
  const acts = aktivitasUntuk(ctx, 'Pisang').map((a) => a.aktivitas);
  const rencana = new Map(P('lahan_blok').filter((r) => (r.peruntukan || 'Pisang') === 'Pisang').map((r) => [key(r.blok), r]));
  const tt = pisangTertanam(ctx);
  // blok target (luas = luas blok di Rencana Blok, sama dengan dasar target)
  const tg = P('lahan_target').filter((r) => r.blok && r.bulan && rencana.has(key(r.blok))).map((r) => {
    const b = rencana.get(key(r.blok)), luas = n(b.luas_ha), sudah = tt.has(key(r.blok));
    const per = lahanProgress(b, ctx).per; // % tiap kegiatan dari progres harian
    const pc = Object.fromEntries(acts.map((a) => [a, sudah ? 1 : per.find((p) => p.akt === a)?.pct || 0]));
    const next = acts.find((a) => pc[a] < 0.98);
    return { blok: b.blok, ym: ymOf(r.bulan), luas, sudah, pc, next, total: acts.reduce((s, a) => s + pc[a], 0) / (acts.length || 1) };
  }).sort((a, b) => a.ym.localeCompare(b.ym) || b.total - a.total || a.blok.localeCompare(b.blok));
  if (!tg.length) { el.innerHTML = '<div class="card">Belum ada target tanam. Isi di Excel sheet "Progres - Target Tanam".</div>'; return; }
  const months = [...new Set(tg.map((x) => x.ym))].sort();
  // kecepatan kerja historis per kegiatan (ha per hari kerja aktif) dari Progres Harian
  const har = P('lahan_harian').filter((r) => { const b = rencana.get(key(r.blok)); return b || acts.includes(r.aktivitas); });
  const speed = {};
  for (const a of acts) { const h = har.filter((r) => r.aktivitas === a); const days = new Set(h.map((r) => r.tanggal)).size; speed[a] = days ? h.reduce((s, r) => s + n(r.hasil_ha), 0) / days : 0; }
  // target kumulatif s/d akhir bulan M (semua kegiatan blok bertarget ≤ M harus selesai) vs realisasi.
  // Perkiraan selesai mengikuti urutan kegiatan (timeline): kegiatan baru bisa tuntas setelah kegiatan sebelumnya tuntas,
  // ditambah waktu mengerjakan blok terakhir; kecepatan = rata-rata historis.
  const cache = {};
  const rantai = (ym) => {
    if (cache[ym]) return cache[ym];
    const bl = tg.filter((x) => x.ym <= ym), sisaBlok = bl.filter((x) => !x.sudah);
    const rata = sisaBlok.length ? sisaBlok.reduce((s, x) => s + x.luas, 0) / sisaBlok.length : 0;
    const avail = ym < ymNow ? 0 : hariKerja(today, akhirBulan(ym));
    let prev = 0; const out = {};
    for (const a of acts) {
      const target = bl.reduce((s, x) => s + x.luas, 0), done = bl.reduce((s, x) => s + x.pc[a] * x.luas, 0), kurang = Math.max(0, target - done);
      const sendiri = kurang <= 0.005 ? 0 : speed[a] ? kurang / speed[a] : Infinity;
      const perlu = kurang <= 0.005 ? 0 : Math.max(sendiri, prev + (speed[a] ? Math.min(kurang, rata) / speed[a] : Infinity));
      prev = Math.max(prev, perlu);
      const st = kurang <= 0.005 ? ['ok', '✅ Tercapai'] : ym < ymNow ? ['no', '🔴 Terlambat'] : perlu <= avail ? ['on', '🟢 Terkejar'] : ['no', '🔴 Tertinggal'];
      out[a] = { target, done, kurang, avail, perlu, st, selesai: isFinite(perlu) && perlu > 0 ? tambahHariKerja(today, perlu) : null };
    }
    return (cache[ym] = out);
  };
  const stat = (a, ym) => rantai(ym)[a];
  const tanam = acts[acts.length - 1];
  const totTarget = tg.reduce((s, x) => s + x.luas, 0), totSudah = tg.filter((x) => x.sudah).reduce((s, x) => s + x.luas, 0);
  let pilih = months.find((m) => m >= ymNow) || months[months.length - 1];
  // minggu ini (Senin–Minggu)
  const senin = new Date(today); senin.setDate(today.getDate() - ((today.getDay() + 6) % 7)); const minggu = new Date(senin); minggu.setDate(senin.getDate() + 6);
  const wk = har.filter((r) => r.tanggal >= iso(senin) && r.tanggal <= iso(minggu));

  const draw = () => {
    el.innerHTML = `
    <div class="sub" style="margin-top:6px">Data per ${tglID(iso(today))} · otomatis dari aplikasi (progres harian)</div>
    <h1>🍌 Progres Tanam Pisang — Target vs Realisasi</h1>

    <div class="card o-card">
      <div class="sub">Target tanam ${esc(lblBulan(months[0]))} – ${esc(lblBulan(months[months.length - 1]))} · ${tg.length} blok</div>
      <div><span class="big">${f2(totSudah)}</span> <span class="sub" style="font-size:15px">dari ${f2(totTarget)} ha sudah ditanam (${f0(pct(totSudah, totTarget))}%)</span></div>
      <div class="bar"><i style="width:${pct(totSudah, totTarget)}%"></i></div>
      <div class="sub">Sisa ${f2(totTarget - totSudah)} ha · ${tg.filter((x) => !x.sudah).length} blok belum tanam</div>
    </div>

    <h2>Target tanam per bulan</h2>
    <div class="bln">${months.map((m) => {
      const bl = tg.filter((x) => x.ym === m), t = bl.reduce((s, x) => s + x.luas, 0), d = bl.filter((x) => x.sudah).reduce((s, x) => s + x.luas, 0);
      const s = stat(tanam, m);
      return `<div class="card o-card"><div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><b>${esc(lblBulan(m))}</b><span class="st ${s.st[0]}">${s.st[1]}</span></div>
        <div style="margin-top:6px"><span class="big" style="font-size:22px">${f2(d)}</span> / ${f2(t)} ha</div>
        <div class="bar"><i style="width:${pct(d, t)}%"></i></div>
        <div class="sub" style="margin:0">${bl.map((x) => (x.sudah ? `✅${esc(x.blok)}` : esc(x.blok))).join(', ')}${m >= ymNow ? ` · ${s.avail} hari kerja lagi` : ''}</div></div>`;
    }).join('')}</div>

    <h2>Kegiatan s/d akhir bulan</h2>
    <div class="tabs">${months.map((m) => `<a data-m="${m}" class="${m === pilih ? 'on' : ''}">${esc(BULAN[+m.slice(5) - 1])}</a>`).join('')}</div>
    <div class="card o-card" style="overflow:auto">
      <div class="sub">Semua kegiatan untuk blok bertarget s/d <b>${esc(lblBulan(pilih))}</b> harus selesai paling lambat ${tglID(iso(akhirBulan(pilih)))}${pilih >= ymNow ? ` (${hariKerja(today, akhirBulan(pilih))} hari kerja lagi, Senin–Sabtu)` : ''}.</div>
      <table class="mini"><tr><th>Kegiatan</th><th class="num">Target (ha)</th><th class="num">Selesai</th><th class="num">Kurang</th><th>Status</th></tr>
      ${acts.map((a) => { const s = stat(a, pilih); return `<tr><td><b>${esc(a)}</b><div class="small muted">${speed[a] ? f2(speed[a]) + ' ha/hari' : 'belum ada data kecepatan'}</div></td>
        <td class="num">${f2(s.target)}</td><td class="num">${f2(s.done)}<div class="mini-bar"><i style="width:${pct(s.done, s.target)}%"></i></div></td><td class="num">${s.kurang > 0.005 ? f2(s.kurang) : '–'}</td>
        <td><span class="st ${s.st[0]}">${s.st[1]}</span>${s.kurang > 0.005 && pilih >= ymNow ? `<div class="small muted">perkiraan selesai ${s.selesai ? tglID(iso(s.selesai)) : '?'}</div>` : ''}</td></tr>`; }).join('')}
      </table>
      <div class="small muted" style="margin-top:6px">Perkiraan selesai mengikuti urutan kegiatan (kegiatan berikutnya baru tuntas setelah kegiatan sebelumnya) dengan kecepatan rata-rata selama ini, Senin–Sabtu. 🟢 Terkejar = perkiraan selesai sebelum akhir bulan. 🔴 Tertinggal = lewat akhir bulan (perlu tambah tenaga/alat).</div>
    </div>

    <h2>Per blok</h2>
    ${months.map((m) => `<div class="card o-card"><b>${esc(lblBulan(m))}</b>
      ${tg.filter((x) => x.ym === m).map((x) => { const kerja = wk.some((r) => key(r.blok) === key(x.blok));
        const st = x.sudah ? ['ok', '✅ Sudah tanam'] : m < ymNow ? ['no', '🔴 Lewat target'] : kerja ? ['on', '🔨 Dikerjakan minggu ini'] : x.total > 0 ? ['wait', 'Berjalan'] : ['wait', 'Belum mulai'];
        return `<div class="blk"><div><b>${esc(x.blok)}</b><div class="small muted">${f2(x.luas)} ha</div></div>
          <div>${x.sudah ? 'Semua kegiatan selesai' : `Berikutnya: <b>${esc(x.next || '-')}</b>`}<div class="mini-bar"><i style="width:${x.total * 100}%"></i></div><div class="small muted">${f0(x.total * 100)}% kegiatan selesai</div></div>
          <span class="st ${st[0]}">${st[1]}</span></div>`; }).join('')}</div>`).join('')}

    <h2>Pekerjaan minggu ini <span class="sub">(${tglID(iso(senin))} – ${tglID(iso(minggu))})</span></h2>
    <div class="card o-card">${wk.length ? `<table class="mini"><tr><th>Kegiatan</th><th class="num">Hasil (ha)</th><th>Blok</th></tr>
      ${acts.filter((a) => wk.some((r) => r.aktivitas === a)).map((a) => { const w = wk.filter((r) => r.aktivitas === a); return `<tr><td>${esc(a)}</td><td class="num">${f2(w.reduce((s, r) => s + n(r.hasil_ha), 0))}</td><td>${[...new Set(w.map((r) => r.blok))].map((b) => `<span class="tag">${esc(b)}</span>`).join(' ')}</td></tr>`; }).join('')}</table>` : '<div class="sub" style="margin:0">Belum ada pekerjaan tercatat minggu ini.</div>'}</div>

    <div class="foot">Luas memakai luas blok di Rencana Blok (sama dengan dasar target). Blok yang sudah ditanam dihitung selesai semua kegiatannya.
      Kecepatan = rata-rata hasil per hari kerja dari seluruh progres harian. Target diubah di Excel sheet "Progres - Target Tanam".</div>`;
    el.querySelectorAll('.tabs a').forEach((a) => (a.onclick = () => { pilih = a.dataset.m; draw(); }));
  };
  draw();
}

$('#rf').onclick = () => { $('#kb').innerHTML = '<div class="card">Memuat data…</div>'; muat().catch(tampilError); };
const tampilError = (e) => { $('#kb').innerHTML = `<div class="card">Data tidak bisa dimuat: ${esc(e.message)}</div>`; };
muat().catch(tampilError);
