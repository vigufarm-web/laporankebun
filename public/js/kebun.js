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
  // minggu ini (Senin–Minggu); hari kerja tersisa minggu ini (Senin–Sabtu, termasuk hari ini)
  const senin = new Date(today); senin.setDate(today.getDate() - ((today.getDay() + 6) % 7)); const minggu = new Date(senin); minggu.setDate(senin.getDate() + 6);
  const sabtu = new Date(senin); sabtu.setDate(senin.getDate() + 5);
  const wk = har.filter((r) => r.tanggal >= iso(senin) && r.tanggal <= iso(minggu));
  const sisaHariMinggu = Math.max(1, hariKerja(today, sabtu));
  const mundurHariKerja = (d0, nh) => { const d = new Date(d0); let s = Math.ceil(nh); while (s > 0) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0) s--; } return d; };
  // rencana per bulan (blok bulan itu saja): batas selesai tiap kegiatan dihitung MUNDUR dari akhir bulan mengikuti urutan
  // kegiatan (timeline) — kegiatan awal harus selesai lebih dulu agar kegiatan berikutnya sempat dikerjakan.
  const rencanaBulan = (ym) => {
    const bl = tg.filter((x) => x.ym === ym), sisa = bl.filter((x) => !x.sudah);
    const rata = sisa.length ? sisa.reduce((s, x) => s + x.luas, 0) / sisa.length : 0;
    const batas = {}; let d = akhirBulan(ym);
    for (let i = acts.length - 1; i >= 0; i--) { const a = acts[i]; batas[a] = new Date(d); d = mundurHariKerja(d, speed[a] ? rata / speed[a] : 0); }
    const keg = {};
    for (const a of acts) {
      const target = bl.reduce((s, x) => s + x.luas, 0), done = bl.reduce((s, x) => s + x.pc[a] * x.luas, 0), kurang = Math.max(0, target - done);
      const hari = batas[a] < today ? 0 : hariKerja(today, batas[a]);
      const perHari = kurang <= 0.005 ? 0 : hari ? kurang / hari : kurang;
      const mingguIni = wk.filter((r) => r.aktivitas === a && bl.some((x) => key(x.blok) === key(r.blok))).reduce((s, r) => s + n(r.hasil_ha), 0);
      keg[a] = { target, done, kurang, batas: batas[a], mingguIni, tMinggu: kurang <= 0.005 ? 0 : Math.min(kurang, perHari * sisaHariMinggu) + mingguIni, lewat: kurang > 0.005 && batas[a] < today };
    }
    const luas = bl.reduce((s, x) => s + x.luas, 0);
    return { bl, keg, luas, tanam: bl.filter((x) => x.sudah).reduce((s, x) => s + x.luas, 0), progres: luas ? bl.reduce((s, x) => s + x.total * x.luas, 0) / luas : 0 };
  };
  const R = Object.fromEntries(months.map((m) => [m, rencanaBulan(m)]));
  // prioritas hari ini: kegiatan berikutnya tiap blok yang belum tanam, urut batas selesai (timeline) → bulan → progres
  const kerjaMinggu = (b) => wk.some((r) => key(r.blok) === key(b));
  const prioritas = tg.filter((x) => !x.sudah && x.next).map((x) => ({ x, a: x.next, sisa: (1 - x.pc[x.next]) * x.luas, batas: R[x.ym].keg[x.next].batas }))
    .sort((p, q) => p.batas - q.batas || p.x.ym.localeCompare(q.x.ym) || q.x.total - p.x.total);
  const MAKS = 8;
  const pctTxt = (a, b) => `${f0(pct(a, b))}%`;
  const blnPendek = (ym) => BULAN[+ym.slice(5) - 1].slice(0, 3);

  el.innerHTML = `
    <div class="sub" style="margin-top:6px">Data per ${tglID(iso(today))} · otomatis dari aplikasi (progres harian)</div>
    <h1>🍌 Progres Tanam Pisang</h1>
    <div class="card o-card">
      <div class="sub">Target tanam ${esc(lblBulan(months[0]))} – ${esc(lblBulan(months[months.length - 1]))} · ${tg.length} blok</div>
      <div><span class="big">${f2(totSudah)}</span> <span class="sub" style="font-size:15px">dari ${f2(totTarget)} ha sudah ditanam (${f0(pct(totSudah, totTarget))}%)</span></div>
      <div class="bar"><i style="width:${pct(totSudah, totTarget)}%"></i></div>
      <div class="sub" style="margin:0">${months.map((m) => `${blnPendek(m)} ${f2(R[m].tanam)}/${f2(R[m].luas)} ha`).join(' · ')}</div>
    </div>

    <h2>🔨 Prioritas kerja hari ini</h2>
    <div class="card o-card">${prioritas.length ? `<div class="sub">Urut sesuai timeline: kegiatan yang batasnya paling dekat dikerjakan lebih dulu.</div>
      ${prioritas.slice(0, MAKS).map((p, i) => `<div class="blk" style="grid-template-columns:28px 1fr auto"><div class="big" style="font-size:18px;color:var(--brand)">${i + 1}</div>
        <div><b>${esc(p.x.blok)}</b> · ${esc(p.a)} <span class="small muted">· sisa ${f2(p.sisa)} ha</span><div class="small muted">batas ${tglID(iso(p.batas))} · target tanam ${esc(BULAN[+p.x.ym.slice(5) - 1])}${kerjaMinggu(p.x.blok) ? ' · 🔨 dikerjakan minggu ini' : ''}</div></div>
        <span class="st ${p.batas < today ? 'no' : p.x.ym === ymNow ? 'on' : 'wait'}">${p.batas < today ? 'Lewat batas' : p.x.ym === ymNow ? 'Bulan ini' : blnPendek(p.x.ym)}</span></div>`).join('')}
      ${prioritas.length > MAKS ? `<div class="sub" style="margin:8px 0 0">… dan ${prioritas.length - MAKS} pekerjaan berikutnya (lihat per bulan di bawah).</div>` : ''}` : '<div class="sub" style="margin:0">Semua blok target sudah ditanam. 🎉</div>'}</div>

    ${months.map((m) => { const r = R[m], st = stat(tanam, m).st, aktif = acts.filter((a) => r.keg[a].target > 0);
      return `<h2>${esc(lblBulan(m))}</h2>
      <div class="card o-card">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><div>Target tanam <b>${f2(r.luas)} ha</b> · ${r.bl.length} blok</div><span class="st ${st[0]}">${st[1]}</span></div>
        <div style="margin-top:8px"><span class="big" style="font-size:24px">${f2(r.tanam)} ha</span> <span class="sub">sudah ditanam (${pctTxt(r.tanam, r.luas)}) · progres semua kegiatan ${f0(r.progres * 100)}%</span></div>
        <div class="bar"><i style="width:${pct(r.tanam, r.luas)}%"></i></div>
        <div class="sub">${m >= ymNow ? `${hariKerja(today, akhirBulan(m))} hari kerja lagi s/d ${tglID(iso(akhirBulan(m)))}` : 'bulan sudah lewat'}</div>
        <div style="overflow:auto"><table class="mini"><tr><th>Kegiatan</th><th class="num">Selesai</th><th class="num">Target minggu ini</th><th class="num">Minggu ini</th></tr>
        ${aktif.map((a) => { const k = r.keg[a];
          return `<tr><td><b>${esc(a)}</b>${k.kurang > 0.005 ? `<div class="small muted">batas ${tglID(iso(k.batas))}</div>` : ''}</td>
            <td class="num">${f2(k.done)} / ${f2(k.target)} ha<div class="mini-bar"><i style="width:${pct(k.done, k.target)}%"></i></div><div class="small muted">${pctTxt(k.done, k.target)}</div></td>
            <td class="num">${k.kurang <= 0.005 ? '<span class="st ok">✅ Selesai</span>' : `${f2(k.tMinggu)} ha${k.lewat ? '<div class="small" style="color:var(--danger)">lewat batas</div>' : ''}`}</td>
            <td class="num">${k.mingguIni ? `<b>${f2(k.mingguIni)}</b> ha${k.tMinggu > 0.005 ? `<div class="small muted">${pctTxt(k.mingguIni, k.tMinggu)}</div>` : ''}` : '–'}</td></tr>`; }).join('')}
        </table></div>
        <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${r.bl.map((x) => `<span class="st ${x.sudah ? 'ok' : kerjaMinggu(x.blok) ? 'on' : 'wait'}">${x.sudah ? '✅ ' + esc(x.blok) : `${esc(x.blok)} → ${esc(x.next || '-')} · ${f0(x.total * 100)}%`}</span>`).join('')}</div>
      </div>`; }).join('')}

    <h2>Pekerjaan tercatat minggu ini <span class="sub">(${tglID(iso(senin))} – ${tglID(iso(minggu))})</span></h2>
    <div class="card o-card">${wk.length ? `<table class="mini"><tr><th>Kegiatan</th><th class="num">Hasil (ha)</th><th>Blok</th></tr>
      ${acts.filter((a) => wk.some((r) => r.aktivitas === a)).map((a) => { const w = wk.filter((r) => r.aktivitas === a); return `<tr><td>${esc(a)}</td><td class="num">${f2(w.reduce((s, r) => s + n(r.hasil_ha), 0))}</td><td>${[...new Set(w.map((r) => r.blok))].map((b) => `<span class="tag">${esc(b)}</span>`).join(' ')}</td></tr>`; }).join('')}</table>` : '<div class="sub" style="margin:0">Belum ada pekerjaan tercatat minggu ini.</div>'}</div>

    <div class="foot">Cara baca: <b>Target minggu ini</b> = luas yang perlu dikerjakan minggu ini (Senin–Sabtu) agar tiap kegiatan selesai sebelum batasnya. Batas dihitung mundur dari akhir bulan mengikuti urutan kegiatan dan kecepatan kerja rata-rata selama ini.
      Luas memakai luas blok di Rencana Blok; blok yang sudah ditanam dihitung selesai semua kegiatannya. Target diubah di Excel sheet "Progres - Target Tanam".</div>`;
}

$('#rf').onclick = () => { $('#kb').innerHTML = '<div class="card">Memuat data…</div>'; muat().catch(tampilError); };
const tampilError = (e) => { $('#kb').innerHTML = `<div class="card">Data tidak bisa dimuat: ${esc(e.message)}</div>`; };
muat().catch(tampilError);
