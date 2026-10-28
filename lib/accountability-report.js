// Laporan pertanggungjawaban lengkap (Excel rapi): ringkasan + rincian per lahan, panen, penjualan, kegiatan dan iklim.
// Angka diambil dari ringkasan yang sama dengan dashboard (overview, kebunPlan/bananaDetail, padiSummary, kebunSummary),
// sehingga laporan selalu sama dengan yang tampil di aplikasi. accountabilityData() murni (bisa dites), workbook dibuat terpisah.
import ExcelJS from './exceljs.min.cjs';

const GREEN = 'FF2F6B3F', LIGHT = 'FFE7F1EA', BORDER = 'FFD5DED6';
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const FMT = { money: '"Rp" #,##0', num: '#,##0.00', int: '#,##0', pct: '0.0"%"', date: 'dd/mm/yyyy', text: '@' };
const fieldFormat = (f) => (f.t === 'money' || ['total', 'piutang'].includes(f.k) ? 'money' : f.t === 'int' ? 'int' : f.t === 'num' ? 'num' : f.t === 'date' ? 'date' : f.t === 'calc' ? 'num' : 'text');
// Harga satuan, umur, rata-rata dan rasio tidak dijumlah.
const summed = (f) => (['money', 'int', 'num'].includes(f.t) || ['total', 'piutang'].includes(f.k)) && !/^(harga|umur|kg_per|rendemen|ton_ha|pct)/.test(f.k);

export function accountabilityData({ from, to, today, company, createdBy, overview, plan, padi, locations = [], landPisang, landPadi, activities = [], details = [] }) {
  const banana = plan?.banana || {}, nursery = banana.nursery || {}, o = overview || {}, ps = o.pisang?.sales || {}, ds = o.padi?.sales || {};
  const item = (label, value, unit = '', note = '') => ({ label, value: value ?? null, unit, note });
  const dailyRows = Object.entries(o.dailyTotals || {}).map(([d, v]) => item(`Laporan harian selesai — ${d}`, v.reports, 'laporan', `Total HK ${Number(v.hk || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })}`));
  const summary = [
    { title: 'Lahan milik kebun (posisi hari ini)', items: [item('Luas lahan milik kebun (GIS)', o.blocks?.ownedAreaHa, 'ha'), item('Jumlah blok milik kebun', o.blocks?.owned, 'blok'), item('Blok belum diverifikasi', o.blocks?.unverified, 'blok')] },
    { title: 'Pisang — lahan & tanam (posisi hari ini)', items: [item('Total luas blok Pisang', banana.area, 'ha'), item('Sudah tertanam', banana.plantedHa, 'ha'), item('Sisa belum tertanam', banana.area == null ? null : Math.max(0, banana.area - (banana.plantedHa || 0)), 'ha'), item('Pokok tertanam', banana.plantedPokok, 'pokok'), item('Populasi tercatat', banana.population, 'pokok', banana.missingPokok ? `${banana.missingPokok} blok tertanam belum ada data pokok` : '')] },
    { title: `Rencana tanam Pisang ${plan?.year ?? ''}`.trim(), items: [item('Target tanam', plan?.targetHa, 'ha'), item('Sudah tertanam (blok target)', plan?.plantedHa, 'ha'), item('Sisa target', plan?.remainingHa, 'ha'), item('Perkiraan selesai tanam', plan?.forecastEnd || 'Belum ada jadwal', '')] },
    { title: 'Bibit Pisang / nursery (posisi hari ini)', items: [item('Bibit datang', nursery.incoming, 'bibit'), item('Tambahan splitting', nursery.splitting, 'bibit'), item('Sudah ditanam dari nursery', nursery.planted, 'bibit'), item('Afkir + mortal', num(nursery.rejected) == null && num(nursery.mortality) == null ? null : (nursery.rejected || 0) + (nursery.mortality || 0), 'bibit'), item('Saldo bibit', nursery.balance, 'bibit')] },
    { title: 'Pisang — panen & penjualan (periode)', items: [item('Panen (PKK)', o.pisang?.harvest, 'tandan'), item('Hasil packing', o.pisang?.boxes, 'box'), item('Berat hasil packing', o.pisang?.kg, 'kg'), item('Penjualan', ps.revenue, 'Rp'), item('Sudah dibayar', ps.paid, 'Rp'), item('Piutang', ps.outstanding, 'Rp')] },
    { title: 'Padi — lahan (posisi hari ini)', items: [item('Total luas petak Padi', padi?.area, 'ha'), item('Masih tertanam', padi?.plantedHa, 'ha'), item('Sudah panen', padi?.harvestedHa, 'ha'), item('Belum tanam / lainnya', padi?.otherHa, 'ha')] },
    { title: 'Padi — panen, giling & penjualan (periode)', items: [item('Panen gabah (GKP)', o.padi?.harvestKg, 'kg'), item('Panen GKG', o.padi?.harvestGkgKg, 'kg', o.padi?.gkgEstimatedKg ? `termasuk estimasi ${Number(o.padi.gkgEstimatedKg).toLocaleString('id-ID')} kg` : ''), item('Beras hasil giling', o.padi?.milledKg, 'kg'), item('Penjualan', ds.revenue, 'Rp'), item('Sudah dibayar', ds.paid, 'Rp'), item('Piutang', ds.outstanding, 'Rp')] },
    { title: 'Benih Padi (saldo hari ini)', items: (padi?.seeds?.varieties || []).map((v) => item(`Saldo benih ${v.name}`, v.balance, 'kg', `masuk ${v.incoming ?? 0} · pakai ${v.used ?? 0} · afkir ${v.rejected ?? 0} kg`)) },
    { title: 'Persiapan lahan (periode)', items: [item('Land clearing', o.infra?.lcHa, 'ha'), item('Catatan persiapan lahan', o.infra?.activities, 'catatan'), item('Blok dikerjakan', o.infra?.blocks, 'blok')] },
    { title: 'Daily Report (periode)', items: dailyRows.length ? dailyRows : [item('Laporan harian selesai', 0, 'laporan')] },
    { title: 'Iklim (periode)', items: [item('Curah hujan', o.climate?.rain, 'mm'), item('Hari hujan', o.climate?.rainDays, 'hari'), item('Hari tanpa data hujan', o.climate?.missingDays, 'hari')] },
  ].filter((s) => s.items.length);

  // Daftar lahan: setiap blok milik kebun beserta status tanamnya (Pisang dari bananaDetail, Padi dari padiSummary).
  const bananaBy = new Map((banana.blocks || []).map((b) => [String(b.name).toLowerCase(), b])), padiBy = new Map((padi?.blocks || []).map((b) => [String(b.name).toLowerCase(), b]));
  const lahan = [...locations].sort((a, b) => String(a.divisi || '').localeCompare(String(b.divisi || '')) || String(a.nama).localeCompare(String(b.nama), 'id', { numeric: true })).map((l) => {
    const k = String(l.nama).toLowerCase(), b = bananaBy.get(k), p = padiBy.get(k), area = num(b?.area ?? p?.area ?? l.luas_ha);
    return { blok: l.nama, komoditas: l.divisi || '', luas: area, tertanam: b ? b.plantedHa : p ? p.plantedHa : null, belum: b ? Math.max(0, (area || 0) - (b.plantedHa || 0)) : p ? p.otherHa : null, panen: p ? p.harvestedHa : null, pokok: b?.plantedPokok ?? null, populasi: b?.population ?? null, status: p?.status || (b ? (b.plantedHa >= (area || 0) - 1e-6 && b.plantedHa > 0 ? 'Tertanam penuh' : b.plantedHa > 0 ? 'Tertanam sebagian' : 'Belum tanam') : ''), varietas: p?.variety || '', tanam: p?.plantDate || '' };
  });
  const sheets = [
    { name: 'Daftar Lahan', title: 'Daftar lahan milik kebun & status tanam (posisi hari ini)', columns: [['Blok', 'blok', 'text', 14], ['Komoditas', 'komoditas', 'text', 12], ['Luas (ha)', 'luas', 'num', 11], ['Tertanam (ha)', 'tertanam', 'num', 13], ['Belum tertanam / lainnya (ha)', 'belum', 'num', 16], ['Sudah panen (ha)', 'panen', 'num', 13], ['Pokok tertanam', 'pokok', 'int', 13], ['Populasi', 'populasi', 'int', 12], ['Status', 'status', 'text', 18], ['Varietas', 'varietas', 'text', 14], ['Tanggal tanam', 'tanam', 'date', 13]], rows: lahan, total: ['luas', 'tertanam', 'belum', 'panen', 'pokok', 'populasi'] },
    { name: 'Rencana Tanam Pisang', title: `Rencana tanam Pisang ${plan?.year ?? ''} per blok`, columns: [['Blok', 'name', 'text', 14], ['Luas target (ha)', 'area', 'num', 14], ['Bulan target', 'targetMonth', 'text', 12], ['Tertanam (ha)', 'plantedHa', 'num', 13], ['Sisa (ha)', 'remainingHa', 'num', 11], ['Perkiraan selesai', 'forecast', 'date', 15], ['Status', 'status', 'text', 14]], rows: (plan?.blocks || []).map((b) => ({ ...b, status: b.complete ? 'Selesai' : b.late ? 'Terlambat' : 'Berjalan' })), total: ['area', 'plantedHa', 'remainingHa'] },
    ...[['Progres Lahan Pisang', landPisang], ['Progres Lahan Padi', landPadi]].filter(([, d]) => d?.blocks?.length).map(([name, d]) => ({ name, title: `${name} per blok (ha per tahap, posisi hari ini)`, columns: [['Blok', 'name', 'text', 14], ['Luas (ha)', 'area', 'num', 10], ...d.stages.map((s, i) => [s, 's' + i, 'num', Math.max(10, s.length + 2)]), ['Progres', 'pct', 'pct', 10]], rows: d.blocks.map((b) => ({ name: b.name, area: b.area, pct: b.pct, ...Object.fromEntries(b.activity.map((a, i) => ['s' + i, a.applicable ? a.ha : null])) })), total: ['area', ...d.stages.map((_, i) => 's' + i)] })),
    { name: 'Kegiatan Harian', title: 'Rekap kegiatan Daily Report selesai (periode)', note: 'Hasil = jumlah isian harian; untuk kegiatan berulang (siram, semprot, dll.) angka ini akumulasi tiap pelaksanaan, bukan luas lahan.', columns: [['Divisi', 'divisi', 'text', 10], ['Kegiatan', 'aktivitas', 'text', 32], ['Satuan', 'satuan', 'text', 9], ['Hari kerja', 'hari', 'int', 10], ['Jumlah blok', 'blok', 'int', 11], ['Total hasil', 'hasil', 'num', 12], ['Total HK', 'hk', 'num', 10]], rows: activities, total: ['hk'] },
    // Penjualan: total semua baris + total penjualan saja (tanpa Mutasi Internal & Ongkir) yang sama dengan Ringkasan/dashboard.
    ...details.map((d) => ({ name: d.title, title: `${d.title} (periode)`, ...(d.sale ? { note: 'Baris Mutasi Internal & Ongkir tetap ditampilkan, tetapi tidak dihitung sebagai penjualan pada Ringkasan.' } : {}), columns: d.fields.map((f) => [f.l, f.k, fieldFormat(f), f.t === 'text' ? 22 : 14]), rows: d.rows, total: d.fields.filter(summed).map((f) => f.k), totalRows: d.sale ? [{ label: 'TOTAL semua baris' }, { label: 'TOTAL PENJUALAN (sama dengan Ringkasan)', only: d.sale }] : undefined })),
    { name: 'Iklim Harian', title: 'Iklim harian (periode)', columns: [['Tanggal', 'tanggal', 'date', 12], ['Hujan (mm)', 'hujan', 'num', 11], ['Suhu min (°C)', 'tmin', 'num', 12], ['Suhu maks (°C)', 'tmax', 'num', 12], ['Kelembapan rata-rata (%)', 'havg', 'num', 14], ['Angin maks (m/s)', 'wmax', 'num', 13], ['Arah angin dominan', 'arah', 'text', 14]], rows: o.climate?.days || [], total: ['hujan'] },
  ].map((s) => ({ ...s, columns: s.columns.map(([h, k, fmt, w]) => ({ h, k, fmt, w })) }));
  return { meta: { company: company || 'PT VIGU FARM INDONESIA', from, to, today, createdBy: createdBy || '' }, summary, sheets };
}

const thin = { style: 'thin', color: { argb: BORDER } }, box = { top: thin, left: thin, bottom: thin, right: thin };
const dateValue = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : v || null; };
const cellValue = (v, fmt) => (v == null || v === '' ? null : fmt === 'date' ? dateValue(v) : ['money', 'num', 'int', 'pct'].includes(fmt) ? num(v) : v);
const tgl = (s) => { const d = dateValue(s); return d instanceof Date ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : String(s || ''); };
function head(ws, data, title, width) {
  ws.mergeCells(1, 1, 1, width); ws.getCell(1, 1).value = data.meta.company; ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: GREEN } };
  ws.mergeCells(2, 1, 2, width); ws.getCell(2, 1).value = title; ws.getCell(2, 1).font = { bold: true, size: 12 };
  ws.mergeCells(3, 1, 3, width); ws.getCell(3, 1).value = `Periode ${tgl(data.meta.from)} s.d. ${tgl(data.meta.to)} · posisi lahan per ${tgl(data.meta.today)}`; ws.getCell(3, 1).font = { color: { argb: 'FF555555' } };
}
function printable(ws, rowsToRepeat) { ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }, ...(rowsToRepeat ? { printTitlesRow: rowsToRepeat } : {}) }; ws.headerFooter = { oddFooter: '&L&8Laporan pertanggungjawaban kebun&R&8Halaman &P / &N' }; }

export async function accountabilityWorkbook(data) {
  const wb = new ExcelJS.Workbook(); wb.creator = data.meta.company; wb.created = new Date();
  const s = wb.addWorksheet('Ringkasan', { views: [{ showGridLines: false }] });
  s.columns = [{ width: 46 }, { width: 20 }, { width: 10 }, { width: 52 }];
  head(s, data, 'LAPORAN PERTANGGUNGJAWABAN KEBUN', 4);
  s.mergeCells(4, 1, 4, 4); s.getCell(4, 1).value = `Diunduh ${tgl(data.meta.today)}${data.meta.createdBy ? ' oleh ' + data.meta.createdBy : ''}`; s.getCell(4, 1).font = { italic: true, size: 9, color: { argb: 'FF777777' } };
  let r = 6;
  for (const sec of data.summary) {
    s.mergeCells(r, 1, r, 4); const t = s.getCell(r, 1); t.value = sec.title; t.font = { bold: true, color: { argb: 'FFFFFFFF' } }; t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; r++;
    for (const it of sec.items) {
      const row = s.getRow(r); row.values = [it.label, it.unit === 'Rp' ? num(it.value) : typeof it.value === 'number' ? it.value : /^\d{4}-\d{2}-\d{2}$/.test(it.value || '') ? tgl(it.value) : it.value ?? 'Belum tercatat', it.unit === 'Rp' ? '' : it.unit, it.note || ''];
      const v = row.getCell(2); if (typeof v.value === 'number') v.numFmt = it.unit === 'Rp' ? FMT.money : Number.isInteger(v.value) ? FMT.int : FMT.num; v.alignment = { horizontal: 'right' }; v.font = { bold: true };
      row.getCell(4).font = { size: 9, color: { argb: 'FF666666' } }; row.eachCell({ includeEmpty: true }, (c) => { c.border = { bottom: thin }; }); r++;
    }
    r++;
  }
  printable(s);
  for (const sh of data.sheets) {
    const ws = wb.addWorksheet(sh.name.replace(/[\\/?*[\]:]/g, '').slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }] }), w = sh.columns.length;
    ws.columns = sh.columns.map((c) => ({ width: c.w }));
    head(ws, data, sh.title, Math.max(w, 2));
    if (sh.note) { ws.mergeCells(4, 1, 4, Math.max(w, 2)); ws.getCell(4, 1).value = sh.note; ws.getCell(4, 1).font = { italic: true, size: 9, color: { argb: 'FF777777' } }; }
    const hr = ws.getRow(5); hr.values = sh.columns.map((c) => c.h); hr.height = 30;
    hr.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; c.alignment = { wrapText: true, vertical: 'middle' }; c.border = box; });
    let i = 6;
    for (const row of sh.rows) { const x = ws.getRow(i++); x.values = sh.columns.map((c) => cellValue(row[c.k], c.fmt)); sh.columns.forEach((c, j) => { const cell = x.getCell(j + 1); if (FMT[c.fmt] && c.fmt !== 'text') cell.numFmt = FMT[c.fmt]; cell.border = box; if (c.fmt === 'text') cell.alignment = { wrapText: true, vertical: 'top' }; }); }
    if (!sh.rows.length) { ws.mergeCells(i, 1, i, Math.max(w, 2)); ws.getCell(i, 1).value = 'Tidak ada data.'; ws.getCell(i, 1).font = { italic: true, color: { argb: 'FF777777' } }; }
    else if (sh.total?.length) for (const t of sh.totalRows || [{ label: 'TOTAL' }]) {
      const x = ws.getRow(i++), rows = t.only ? sh.rows.filter(t.only) : sh.rows; x.getCell(1).value = t.label;
      sh.columns.forEach((c, j) => { const cell = x.getCell(j + 1); if (j && sh.total.includes(c.k)) { cell.value = rows.reduce((s, r) => s + (num(r[c.k]) || 0), 0); cell.numFmt = FMT[c.fmt] || FMT.num; } cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }; cell.border = box; });
    }
    printable(ws, '5:5');
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
