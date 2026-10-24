// Laporan Owner: laporan per periode (mingguan / bulanan / rentang tanggal) dari data aplikasi, bisa diunduh sebagai PDF.
// Semua angka dihitung dari tabel yang sama dengan halaman lain (Rencana Kerja, Progres Harian, Panen, Padi, Infrastruktur),
// target kegiatan memakai targetPeriode() yang juga dipakai /kebun — jadi selalu sama dan ikut terupdate.
import { util, TABLES, statusRencana, tanamPerBulan, targetPeriode, pisangTertanam, nominalJual, isJual, lahanProgress, aktivitasUntuk, iklimHarian, HARI_HUJAN_MM } from './schema.js';
import { tanamRows, loadGis, serahTerima } from './owner.js';

const n = util.n, key = util.key, iso = util.iso;
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const $ = (s, r = document) => r.querySelector(s);
const sum = (xs, fn) => xs.reduce((s, x) => s + n(fn(x)), 0);
const inP = (t, a, b) => !!t && t >= a && t <= b;
const nomBeras = (r) => (r.nominal != null && r.nominal !== '' ? n(r.nominal) : n(r.berat_kg) * n(r.harga_kg));
function senin(s) { const d = util.d(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); }
function isoWeek(s) { const t = util.d(s); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); const w1 = new Date(t.getFullYear(), 0, 4); return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7); }
const tgl = (s, th = true) => { const d = util.d(s); return d ? `${d.getDate()} ${BULAN[d.getMonth()]}${th ? ' ' + d.getFullYear() : ''}` : '–'; };
const tglPendek = (s) => { const d = util.d(s); return d ? `${d.getDate()} ${BULAN[d.getMonth()].slice(0, 3)}` : '–'; };
const rentangLbl = (a, b) => { const x = util.d(a), y = util.d(b); return x.getFullYear() !== y.getFullYear() ? `${tgl(a)} – ${tgl(b)}` : x.getMonth() !== y.getMonth() ? `${tgl(a, false)} – ${tgl(b)}` : `${x.getDate()}–${tgl(b)}`; };

function panjangM(g) { // panjang LineString / MultiLineString (meter, haversine)
  const R = 6371008.8, rad = Math.PI / 180;
  const ln = (cs) => cs.slice(1).reduce((t, p, i) => { const q = cs[i], dLa = (p[1] - q[1]) * rad, dLo = (p[0] - q[0]) * rad; const h = Math.sin(dLa / 2) ** 2 + Math.cos(q[1] * rad) * Math.cos(p[1] * rad) * Math.sin(dLo / 2) ** 2; return t + 2 * R * Math.asin(Math.sqrt(h)); }, 0);
  return !g ? 0 : g.type === 'LineString' ? ln(g.coordinates) : g.type === 'MultiLineString' ? g.coordinates.reduce((t, c) => t + ln(c), 0) : 0;
}
const tglLokal = (ts) => iso(new Date(ts)); // waktu log (UTC) → tanggal lokal

// ---------- periode: { mode, a, b, label, prev, next }
let pilih = (() => { try { return JSON.parse(sessionStorage.getItem('lapOwner')) || null; } catch { return null; } })();
function periode(p) {
  const hariIni = iso(util.today());
  if (p.mode === 'bulan') {
    const ym = (p.a || hariIni).slice(0, 7), y = +ym.slice(0, 4), m = +ym.slice(5) - 1;
    const mk = (yy, mm) => { const a = iso(new Date(yy, mm, 1)), b = iso(new Date(yy, mm + 1, 0)); const d = util.d(a); return { a, b, label: `${BULAN[d.getMonth()]} ${d.getFullYear()}` }; };
    return { mode: 'bulan', ...mk(y, m), prev: mk(y, m - 1), next: mk(y, m + 1), jenis: 'Bulanan', judul: `Laporan Bulanan ${mk(y, m).label}`, rentang: rentangLbl(mk(y, m).a, mk(y, m).b), lalu: 'bulan lalu', depan: 'bulan depan' };
  }
  if (p.mode === 'rentang' && p.a && p.b && p.a <= p.b) {
    const hari = Math.round((util.d(p.b) - util.d(p.a)) / 864e5) + 1;
    const mk = (a, b) => ({ a, b, label: rentangLbl(a, b) });
    return { mode: 'rentang', ...mk(p.a, p.b), prev: mk(util.addDays(p.a, -hari), util.addDays(p.a, -1)), next: mk(util.addDays(p.b, 1), util.addDays(p.b, hari)), jenis: 'Periode', judul: `Laporan Periode ${rentangLbl(p.a, p.b)}`, rentang: rentangLbl(p.a, p.b), lalu: `${hari} hari sebelumnya`, depan: `${hari} hari berikutnya` };
  }
  const mk = (a) => { const b = util.addDays(a, 6); return { a, b, label: `Minggu ke-${isoWeek(a)} · ${rentangLbl(a, b)}` }; };
  const a = senin(p.a || hariIni);
  return { mode: 'minggu', ...mk(a), prev: mk(util.addDays(a, -7)), next: mk(util.addDays(a, 7)), jenis: 'Mingguan', judul: `Laporan Mingguan Minggu ke-${isoWeek(a)}`, rentang: rentangLbl(a, util.addDays(a, 6)), lalu: 'minggu lalu', depan: 'minggu depan' };
}

export function renderLaporan(main, A) {
  const { esc, fmtNum } = A;
  const f2 = (v) => fmtNum(v, 2), f0 = (v) => fmtNum(v, 0), rp = (v) => 'Rp ' + fmtNum(Math.round(v), 0);
  const hariIni = iso(util.today());
  const PR = periode(pilih || { mode: 'minggu' });
  const jalan0 = PR.a <= hariIni && hariIni <= PR.b;
  const simpan = (p) => { pilih = p; try { sessionStorage.setItem('lapOwner', JSON.stringify(p)); } catch {} renderLaporan(main, A); };

  main.innerHTML = `
    <div class="page-head no-print"><div><div class="crumb">Laporan</div><h1>Laporan Owner</h1>
      <p class="desc">Laporan pertanggungjawaban per periode, dihitung otomatis dari data aplikasi (rencana kerja, progres harian, panen, padi, infrastruktur). Pilih periode lalu klik <b>Unduh PDF</b>.</p></div></div>
    <div class="card no-print lp-ctrl">
      <div class="tabs sub">${[['minggu', 'Mingguan'], ['bulan', 'Bulanan'], ['rentang', 'Rentang tanggal']].map(([k, l]) => `<a href="javascript:void 0" data-m="${k}" class="${PR.mode === k ? 'on' : ''}">${l}</a>`).join('')}</div>
      <div class="lp-in">${PR.mode === 'minggu' ? `<button class="btn" data-g="-7">‹ Minggu lalu</button><input type="date" class="btn" id="lpTgl" value="${PR.a}"><button class="btn" data-g="7">Minggu depan ›</button><button class="btn" data-g="0">Minggu ini</button>`
        : PR.mode === 'bulan' ? `<button class="btn" data-g="-1">‹ Bulan lalu</button><input type="month" class="btn" id="lpBln" value="${PR.a.slice(0, 7)}"><button class="btn" data-g="1">Bulan depan ›</button><button class="btn" data-g="0">Bulan ini</button>`
        : `<label class="small">Dari <input type="date" class="btn" id="lpA" value="${PR.a}"></label><label class="small">s/d <input type="date" class="btn" id="lpB" value="${PR.b}"></label><button class="btn" id="lpTerap">Terapkan</button>`}
        <span style="margin-left:auto"></span><button class="btn primary" id="lpPdf">⬇ Unduh PDF</button><button class="btn" id="lpDoc">⬇ Unduh Word</button></div>
      <p class="small muted" style="margin:8px 0 0">PDF diunduh langsung dengan format laporan yang rapi.</p>
    </div>
    <div id="lp" class="lp"></div>`;
  main.querySelectorAll('[data-m]').forEach((x) => (x.onclick = () => simpan(x.dataset.m === 'rentang' ? { mode: 'rentang', a: PR.a, b: PR.b > hariIni && PR.a <= hariIni ? hariIni : PR.b } : { mode: x.dataset.m, a: jalan0 ? hariIni : PR.a }))); // periode berjalan → tetap di hari ini
  main.querySelectorAll('[data-g]').forEach((x) => (x.onclick = () => {
    const g = +x.dataset.g;
    if (PR.mode === 'minggu') simpan({ mode: 'minggu', a: g ? util.addDays(PR.a, g) : hariIni });
    else { const d = util.d(PR.a); simpan({ mode: 'bulan', a: g ? iso(new Date(d.getFullYear(), d.getMonth() + g, 1)) : hariIni }); }
  }));
  $('#lpTgl', main)?.addEventListener('change', (e) => e.target.value && simpan({ mode: 'minggu', a: e.target.value }));
  $('#lpBln', main)?.addEventListener('change', (e) => e.target.value && simpan({ mode: 'bulan', a: e.target.value + '-01' }));
  $('#lpTerap', main)?.addEventListener('click', () => { const a = $('#lpA', main).value, b = $('#lpB', main).value; if (!a || !b || a > b) return A.toast('Tanggal "dari" harus sebelum "s/d"', true); simpan({ mode: 'rentang', a, b }); });
  const namaFile = () => `${PR.judul} (${PR.rentang})`.replace(/[·/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  $('#lpPdf', main).onclick = () => {const a=document.createElement('a');a.href='/api/reports/owner.pdf?'+new URLSearchParams({from:PR.a,to:PR.b});a.download=namaFile()+'.pdf';a.click();};
  // Word: dokumen HTML yang dibuka Microsoft Word (.doc) — bisa langsung diedit; gaya tabel ditulis di dalam file
  $('#lpDoc', main).onclick = () => {
    const css = 'body{font-family:Arial,sans-serif;font-size:10.5pt;color:#1f2a24}h2{color:#2f6b3f;font-size:13pt;border-bottom:1.5pt solid #cfe3d5;margin:14pt 0 6pt}h3{font-size:11pt;margin:8pt 0 4pt}'
      + 'table{border-collapse:collapse;width:100%;margin:4pt 0}th{background:#2f6b3f;color:#fff;text-align:left;padding:3pt 5pt;font-size:9.5pt}td{border-bottom:.5pt solid #d5dbd7;padding:3pt 5pt;font-size:9.5pt;vertical-align:top}.num{text-align:right}'
      + '.lp-head{background:#2f6b3f;color:#fff;padding:8pt 10pt}.lp-jd{font-size:16pt;font-weight:bold}.small,.muted,.note{font-size:8.5pt;color:#5b6670}.kpi{border:.5pt solid #d5dbd7;padding:4pt 6pt;margin:3pt 0}.kpi .lbl{color:#5b6670;font-size:8.5pt}.kpi .val{font-size:13pt;font-weight:bold}'
      + '.st{font-weight:bold}.st.ok{color:#166534}.st.no{color:#b91c1c}.st.wait{color:#92400e}.lp-warn{background:#fffbeb;border-left:3pt solid #d97706;padding:5pt 8pt}.lp-ok{background:#f0fdf4;border-left:3pt solid #16a34a;padding:5pt 8pt}';
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(namaFile())}</title><style>@page{size:21cm 29.7cm;margin:1.5cm}${css}</style></head><body>${$('#lp', main).innerHTML}</body></html>`;
    const u = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }));
    const l = document.createElement('a'); l.href = u; l.download = namaFile() + '.doc'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  };

  // ================= data
  const P = t=>A.ctx.rows(t).filter(r=>t!=='lahan_harian'||(!r.diganti_aktual&&!String(r.source_key||'').startsWith('baseline:'))), c = {rows:P}, { a, b } = PR, s1 = b < hariIni ? b : hariIni; // hasil dinilai s/d hari ini
  const jalan = a <= hariIni && hariIni <= b, belumMulai = a > hariIni;
  const R = statusRencana(c), T = targetPeriode(c, R, a, b, hariIni), TN = targetPeriode(c, R, PR.next.a, PR.next.b, hariIni);
  const TB = R.length ? tanamPerBulan(c, R, hariIni) : [];
  const tt = pisangTertanam(c), lb = new Map(P('lahan_blok').map((x) => [key(x.blok), x]));
  const tgB = [...new Map(P('lahan_target').filter((t) => lb.has(key(t.blok))).map((t) => [key(t.blok), lb.get(key(t.blok))])).values()];
  const totTarget = sum(tgB, (x) => x.luas_ha), totSudah = sum(tgB.filter((x) => tt.has(key(x.blok))), (x) => x.luas_ha);
  const blokPis = new Set(P('lahan_blok').filter((x) => (x.peruntukan || 'Pisang') === 'Pisang').map((x) => key(x.blok)));
  const tanamHa = (p, q) => sum(P('lahan_harian').filter((r) => r.aktivitas === 'Tanam' && blokPis.has(key(r.blok)) && inP(r.tanggal, p, q)), (r) => r.hasil_ha);
  const box = (p, q) => P('pisang_box').filter((r) => inP(r.tanggal, p, q));
  const boxN = (xs) => sum(xs, (r) => r.jumlah_box);
  const BX = box(a, b), BXp = box(PR.prev.a, PR.prev.b);
  const padiPanen = (p, q) => P('padi_panen').filter((r) => inP(r.tanggal, p, q));
  const jualP = (p, q) => P('pisang_penjualan').filter((r) => inP(r.tanggal, p, q));
  const jualB = (p, q) => P('padi_penjualan').filter((r) => inP(r.tanggal, p, q));
  const rpPis = (xs) => sum(xs.filter(isJual), nominalJual), rpBer = (xs) => sum(xs.filter(isJual), nomBeras);
  const akhir = (t, kol = 'tanggal') => P(t).map((r) => r[kol]).filter(Boolean).sort().pop();
  const chg = (x, y) => (!y ? '' : Math.abs(x - y) / y < 0.005 ? '(sama)' : `(${x > y ? '▲' : '▼'} ${f0(Math.abs(x - y) / y * 100)}%)`);
  // periode berjalan dinilai terhadap target s/d kemarin (sama dengan /kebun); periode yang sudah lewat terhadap target penuh
  const kemarin = util.addDays(hariIni, -1), TS = new Map(jalan && kemarin >= a ? targetPeriode(c, R, a, kemarin, hariIni).map((x) => [x.a, x.target]) : []);
  const tSd = (t) => (TS.get(t.a) || 0) + t.tunggak;
  const status = (t) => {
    if (belumMulai) return 'Belum mulai';
    if (jalan) { const sd = tSd(t); return t.target <= 0.005 && sd <= 0.005 ? 'Di luar rencana' : t.selesai >= sd - 0.005 ? 'Sesuai jadwal' : 'Tertinggal'; }
    return t.target <= 0.005 ? 'Di luar rencana' : t.selesai >= t.target * 0.98 ? 'Tercapai' : t.selesai > 0.005 ? 'Sebagian' : 'Belum';
  };
  const stCls = { Tercapai: 'ok', 'Sesuai jadwal': 'ok', Sebagian: 'wait', Belum: 'no', Tertinggal: 'no', 'Belum mulai': 'wait', 'Di luar rencana': 'ok' };
  const stTxt = (t, s) => (s === 'Tertinggal' ? `Tertinggal ${f2(tSd(t) - t.selesai)} ha` : s);
  const HW = P('lahan_harian').filter((r) => inP(r.tanggal, a, s1)), kerja = new Map();
  for (const r of HW) { const x = kerja.get(r.aktivitas) || { ha: 0, bl: new Set() }; x.ha += n(r.hasil_ha); x.bl.add(r.blok); kerja.set(r.aktivitas, x); }
  const tile = (l, v, nt) => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div>${nt ? `<div class="note">${nt}</div>` : ''}</div>`;
  // PDF: judul kolom di <thead> (diulang tiap halaman); tabel pendek tidak dipotong antar halaman, tabel panjang boleh berlanjut
  const tabel = (head, rows, kanan = []) => `<table class="mini lp-t${rows.length > 18 ? ' panjang' : ''}"><thead><tr>${head.map((h, i) => `<th class="${kanan.includes(i) ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td class="${kanan.includes(i) ? 'num' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const kosong = (t) => `<p class="small muted">${t}</p>`;

  const hAkhir = akhir('lahan_harian'), bAkhir = akhir('pisang_box');
  // Land Clearing (buka lahan) dikerjakan Divisi Infrastruktur; kegiatan lain Divisi Pisang
  const isLC = (x) => /^(?:land\s*clearing|lc)$/i.test(typeof x === 'string' ? x : x.a);
  const TP = T.filter((t) => !isLC(t)), TI = T.filter(isLC);
  const tabelTarget = (L, kerjaL) => L.length ? tabel(['Kegiatan', 'Blok target', 'Target periode (ha)', ...(jalan ? ['Target s/d kemarin'] : []), 'Hasil (ha)', 'Blok dikerjakan'], // tanpa kolom status (permintaan user)
      L.map((t) => [esc(t.a), esc(t.bl.map((x) => x.blok).join(', ') || '–'), f2(t.target) + (t.tunggak > 0.005 ? `<div class="small muted">termasuk tunggakan ${f2(t.tunggak)}</div>` : ''), ...(jalan ? [f2(tSd(t))] : []), belumMulai ? '–' : f2(t.selesai), esc(t.blokKerja.join(', ') || '–')]), jalan ? [2, 3, 4] : [2, 3])
    : kerjaL.length ? tabel(['Kegiatan', 'Hasil (ha)', 'Blok dikerjakan'], kerjaL.map(([k, x]) => [esc(k), f2(x.ha), esc([...x.bl].join(', '))]), [1]) + kosong('Belum ada Rencana Kerja untuk periode ini — ditampilkan pekerjaan yang tercatat di Progres Harian.')
    : kosong(R.length ? 'Tidak ada target maupun pekerjaan di periode ini.' : 'Rencana Kerja belum disusun.');
  const catTarget = `Target dari Rencana Kerja (bagian rencana di periode ini${jalan ? ' + tunggakan sebelumnya' : ''}); hasil dari Progres Harian${jalan ? ' s/d hari ini. Periode masih berjalan: "Target s/d kemarin" = bagian target yang semestinya sudah dikerjakan sampai kemarin' : ''}.${hAkhir ? ` Progres harian terakhir: ${tgl(hAkhir)}.` : ''}`;

  // ---------- padi
  const kondisi = (p) => (p.keterangan && /Status di peta[^:]*:\s*(.+)$/.exec(p.keterangan)?.[1].trim()) || p.status || '–';
  const petak = P('padi_petak'), grpPetak = new Map();
  for (const p of petak) { const k = kondisi(p); if (!grpPetak.has(k)) grpPetak.set(k, []); grpPetak.get(k).push(p); }
  const tengah = (r) => { const x = util.d(r.mulai), y = util.d(r.selesai || r.mulai); return x && y ? iso(new Date((x.getTime() + y.getTime()) / 2)) : r.mulai; };
  const RPadi = (p, q) => P('padi_rencana').filter((r) => inP(tengah(r), p, q)), RPi = [], RPn = [];
  const qty = (v, sat) => (v == null || v === '' ? '–' : `${fmtNum(v, sat === 'kg' ? 0 : 2)} ${esc(sat || 'ha')}`);
  const catPadi = (rs) => rs.filter((r) => /^catatan$/i.test(r.pekerjaan || '')), kerjaPadi = (rs) => rs.filter((r) => !/^catatan$/i.test(r.pekerjaan || ''));
  const PP = padiPanen(a, b), GL = P('padi_giling').filter((r) => inP(r.tanggal, a, b)), KG = P('padi_kegiatan').filter((r) => inP(r.tanggal, a, b));
  const kegPadi = new Map(); for (const r of KG) { const x = kegPadi.get(r.kegiatan) || { hk: 0, n: 0 }; x.hk += n(r.hk); x.n++; kegPadi.set(r.kegiatan, x); }
  // ---------- infra
  const proyek = P('infra_proyek'), progInfra = P('infra_progress').filter((r) => inP(r.tanggal, a, b));
  const fProg = TABLES.infra_proyek.f.find((x) => x.k === 'progres'), pf = (r) => { try { return fProg.fn(r, c); } catch { return null; } }; // sama dengan kolom Progres di tabel proyek
  // ---------- cuaca
  // iklim: hujan per hari = nilai kumulatif harian tertinggi (iklimHarian), BUKAN dijumlah per jam
  const IK = iklimHarian(P('iklim').filter((x) => inP(x.tanggal, a, b))), ikT = IK.filter((d) => d.tavg != null), ikH = IK.filter((d) => d.havg != null);
  const hrHujan = IK.filter((d) => n(d.hujan) >= HARI_HUJAN_MM), maxH = [...IK].sort((x, y) => n(y.hujan) - n(x.hujan))[0];
  // padi: progres persiapan petak (Rencana Blok peruntukan Padi, dari Progres Harian)
  const blokPadi = P('lahan_blok').filter((x) => x.peruntukan === 'Padi'), aktPadi = aktivitasUntuk(c, 'Padi');
  const progPadi = aktPadi.map((ak) => { let done = 0; for (const x of blokPadi) done += n(x.luas_ha) * (lahanProgress(x, c).per.find((p) => p.akt === ak.aktivitas)?.pct || 0); return { akt: ak.aktivitas, done, tot: sum(blokPadi, (x) => x.luas_ha) }; });
  const padiTanam = petak.filter((p) => p.status === 'Sudah Tanam');
  // GIS: blok tertanam (sama dengan halaman Ringkasan)
  const pisT = tanamRows(A, 'Pisang'), baruT = pisT.filter((x) => inP(x.tgl, a, b)).sort((x, y) => String(x.tgl).localeCompare(String(y.tgl)));
  const pokokT = sum(pisT, (x) => x.pokok), popT = sum(pisT, (x) => x.pop), nettoT = sum(pisT, (x) => x.luas);
  const lbPis = P('lahan_blok').filter((x) => (x.peruntukan || 'Pisang') === 'Pisang');
  // ---------- penjualan (ringkas)
  const JP = jualP(a, b), JPp = jualP(PR.prev.a, PR.prev.b), JB = jualB(a, b), JBp = jualB(PR.prev.a, PR.prev.b);

  const kelas = new Map(); for (const r of BX) { const k = `${({ Single: 'SL', Cluster: 'CL', Hand: 'FH' })[r.bentuk] || r.bentuk || ''} ${r.kelas || ''}`.trim(); kelas.set(k, (kelas.get(k) || 0) + n(r.jumlah_box)); }
  const urutK = [...kelas].sort((x, y) => x[0].localeCompare(y[0]));
    const nomor = (() => { let i = 0; return () => ++i; })();

  $('#lp', main).innerHTML = `
    <div class="lp-head"><div class="lp-co">${esc(A.settings().nama || 'PT VIGU FARM INDONESIA')}</div>
      <div class="lp-jd">${esc(PR.judul)}</div>
      <div class="lp-pr">${esc(PR.rentang)}${jalan ? ` · data s/d ${tgl(hariIni)}` : ''} · Divisi Pisang, Padi &amp; Infrastruktur</div></div>

    <h2 class="o-h">${nomor()}. Ringkasan</h2>
    <div class="kpis">
      ${tile('Buka lahan (land clearing)', `${f2(kerja.get('Land Clearing')?.ha || 0)} <small>ha</small>`, `${PR.lalu}: ${f2(sum(P('lahan_harian').filter((r) => isLC(r.aktivitas || '') && inP(r.tanggal, PR.prev.a, PR.prev.b)), (r) => r.hasil_ha))} ha · Divisi Infrastruktur`)}
      ${tile('Tanam pisang', `${f2(tanamHa(a, s1))} <small>ha</small>`, `${PR.lalu}: ${f2(tanamHa(PR.prev.a, PR.prev.b))} ha`)}
      ${tile('Kebun pisang tertanam', `${f2(totSudah)} <small>ha</small>`, `dari ${f2(totTarget)} ha rencana (${totTarget ? f0(totSudah / totTarget * 100) : 0}%)`)}
      ${tile('Panen pisang', `${f0(boxN(BX))} <small>box</small>`, `${PR.lalu}: ${f0(boxN(BXp))} box ${chg(boxN(BX), boxN(BXp))}`)}
      ${tile('Panen padi', PP.length ? `${f0(sum(PP, (r) => r.gkp_kg))} <small>kg GKP</small>` : '–', PP.length ? `${PP.length} petak` : 'tidak ada panen padi tercatat')}
    </div>


    <h2 class="o-h">${nomor()}. Divisi Pisang</h2>
    <div class="card o-card"><h3>Persiapan lahan &amp; tanam (bajak s/d tanam) — target vs hasil</h3>
      ${tabelTarget(TP, [...kerja].filter(([k]) => !isLC(k)))}
      <p class="small muted" style="margin:6px 0 0">${catTarget}</p></div>
    ${TB.length ? `<div class="card o-card"><h3>Rencana vs realisasi tanam per bulan (luasan)</h3>
      ${tabel(['Bulan', 'Rencana (ha)', 'Aktual (ha)', 'Kumulatif aktual / rencana (ha)'], TB.map((x) => [`${BULAN[+x.bulan.slice(5) - 1]} ${x.bulan.slice(0, 4)}`, f2(x.rencana), x.status === 'belum' ? '–' : f2(x.aktual), `${f2(x.kumAktual)} / ${f2(x.kumRencana)}`]), [1, 2])}
      <p class="small muted" style="margin:6px 0 0">Kebun tertanam ${f2(totSudah)} dari ${f2(totTarget)} ha. Tanam di blok mana pun dihitung di bulan tanamnya.</p></div>` : ''}
    <div class="card o-card"><h3>Panen pisang</h3>
      ${BX.length ? tabel(['Kelas', ...urutK.map((x) => esc(x[0])), 'Total'], [['Box', ...urutK.map((x) => f0(x[1])), `<b>${f0(boxN(BX))}</b>`]], urutK.map((_, i) => i + 1).concat(urutK.length + 1))
        + `<p class="small muted" style="margin:6px 0 0">Berat ± ${f0(sum(BX, (r) => r.berat_kg))} kg · ${new Set(BX.map((r) => r.tanggal)).size} hari panen (${[...new Set(BX.map((r) => r.tanggal))].sort().map(tglPendek).join(', ')}) · ${PR.lalu} ${f0(boxN(BXp))} box.</p>`
        : kosong(`Tidak ada panen pisang tercatat di periode ini${bAkhir ? ` (terakhir ${tgl(bAkhir)})` : ''}.`)}</div>

    <h2 class="o-h">${nomor()}. Divisi Padi</h2>
    <div class="kpis">
      ${tile('Padi tertanam', `${f2(sum(padiTanam, (p) => p.luas_ha))} <small>ha</small>`, `${padiTanam.length} dari ${petak.length} petak (${f2(sum(petak, (p) => p.luas_ha))} ha)`)}
      ${tile('Panen padi di periode ini', PP.length ? `${f0(sum(PP, (r) => r.gkp_kg))} <small>kg GKP</small>` : '–', PP.length ? `${PP.length} petak` : 'tidak ada panen tercatat')}
      ${tile('Hasil panen sebelumnya', `${f0(sum(P('padi_panen'), (r) => r.gkp_kg))} <small>kg GKP</small>`, `${new Set(P('padi_panen').map((r) => key(r.petak))).size} petak · ${f0(sum(P('padi_panen'), (r) => r.jumlah_karung))} karung`)}
      ${tile('Beras masuk gudang', `${f0(sum(P('padi_giling'), (r) => r.beras_kg))} <small>kg</small>`, `${P('padi_giling').length} kali giling (total)`)}
    </div>
    <div class="card o-card"><h3>Kondisi petak</h3>
      ${petak.length ? tabel(['Kondisi', 'Petak', 'Jumlah', 'Luas (ha)'], [...grpPetak].map(([k, xs]) => [esc(k), esc(xs.map((p) => p.nama_petak).sort().join(', ')), String(xs.length), f2(sum(xs, (p) => p.luas_ha))]), [2, 3]) : kosong('Belum ada data petak.')}</div>
    ${blokPadi.length && aktPadi.length ? `<div class="card o-card"><h3>Progres persiapan petak (olah tanah s/d tanam)</h3>
      ${tabel(['Tahap', 'Selesai (ha)', 'Dari (ha)', '%'], progPadi.map((x) => [esc(x.akt), f2(x.done), f2(x.tot), f0(x.tot ? x.done / x.tot * 100 : 0) + '%']), [1, 2, 3])}
      <p class="small muted" style="margin:6px 0 0">Dari Progres Harian blok peruntukan Padi (${blokPadi.length} petak); petak yang sudah tanam sebelum pencatatan dihitung selesai.</p></div>` : ''}
    <div class="card o-card"><h3>Panen, giling &amp; kegiatan di periode ini</h3>
      ${PP.length ? tabel(['Tanggal', 'Petak', 'GKP (kg)', 'Karung'], PP.map((r) => [tgl(r.tanggal), esc(r.petak || '–'), f0(r.gkp_kg), f0(r.jumlah_karung)]), [2, 3]) : kosong('Tidak ada panen padi tercatat di periode ini.')}
      ${GL.length ? tabel(['Tanggal', 'Gudang', 'Beras (kg)'], GL.map((r) => [tgl(r.tanggal), esc(r.gudang || '–'), f0(r.beras_kg)]), [2]) : ''}
      ${kegPadi.size ? tabel(['Kegiatan', 'Catatan', 'HK'], [...kegPadi].map(([k, x]) => [esc(k), String(x.n), fmtNum(x.hk, 1)]), [1, 2]) : kosong('Belum ada kegiatan budidaya padi yang diinput di periode ini (menu Padi → Kegiatan Budidaya).')}</div>

    <h2 class="o-h">${nomor()}. Divisi Infrastruktur</h2>
    <div class="card o-card"><h3>Buka lahan (land clearing) — target vs hasil</h3>
      <div class="kpis">${tile('LC periode ini',f2(sum(HW.filter(r=>isLC(r.aktivitas)),r=>r.hasil_ha))+' ha',a+' s.d. '+s1)}${tile('LC kumulatif',f2(sum(A.ctx.rows('lahan_harian').filter(r=>!r.diganti_aktual&&isLC(r.aktivitas)&&r.tanggal<=s1),r=>r.hasil_ha))+' ha','Termasuk saldo pekerjaan selesai sebelum Oktober')}</div>${tabelTarget(TI, [...kerja].filter(([k]) => isLC(k)))}
      <p class="small muted" style="margin:6px 0 0">${catTarget}</p></div>
    <div class="card o-card"><h3>Jaringan jalan (dari peta GIS)</h3><div id="lpJalan">${kosong('Memuat peta…')}</div></div>
    <div class="card o-card"><h3>Proyek infrastruktur</h3>${proyek.length ? tabel(['Proyek', 'Jenis', 'Lokasi', 'Status', 'Progres', 'Target selesai'], proyek.map((r) => { const p = pf(r); return [esc(r.nama_proyek), esc(r.jenis || '–'), esc(r.lokasi || '–'), esc(r.status || '–'), p == null ? '–' : f0(p * 100) + '%', r.target_selesai ? tgl(r.target_selesai) : '–']; }), [4])
        + (progInfra.length ? `<p class="small" style="margin:6px 0 0">Progres dicatat di periode ini: ${progInfra.length} catatan (${[...new Set(progInfra.map((r) => r.proyek))].map(esc).join(', ')}).</p>` : kosong('Tidak ada catatan progres proyek di periode ini.'))
        : kosong('Belum ada proyek infrastruktur yang dicatat di aplikasi (menu Infra &amp; Pembukaan Lahan → Proyek Infrastruktur).')}</div>

    <h2 class="o-h">${nomor()}. GIS — Data Blok &amp; Peta</h2>
    <div class="kpis">
      ${tile('Pisang tertanam (netto)', `${f2(nettoT)} <small>ha</small>`, `${pisT.length} blok · luas peta (gross) ${f2(sum(pisT, (x) => x.gross))} ha`)}
      ${tile('Pokok tanam', `${f0(pokokT)} <small>pkk</small>`, `hidup ${f0(popT)} pkk (setelah kehilangan &amp; sulam) · ${nettoT ? f0(pokokT / nettoT) : '–'} pkk/ha`)}
      ${tile('Luas blok kebun', `${f2(sum(lbPis, (x) => x.luas_ha) + sum(petak, (p) => p.luas_ha))} <small>ha</small>`, `pisang ${f2(sum(lbPis, (x) => x.luas_ha))} ha (${lbPis.length} blok) · padi ${f2(sum(petak, (p) => p.luas_ha))} ha (${petak.length} petak)`)}
      <div id="lpST" style="display:contents"></div>
    </div>
    <div class="card o-card"><h3>Blok pisang tertanam di periode ini</h3>
      ${baruT.length ? tabel(['Blok', 'Tanggal tanam', 'Luas netto (ha)', 'Luas peta (ha)', 'Pokok tanam', 'pkk/ha'], baruT.map((x) => [esc(x.blok), tgl(x.tgl), f2(x.luas), x.gross != null ? f2(x.gross) : '–', x.pokok != null ? f0(x.pokok) : '<span class="small muted">belum diisi</span>', x.pokok && x.luas ? f0(x.pokok / x.luas) : '–']), [2, 3, 4, 5])
        : kosong('Tidak ada blok baru tertanam di periode ini.')}</div>
    <div class="card o-card"><h3>Lampiran — perubahan &amp; penambahan blok di periode ini</h3><div id="lpLog">${kosong('Memuat riwayat…')}</div></div>

    <h2 class="o-h">${nomor()}. Iklim</h2>
    <div class="card o-card">${IK.length ? `<div class="kpis" style="margin-bottom:8px">
        ${tile('Curah hujan', `${fmtNum(sum(IK, (d) => d.hujan), 1)} <small>mm</small>`, `${hrHujan.length} hari hujan dari ${IK.length} hari tercatat`)}
        ${tile('Suhu rata-rata', ikT.length ? `${fmtNum(sum(ikT, (d) => d.tavg) / ikT.length, 1)} <small>°C</small>` : '–', ikT.length ? `min ${fmtNum(Math.min(...ikT.map((d) => d.tmin)), 1)} · maks ${fmtNum(Math.max(...ikT.map((d) => d.tmax)), 1)} °C` : '')}
        ${tile('Kelembapan rata-rata', ikH.length ? `${f0(sum(ikH, (d) => d.havg) / ikH.length)} <small>%</small>` : '–', maxH && n(maxH.hujan) >= HARI_HUJAN_MM ? `hujan terbanyak ${tgl(maxH.tanggal)} (${fmtNum(maxH.hujan, 1)} mm)` : 'tidak ada hari hujan')}
      </div>
      ${tabel(['Tanggal', 'Hujan (mm)', 'Suhu min–maks (°C)', 'Kelembapan (%)', 'Angin maks (m/s)'], IK.map((d) => [tgl(d.tanggal), d.hujan == null ? '–' : fmtNum(d.hujan, 1), d.tmin == null ? '–' : `${fmtNum(d.tmin, 1)}–${fmtNum(d.tmax, 1)}`, d.havg == null ? '–' : f0(d.havg), d.wmax == null ? '–' : `${fmtNum(d.wmax, 1)}${d.wmaxArah ? ' ' + esc(d.wmaxArah) : ''}`]), [1, 3, 4])}
      <p class="small muted" style="margin:6px 0 0">Dari stasiun cuaca kebun. Hujan = total harian (hari hujan ≥ ${HARI_HUJAN_MM} mm).${akhir('iklim') < s1 ? ` Data terakhir ${tgl(akhir('iklim'))}.` : ''}</p>`
      : kosong(`Belum ada data iklim di periode ini${akhir('iklim') ? ` (data terakhir ${tgl(akhir('iklim'))})` : ''}.`)}</div>

    <h2 class="o-h">${nomor()}. Penjualan (ringkas)</h2>
    <div class="card o-card">${tabel(['Komoditas', 'Nilai penjualan', 'Jumlah', PR.lalu[0].toUpperCase() + PR.lalu.slice(1)],
      [['Pisang', rp(rpPis(JP)), `${f0(sum(JP.filter((r) => r.tipe === 'Penjualan'), (r) => r.jumlah_box))} box`, rp(rpPis(JPp))],
       ['Beras', rp(rpBer(JB)), `${fmtNum(sum(JB.filter((r) => r.tipe === 'Penjualan'), (r) => r.berat_kg), 1)} kg`, rp(rpBer(JBp))]], [1, 2, 3])}
      <p class="small muted" style="margin:6px 0 0">Nilai bersih setelah retur, tidak termasuk ongkir &amp; mutasi internal. Rincian ada di menu Penjualan (marketing).</p></div>

    <h2 class="o-h">${nomor()}. Rencana ${PR.depan} (${esc(PR.next.label)})</h2>
    ${(() => { // pisang & infrastruktur dari Rencana Kerja; padi dari Rencana Kerja Mingguan Padi (dijumlah per aktivitas)
      const gp = new Map(); for (const r of kerjaPadi(RPn)) { const k = (r.aktivitas || '–') + '|' + (r.satuan || 'ha'); const g = gp.get(k) || { akt: r.aktivitas || '–', sat: r.satuan || 'ha', tot: 0, bl: [] }; g.tot += n(r.rencana); if (r.petak) g.bl.push(`${r.petak}${r.rencana != null && r.rencana !== '' ? ' ' + fmtNum(r.rencana, g.sat === 'kg' ? 0 : 2) + (g.sat === 'kg' ? ' kg' : '') : ''}`); gp.set(k, g); }
      const baris = [...[...TN.filter(isLC), ...TN.filter((t) => !isLC(t))].map((t) => [isLC(t) ? 'Infrastruktur' : 'Pisang', esc(t.a), `${f2(t.target)} ha`, esc(t.bl.map((x) => `${x.blok} ${f2(x.ha)}`).join(', '))]),
        ...[...gp.values()].map((g) => ['Padi', esc(g.akt), qty(g.tot, g.sat), esc(g.bl.join(', ') || '–')])];
      return `<div class="card o-card">${baris.length ? tabel(['Divisi', 'Kegiatan', 'Target', 'Blok / petak'], baris, [2]) : kosong('Tidak ada rencana kegiatan di periode berikutnya.')}
        ${(() => { const sdh = new Set(catPadi(RPi).map((r) => r.keterangan)), baru = catPadi(RPn).filter((r) => !sdh.has(r.keterangan)); return baru.length ? `<p class="small muted" style="margin:6px 0 0">Catatan padi: ${baru.map((r) => esc(r.keterangan || r.aktivitas)).join(' · ')}</p>` : ''; })()}</div>`; })()}

    <p class="small muted lp-foot">Dibuat otomatis ${tgl(hariIni)} dari aplikasi Monitoring Kebun. Data terakhir — progres harian: ${tgl(hAkhir)}, panen pisang: ${tgl(bAkhir)}, iklim: ${tgl(akhir('iklim'))}.</p>`;

  // ---------- dimuat belakangan: peta GIS (jalan, serah terima, tanggal update layer) & riwayat perubahan (admin)
  (async () => {
    let layers = []; try { layers = await A.gisLayers(); } catch {}
    const el = $('#lpJalan', main); if (!el) return;
    // panjang = atribut Length di peta (meter; jalan digambar sebagai poligon), selain itu dihitung dari garis
    const km = (FT) => fmtNum(sum(FT, (f) => (Number(f.properties?.Length) > 0 ? Number(f.properties.Length) : panjangM(f.geometry))) / 1000, 2);
    const jalan = layers.filter((l) => /jalan/i.test(`${l.jenis} ${l.nama}`)).map((l) => { let FT = []; try { FT = JSON.parse(l.geojson).features || []; } catch {} return { nama: l.nama, FT, upd: l.updated_at }; });
    el.innerHTML = !jalan.length ? kosong('Belum ada layer jalan di peta GIS.') : jalan.map((j) => {
      const P0 = (f) => f.properties || {}, sudah = (f) => /sudah/i.test(P0(f).Status || ''), belum = (f) => /belum/i.test(P0(f).Status || '');
      let isi;
      if (j.FT.some((f) => sudah(f) || belum(f))) { // jalan kebun: progres per jenis jalan
        const jenis = [...new Set(j.FT.map((f) => P0(f).Jenis_Jala || 'Lainnya'))].sort((x, y) => ['Utama', 'Koleksi', 'Panen', 'Bantu'].indexOf(x) - ['Utama', 'Koleksi', 'Panen', 'Bantu'].indexOf(y));
        const baris = (FT, lbl) => [lbl, km(FT), km(FT.filter((f) => sudah(f) && !/timbun/i.test(P0(f).Status2 || ''))), km(FT.filter((f) => sudah(f) && /timbun/i.test(P0(f).Status2 || ''))), km(FT.filter(belum))];
        isi = tabel(['Jenis jalan', 'Total (km)', 'Sudah dibuka (km)', 'Sudah timbun padat (km)', 'Belum dikerjakan (km)'],
          [...jenis.map((x) => baris(j.FT.filter((f) => (P0(f).Jenis_Jala || 'Lainnya') === x), esc(x))), baris(j.FT, '<b>Total</b>')], [1, 2, 3, 4]);
      } else { // jalan akses: per kondisi (lebar / timbun)
        const kond = [...new Set(j.FT.map((f) => P0(f).Status || '–'))].filter((x) => x !== '–' || j.FT.some((f) => !P0(f).Status && Number(P0(f).Length) > 0));
        isi = tabel(['Kondisi', 'Panjang (km)'], [...kond.map((x) => { const FT = j.FT.filter((f) => (P0(f).Status || '–') === x); return [esc(x), km(FT)]; }), ['<b>Total</b>', km(j.FT)]], [1]);
      }
      return `<div class="lp-utuh" style="margin-bottom:8px"><b>${esc(j.nama)}</b> <span class="small muted">· peta diperbarui ${tgl(tglLokal(j.upd))}</span>${isi}</div>`;
    }).join('');
    const st = serahTerima(await loadGis(A));
    if (st && $('#lpST', main)) $('#lpST', main).outerHTML = tile('Lahan sudah serah terima', `${f2(st.haS)} <small>ha</small>`, `${st.sudah.length} persil${st.belum.length ? ` · belum serah terima ${f2(st.haB)} ha` : ''}`);
    // lampiran GIS: perubahan / penambahan blok di periode ini (riwayat "perubahan blok" dari server: nilai lama → baru)
    const NAMA = { pisang_blok: 'Blok Tanam', lahan_blok: 'Rencana Blok', padi_petak: 'Petak Padi', gis_layer: 'Peta Blok Tanam' };
    const LBL = { luas_ha: 'luas', pokok_tanam: 'pokok tanam', tanggal_tanam: 'tgl tanam', status: 'status', kehilangan: 'kehilangan', sulam: 'sulam', peruntukan: 'peruntukan', tahap: 'tahap', lahan: 'lahan' };
    const nilai = (f, v) => (v == null || v === '' ? '–' : f === 'luas_ha' ? fmtNum(v, 4) + ' ha' : f === 'tanggal_tanam' ? tgl(v) : ['pokok_tanam', 'kehilangan', 'sulam'].includes(f) ? f0(v) + ' pkk' : esc(String(v)));
    const rinci = (u) => Object.entries(u || {}).map(([f, [l, x]]) => `${LBL[f] || f} ${nilai(f, l)} → <b>${nilai(f, x)}</b>`).join('; ');
    const JENIS = { tambah: 'Blok baru', hapus: 'Blok dihapus', 'ganti nama': 'Ganti nama', ubah: 'Diubah' };
    let log = []; try { log = await A.api.get('/api/log?limit=2000'); } catch {}
    const rows = [], mulaiRinci = Math.min(Infinity, ...log.filter((x) => x.aksi === 'perubahan blok').map((x) => x.id));
    for (const r of log.filter((x) => NAMA[x.tabel] && inP(tglLokal(x.ts), a, b))) {
      let d = {}; try { d = JSON.parse(r.data || '{}'); } catch {}
      const t = tglLokal(r.ts), dt = NAMA[r.tabel] + (r.tabel === 'gis_layer' && d.layer ? ` (${esc(d.layer)})` : '');
      if (r.aksi === 'perubahan blok') {
        rows.push({ id: r.id, t, dt, blok: d.blok, j: JENIS[d.jenis] || d.jenis, r: d.jenis === 'ganti nama' ? `dari <b>${esc(d.lama)}</b>${Object.keys(d.ubah || {}).length ? '; ' + rinci(d.ubah) : ''}` : d.jenis === 'ubah' ? rinci(d.ubah) : Object.entries(d.nilai || {}).map(([f, v]) => `${LBL[f] || f} ${nilai(f, v)}`).join('; ') });
        continue;
      }
      // catatan lama (sebelum riwayat rinci aktif): perubahan luas & blok dihapus yang tercatat — tidak dobel dengan catatan rinci
      if (r.id > mulaiRinci) continue;
      if (Array.isArray(d.luas_diperbarui)) for (const x of d.luas_diperbarui) { const m = /^(\S+)\s+([\d.]+)\s*→\s*([\d.]+)/.exec(String(x)); if (m && Math.abs(m[2] - m[3]) > 1e-6) rows.push({ id: r.id, t, dt, blok: m[1], j: 'Diubah', r: `luas ${nilai('luas_ha', m[2])} → <b>${nilai('luas_ha', m[3])}</b>` }); }
      else if (typeof d.blok === 'string' && typeof d.luas_ha === 'string' && d.luas_ha.includes('→')) { const [l, x] = d.luas_ha.split('→').map((v) => v.trim()); if (Math.abs(l - x) > 1e-6) rows.push({ id: r.id, t, dt, blok: d.blok, j: 'Diubah', r: `luas ${nilai('luas_ha', l)} → <b>${nilai('luas_ha', x)}</b>` }); }
      else if (r.aksi === 'hapus' && (d.blok || d.nama_blok || d.nama_petak)) rows.push({ id: r.id, t, dt, blok: d.blok || d.nama_blok || d.nama_petak, j: 'Blok dihapus', r: d.luas_ha != null ? `luas ${nilai('luas_ha', d.luas_ha)}` : '–' });
    }
    rows.sort((x, y) => x.t.localeCompare(y.t) || x.dt.localeCompare(y.dt) || x.id - y.id); // per hari: urutan kejadian
    const lg = $('#lpLog', main); if (!lg) return;
    const hit = (j) => rows.filter((x) => x.j === j).length;
    lg.innerHTML = (rows.length ? `<p style="margin:0 0 6px">${['Blok baru', 'Ganti nama', 'Diubah', 'Blok dihapus'].filter(hit).map((j) => `<b>${hit(j)}</b> ${j.toLowerCase()}`).join(' · ')}</p>`
        + tabel(['Tanggal', 'Data', 'Blok', 'Perubahan', 'Rincian (lama → baru)'], rows.map((x) => [tgl(x.t), x.dt, esc(x.blok || '–'), x.j, x.r || '–']))
      : kosong('Tidak ada perubahan, penambahan, atau ganti nama blok di periode ini.'))
      + `<p class="small muted" style="margin:6px 0 0">Layer peta: ${layers.map((l) => `${esc(l.nama)} (diperbarui ${tgl(tglLokal(l.updated_at))})`).join(' · ') || '–'}.</p>`;
  })();
}
