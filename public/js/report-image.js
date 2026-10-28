// Daily Report sebagai GAMBAR untuk dibagikan mandor ke WhatsApp (foto langsung terlihat di chat, tidak perlu buka PDF).
// Isi sama dengan PDF Daily Report: blok, kegiatan, HI, SDHI minggu, HK aktual, target minggu, kendala, tindak lanjut, foto.
// dailyImageLayout() murni (tanpa canvas, bisa diuji di Node); dailyReportImages() menggambar di canvas browser.
export const IMG = { W: 1080, PAD: 44, MAXH: 1900, HEAD1: 196, HEAD2: 92, FOOT: 66, LINE: 33 };
const C = { green: '#24563D', muted: '#6A786E', ink: '#24352A', line: '#E3E9DF', head: '#EDF3EA', Pisang: '#FFF8CC', Padi: '#EAF5E5', Infra: '#EEF1F6', done: '#DCFCE7', doneInk: '#166534', draft: '#FEF3C7', draftInk: '#92400E' };
const FONT = '"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
export const F = { cell: `25px ${FONT}`, cellB: `bold 23px ${FONT}`, title: `bold 30px ${FONT}`, chip: `bold 22px ${FONT}`, label: `bold 25px ${FONT}`, text: `25px ${FONT}`, cap: `21px ${FONT}` };
const PHOTOS_PER_REPORT = 4, MAX_REPORTS = 6;
export const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 }));
const tglPanjang = (v) => (v ? new Date(v + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '-');
const tglPendek = (v) => (v ? new Date(v + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
export const periodeLabel = (from, to) => (from && from === to ? tglPanjang(from) : `${tglPendek(from)} – ${tglPendek(to)}`);

// baris tabel: urutan & isi kolom sama dengan PDF Daily Report
export const COLS = [['Blok', 65], ['Kegiatan', 135], ['HI', 83], ['SDHI minggu', 83], ['HK', 49], ['Target minggu', 83]];
// semua isian mandor per kegiatan ikut: alat, meter HM/KM, ritase, keterangan, tanda di luar rencana, HK rencana
const isi = (v) => v != null && v !== '';
export const rowCells = (x) => [x.blok || '-', [x.aktivitas, x.alat, isi(x.meter_awal) && isi(x.meter_akhir) ? 'Meter ' + num(x.meter_awal) + ' - ' + num(x.meter_akhir) : null, isi(x.ritase) ? 'Ritase ' + num(x.ritase) : null,
    x.di_luar_rencana && x.di_luar_rencana !== '0' && x.di_luar_rencana !== 'Tidak' ? '(di luar rencana)' : null, isi(x.keterangan) ? 'Ket: ' + x.keterangan : null].filter(Boolean).join('\n') || '-',
  x.realisasi == null ? '-' : num(x.realisasi) + ' ' + (x.satuan || ''), x.hasil_sdhi == null ? '-' : num(x.hasil_sdhi) + ' ' + (x.satuan || ''), num(x.hk_realisasi) + (isi(x.hk_rencana) ? '\nrnc ' + num(x.hk_rencana) : ''),
  x.target != null ? num(x.target) + ' ' + (x.satuan || '') : x.target_hk_minggu != null ? num(x.target_hk_minggu) + ' HK' : '-'].map((v) => String(v).trim());

// keterangan (caption) WhatsApp yang menyertai gambar: ringkas, bisa ditambah mandor sebelum kirim
export function dailyShareText({ reports, from, to, divisi }) {
  const out = [`*DAILY REPORT ${divisi ? divisi.toUpperCase() : 'KEBUN'}* — ${periodeLabel(from, to)}`];
  for (const r of reports.slice(0, MAX_REPORTS)) {
    if (reports.length > 1 || !divisi) out.push('', `_${tglPendek(r.tanggal)} · ${r.divisi}_`);
    const items = r.items || [];
    for (const x of items.slice(0, 8)) out.push(`• ${x.blok || '-'} ${x.aktivitas || ''}: ${x.realisasi == null ? 'hasil belum diisi' : num(x.realisasi) + ' ' + (x.satuan || '')}${x.hk_realisasi != null ? ` (HK ${num(x.hk_realisasi)})` : ''}`.replace(/\s+\(/, ' ('));
    if (items.length > 8) out.push(`• dan ${items.length - 8} kegiatan lain (lihat gambar)`);
    if (r.kendala) out.push(`Kendala: ${String(r.kendala).slice(0, 160)}${String(r.kendala).length > 160 ? '…' : ''}`);
  }
  if (reports.length > MAX_REPORTS) out.push('', `Dan ${reports.length - MAX_REPORTS} laporan lain di aplikasi.`);
  return out.join('\n');
}

// keterangan foto dari mandor; nama file kamera (mis. "1000500293.jpg", "IMG_2041.HEIC") tidak ditampilkan
export const keteranganFoto = (p) => [p.caption, p.jenis].map((v) => String(v ?? '').trim()).find((v) => v && !/^[\w\-. ()]+\.(jpe?g|png|webp|heic|heif|gif)$/i.test(v)) || '';

export function wrapText(measure, text, width, font) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + word : word;
      if (measure(t, font) <= width) { line = t; continue; }
      if (line) out.push(line);
      line = '';
      for (const ch of word) { if (line && measure(line + ch, font) > width) { out.push(line); line = ch; } else line += ch; } // kata terlalu panjang dipotong
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

// → { pages: [{ height, ops: [...] }], photos: [photo] } ; ops: rect | text | img | line ; y absolut di halaman
export function dailyImageLayout({ reports, from, to, divisi, name = 'PT VIGU FARM INDONESIA', createdBy = '', dibuat = '', measure }) {
  const { W, PAD, MAXH, HEAD1, HEAD2, FOOT, LINE } = IMG, inner = W - PAD * 2;
  const tot = COLS.reduce((s, c) => s + c[1], 0), widths = COLS.map((c) => (c[1] / tot) * inner);
  const blocks = [], photos = [];
  const tampil = reports.slice(0, MAX_REPORTS);
  for (const r of tampil) {
    const chip = r.status === 'Selesai' ? 'Selesai' : r.status || 'Draft';
    blocks.push({ keep: 2, h: 76, ops: (y) => [{ t: 'rect', x: PAD, y, w: inner, h: 62, fill: C[r.divisi] || C.head, r: 10 }, { t: 'text', x: PAD + 18, y: y + 42, s: `${tglPanjang(r.tanggal)} · ${r.divisi}`, font: F.title, fill: C.green },
      { t: 'chip', x: PAD + inner - 16, y: y + 31, s: chip, font: F.chip, fill: chip === 'Selesai' ? C.done : C.draft, ink: chip === 'Selesai' ? C.doneInk : C.draftInk }] });
    // isian tingkat laporan yang ada di form (opsional, tampil hanya bila diisi): HK tercatat, mandor, catatan tenaga kerja. Jam apel tidak dipakai.
    const info = [isi(r.apel_hadir) ? `HK tercatat: ${num(r.apel_hadir)}` : null, isi(r.dibuat_oleh || r.mandor) ? `Mandor: ${r.dibuat_oleh || r.mandor}` : null, isi(r.siklus) ? `Siklus: ${r.siklus}` : null].filter(Boolean).join(' · ');
    if (info) { const lines = wrapText(measure, info, inner - 20, F.text); blocks.push({ keep: 2, h: lines.length * LINE + 14, ops: (y) => lines.map((s, j) => ({ t: 'text', x: PAD + 10, y: y + 28 + j * LINE, s, font: F.text, fill: C.muted })) }); }
    if (isi(r.apel_catatan)) { const lines = wrapText(measure, r.apel_catatan, inner - 20, F.text); blocks.push({ keep: 2, h: 48 + lines.length * LINE + 10, ops: (y) => [{ t: 'text', x: PAD + 10, y: y + 36, s: 'Catatan tenaga kerja', font: F.label, fill: C.green }, ...lines.map((s, j) => ({ t: 'text', x: PAD + 10, y: y + 74 + j * LINE, s, font: F.text, fill: C.ink }))] }); }
    const hl = COLS.map((c, i) => wrapText(measure, c[0], widths[i] - 16, F.cellB)), hh = Math.max(...hl.map((l) => l.length)) * 28 + 24; // judul kolom boleh 2 baris
    const head = { h: hh + 4, head: true, ops: (y) => [{ t: 'rect', x: PAD, y, w: inner, h: hh, fill: C.head }, ...hl.flatMap((lines, i) => lines.map((s, j) => ({ t: 'text', x: PAD + widths.slice(0, i).reduce((a, v) => a + v, 0) + 10, y: y + 32 + j * 28, s, font: F.cellB, fill: C.green })))] };
    if (r.items?.length) {
      blocks.push({ ...head, keep: 2 });
      for (const x of r.items) {
        const cells = rowCells(x).map((v, i) => wrapText(measure, v, widths[i] - 18, F.cell)), h = Math.max(1, ...cells.map((l) => l.length)) * LINE + 22;
        blocks.push({ h, repeat: head, ops: (y) => [...cells.flatMap((lines, i) => lines.map((s, j) => ({ t: 'text', x: PAD + widths.slice(0, i).reduce((a, v) => a + v, 0) + 10, y: y + 34 + j * LINE, s, font: i === 1 && j === 0 ? `bold 25px ${FONT}` : F.cell, fill: C.ink }))), { t: 'line', x: PAD, y: y + h, w: inner }] });
      }
    } else blocks.push({ h: 50, ops: (y) => [{ t: 'text', x: PAD + 10, y: y + 34, s: 'Belum ada kegiatan diisi.', font: F.text, fill: C.muted }] });
    for (const [label, value] of [['Kendala', r.kendala], ['Tindak lanjut', r.tindak_lanjut]]) {
      if (!value) continue;
      const lines = wrapText(measure, value, inner - 20, F.text);
      blocks.push({ h: 48 + lines.length * LINE + 10, ops: (y) => [{ t: 'text', x: PAD + 10, y: y + 36, s: label, font: F.label, fill: C.green }, ...lines.map((s, j) => ({ t: 'text', x: PAD + 10, y: y + 74 + j * LINE, s, font: F.text, fill: C.ink }))] });
    }
    const aktif = (r.photos || []).filter((p) => !p.deleted_at && (p.thumbnail_url || p.url)), pilih = aktif.slice(0, PHOTOS_PER_REPORT), gap = 16, box = (inner - gap) / 2, ih = Math.round(box * 0.75);
    for (let i = 0; i < pilih.length; i += 2) {
      blocks.push({ h: ih + 52, ops: (y) => pilih.slice(i, i + 2).flatMap((p, k) => { const idx = photos.indexOf(p) >= 0 ? photos.indexOf(p) : photos.push(p) - 1, x = PAD + k * (box + gap);
        return [{ t: 'img', x, y: y + 6, w: box, h: ih, i: idx }, { t: 'text', x, y: y + ih + 38, s: keteranganFoto(p), font: F.cap, fill: C.muted, maxW: box }]; }) });
    }
    if (aktif.length > pilih.length) blocks.push({ h: 44, ops: (y) => [{ t: 'text', x: PAD + 10, y: y + 30, s: `+ ${aktif.length - pilih.length} foto lain ada di aplikasi / PDF.`, font: F.cap, fill: C.muted }] });
    blocks.push({ h: 26, spasi: true, ops: () => [] }); // jarak antar laporan (tidak pernah membuat gambar baru)
  }
  if (!tampil.length) blocks.push({ h: 80, ops: (y) => [{ t: 'text', x: PAD, y: y + 46, s: 'Belum ada laporan pada periode ini.', font: F.text, fill: C.muted }] });
  if (reports.length > tampil.length) blocks.push({ h: 50, ops: (y) => [{ t: 'text', x: PAD, y: y + 34, s: `Dan ${reports.length - tampil.length} laporan lain — lihat aplikasi atau PDF.`, font: F.text, fill: C.muted }] });

  // susun ke halaman (gambar) setinggi layar HP; judul tabel diulang bila baris berlanjut ke gambar berikutnya
  const pages = []; let cur = null;
  const baru = () => { cur = { top: pages.length ? HEAD2 : HEAD1, y: pages.length ? HEAD2 : HEAD1, ops: [] }; pages.push(cur); };
  baru();
  blocks.forEach((b, i) => {
    const sisa = MAXH - FOOT - cur.y, ikut = b.keep ? blocks.slice(i + 1, i + b.keep).reduce((s, n) => s + n.h, 0) : 0;
    if (b.spasi) { if (b.h <= sisa) cur.y += b.h; return; }
    const akhir = blocks.slice(i).reduce((s, n) => s + n.h, 0); // sisa isi sedikit → digabung ke gambar ini (maks. 1,25× tinggi) daripada gambar baru hampir kosong
    if (b.h + ikut > sisa && cur.y > cur.top && !(cur.y + akhir <= MAXH * 1.25 - FOOT)) { baru(); if (b.repeat) { cur.ops.push(...b.repeat.ops(cur.y)); cur.y += b.repeat.h; } }
    cur.ops.push(...b.ops(cur.y)); cur.y += b.h;
  });
  const n = pages.length, judul = divisi ? `Daily Report ${divisi}` : 'Daily Report Kebun', per = periodeLabel(from, to);
  return { photos, pages: pages.map((p, i) => ({ height: Math.max(p.y + FOOT, i ? 700 : 900), ops: [
    ...(i === 0 ? [{ t: 'rect', x: 0, y: 0, w: W, h: HEAD1 - 24, fill: C.green }, { t: 'text', x: PAD, y: 50, s: name.toUpperCase(), font: `bold 22px ${FONT}`, fill: '#CFE3D5' },
      { t: 'text', x: PAD, y: 104, s: judul, font: `bold 46px ${FONT}`, fill: '#FFFFFF' }, { t: 'text', x: PAD, y: 146, s: per, font: `27px ${FONT}`, fill: '#E8F1EA' }]
      : [{ t: 'rect', x: 0, y: 0, w: W, h: HEAD2 - 22, fill: C.green }, { t: 'text', x: PAD, y: 46, s: `${judul} · ${per} · lanjutan`, font: `bold 25px ${FONT}`, fill: '#FFFFFF', maxW: W - PAD * 2 }]),
    ...p.ops,
    { t: 'line', x: PAD, y: Math.max(p.y + FOOT, i ? 700 : 900) - FOOT + 8, w: inner },
    { t: 'text', x: PAD, y: Math.max(p.y + FOOT, i ? 700 : 900) - 24, s: `VIGU FARM · ${n > 1 ? `Gambar ${i + 1}/${n} · ` : ''}dibuat ${dibuat}${createdBy ? ' · ' + createdBy : ''}`, font: F.cap, fill: C.muted, maxW: inner },
  ] })) };
}

function gambar(ctx, ops, imgs) {
  for (const o of ops) {
    if (o.t === 'rect') { ctx.fillStyle = o.fill; if (o.r && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, o.h, o.r); ctx.fill(); } else ctx.fillRect(o.x, o.y, o.w, o.h); }
    else if (o.t === 'line') { ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + o.w, o.y); ctx.stroke(); }
    else if (o.t === 'text') { ctx.font = o.font; ctx.fillStyle = o.fill; let s = o.s; if (o.maxW) while (s.length > 1 && ctx.measureText(s).width > o.maxW) s = s.slice(0, -2) + '…'; ctx.fillText(s, o.x, o.y); }
    else if (o.t === 'chip') { ctx.font = o.font; const w = ctx.measureText(o.s).width + 32; ctx.fillStyle = o.fill; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(o.x - w, o.y - 21, w, 40, 20) : ctx.rect(o.x - w, o.y - 21, w, 40)); ctx.fill(); ctx.fillStyle = o.ink; ctx.fillText(o.s, o.x - w + 16, o.y + 8); }
    else if (o.t === 'img') {
      ctx.fillStyle = '#F2F5EF'; ctx.fillRect(o.x, o.y, o.w, o.h); const b = imgs[o.i];
      if (b) { const s = Math.max(o.w / b.width, o.h / b.height), sw = o.w / s, sh = o.h / s; ctx.drawImage(b, (b.width - sw) / 2, (b.height - sh) / 2, sw, sh, o.x, o.y, o.w, o.h); } // isi penuh kotak (crop tengah)
      else { ctx.font = F.cap; ctx.fillStyle = C.muted; ctx.fillText('Foto tidak dapat dimuat', o.x + 20, o.y + o.h / 2); }
    }
  }
}

// gambar di browser → File JPEG (siap navigator.share ke WhatsApp)
export async function dailyReportImages({ reports, from, to, divisi, name, createdBy }) {
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d'), measure = (s, font) => { ctx.font = font; return ctx.measureText(s).width; };
  const dibuat = new Date().toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
  const L = dailyImageLayout({ reports, from, to, divisi, name, createdBy, dibuat, measure });
  const imgs = await Promise.all(L.photos.map(async (p) => { try { const r = await fetch(p.thumbnail_url || p.url, { credentials: 'same-origin' }); if (!r.ok) return null; return await createImageBitmap(await r.blob()); } catch { return null; } }));
  const files = [];
  for (const [i, pg] of L.pages.entries()) {
    cv.width = IMG.W; cv.height = Math.ceil(pg.height); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.textBaseline = 'alphabetic';
    gambar(ctx, pg.ops, imgs);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
    files.push(new File([blob], `daily-report-${divisi ? divisi.toLowerCase() + '-' : ''}${from}${to && to !== from ? '_' + to : ''}${L.pages.length > 1 ? '-' + (i + 1) : ''}.jpg`, { type: 'image/jpeg' }));
  }
  return files;
}
