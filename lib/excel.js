// Excel input: buat file "Input Data Kebun.xlsx" dari database, dan baca kembali isinya.
// Prinsip: setiap sheet = isi lengkap satu tabel. Saat disinkronkan, isi tabel diganti dengan isi sheet
// (tambah baris = data baru, ubah = revisi, hapus baris = data dihapus). Backup dibuat sebelum setiap sinkron.
import ExcelJS from './exceljs.min.cjs'; // salinan file tunggal ExcelJS — tidak perlu node_modules (import biasa agar ikut terbawa saat deploy online)

const GREEN = 'FF2F6B3F', LIGHT = 'FFE7F1EA', YELLOW = 'FFFFF7D6';

export const sheetFields = (TABLES, cfg) => TABLES[cfg.table].f.filter((f) => f.t !== 'calc' && !(cfg.omit || []).includes(f.k));
const headerOf = (f) => f.l + (f.req ? ' *' : '');
const norm = (s) => String(s ?? '').replace(/\*/g, '').trim().toLowerCase();
const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const isoToDate = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return y ? new Date(Date.UTC(y, (m || 1) - 1, d || 1)) : null; };

// ---------------------------------------------------------------- BUAT FILE
// panel: nama halaman bila file hanya berisi data satu halaman (mis. "Iklim"); refNames(tabel) → daftar nama induk untuk dropdown
export async function buildWorkbook({ TABLES, SHEETS, rowsOf, nama, panel = null, refNames = null }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = nama || 'Monitoring Kebun';
  wb.created = new Date();

  // ---- petunjuk
  const ps = wb.addWorksheet('Petunjuk', { properties: { tabColor: { argb: GREEN } } });
  ps.getColumn(1).width = 4; ps.getColumn(2).width = 34; ps.getColumn(3).width = 90;
  const title = ps.getCell('B2'); title.value = `INPUT DATA KEBUN — ${nama || ''}${panel ? ` · ${panel}` : ''}`; title.font = { bold: true, size: 16, color: { argb: GREEN } };
  ps.getCell('B3').value = `Dibuat dari aplikasi: ${new Date().toLocaleString('id-ID')}`; ps.getCell('B3').font = { italic: true, color: { argb: 'FF666666' } };
  const steps = [
    ['Cara pakai', '1. Isi / ubah data di sheet masing-masing (satu baris = satu data). Simpan file (Ctrl+S).'],
    ...(panel ? [
      ['', `2. Upload kembali lewat tombol "⬆ Upload Excel" di halaman ${panel}. Hanya data halaman ini yang diperbarui — data halaman lain tidak tersentuh.`],
      ['', '3. Sebelum diterapkan, aplikasi menampilkan dulu berapa baris yang bertambah / berubah / terhapus.'],
    ] : [
      ['', '2. Aplikasi otomatis membaca file ini setiap kali disimpan, atau upload lewat menu "Input Excel" di aplikasi.'],
      ['', '3. Hasil sinkron (berapa data masuk / berubah / ada kesalahan) terlihat di menu "Input Excel".'],
    ]),
    ['Menambah data', 'Tulis di baris kosong paling bawah sheet yang sesuai.'],
    ['Merevisi data', 'Ubah langsung isi selnya.'],
    ['Menghapus data', 'Hapus barisnya (klik kanan nomor baris → Delete). Data itu ikut terhapus di aplikasi.'],
    ['Kolom bertanda *', 'Wajib diisi. Baris yang kolom wajibnya kosong membuat sheet itu tidak diproses sampai diperbaiki.'],
    ['Tanggal', 'Format tanggal Excel biasa (mis. 10/10/2026).'],
    ['Angka', 'Isi angka saja, tanpa "kg", "ha", "Rp". Desimal boleh pakai koma.'],
    ['Pilihan (dropdown)', 'Kolom seperti Blok, Kelas, Status, Aktivitas punya daftar pilihan — pakai pilihan itu supaya data terhubung (mis. nama blok sama persis).'],
    ['Ganti nama blok', 'Ganti di sheet blok DAN di semua sheet lain yang memakai nama blok itu (pakai Ctrl+H / Find & Replace).'],
    ['Jangan diubah', 'Nama sheet dan judul kolom di baris 1. Kolom tambahan di luar judul tidak dibaca.'],
    ['Mengosongkan sheet', 'Sheet yang dikosongkan tidak diproses (pengaman). Kalau memang mau mengosongkan semua datanya, tulis KOSONG di sel A2.'],
    ['Pengaman', 'Sebelum setiap sinkron aplikasi membuat backup database otomatis.'],
  ];
  steps.forEach(([a, b], i) => {
    const r = ps.getRow(5 + i); r.getCell(2).value = a; r.getCell(3).value = b;
    r.getCell(2).font = { bold: true }; r.getCell(3).alignment = { wrapText: true, vertical: 'top' };
  });
  const start = 5 + steps.length + 2;
  ps.getCell(`B${start}`).value = 'Sheet'; ps.getCell(`C${start}`).value = 'Isi';
  [ps.getCell(`B${start}`), ps.getCell(`C${start}`)].forEach((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; });
  SHEETS.forEach((cfg, i) => { const r = ps.getRow(start + 1 + i); r.getCell(2).value = cfg.sheet; r.getCell(3).value = TABLES[cfg.table].desc || TABLES[cfg.table].title; r.getCell(3).alignment = { wrapText: true }; });

  // posisi kolom tampilan (nama) tiap tabel induk → dipakai dropdown referensi
  const refCol = {};
  for (const cfg of SHEETS) {
    const T = TABLES[cfg.table];
    if (typeof T.display === 'string') {
      const idx = sheetFields(TABLES, cfg).findIndex((f) => f.k === T.display);
      if (idx >= 0) refCol[cfg.table] = `'${cfg.sheet}'!$${colLetter(idx)}$2:$${colLetter(idx)}$3000`;
    }
  }
  // daftar pilihan panjang disimpan di sheet tersembunyi
  const ls = wb.addWorksheet('_daftar', { state: 'veryHidden' });
  let lsCol = 0;
  const listRange = (opts) => {
    const s = `"${opts.join(',')}"`;
    if (s.length <= 250 && !opts.some((o) => o.includes(','))) return s;
    const c = colLetter(lsCol++);
    opts.forEach((o, i) => (ls.getCell(`${c}${i + 1}`).value = o));
    return `_daftar!$${c}$1:$${c}$${opts.length}`;
  };

  // ---- sheet data
  for (const cfg of SHEETS) {
    const T = TABLES[cfg.table];
    const F = sheetFields(TABLES, cfg);
    const ws = wb.addWorksheet(cfg.sheet, { views: [{ state: 'frozen', ySplit: 1 }], properties: { tabColor: { argb: cfg.sheet.startsWith('Pisang') ? 'FFCA8A04' : cfg.sheet.startsWith('Padi') ? 'FF65A30D' : 'FFB45309' } } });
    ws.columns = F.map((f) => ({ header: headerOf(f), key: f.k, width: Math.min(40, Math.max(12, headerOf(f).length + 3, f.t === 'area' ? 40 : 0)) }));
    const hr = ws.getRow(1);
    hr.height = 32;
    hr.eachCell((c, i) => {
      const f = F[i - 1];
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.req ? 'FF1F4D2C' : GREEN } };
      c.alignment = { vertical: 'middle', wrapText: true };
      const note = [f.hint, f.t === 'ref' ? `Pilih dari daftar ${TABLES[f.ref].title}` : null, f.t === 'date' ? 'Format tanggal' : null].filter(Boolean).join('. ');
      if (note) c.note = note;
    });
    const rows = rowsOf(cfg.table);
    for (const r of rows) {
      ws.addRow(Object.fromEntries(F.map((f) => {
        let v = r[f.k];
        if (v == null || v === '') return [f.k, null];
        if (f.t === 'date') v = isoToDate(v);
        else if (['int', 'num', 'money'].includes(f.t)) v = Number(v);
        return [f.k, v];
      })));
    }
    const last = Math.max(rows.length + 500, 1000);
    F.forEach((f, i) => {
      const col = ws.getColumn(i + 1), L = colLetter(i);
      if (f.t === 'date') col.numFmt = 'dd/mm/yyyy';
      if (f.t === 'int' || f.t === 'money') col.numFmt = '#,##0';
      if (f.t === 'num') col.numFmt = '#,##0.00##';
      let formula = null;
      if (f.t === 'select') formula = listRange(f.opt);
      else if (f.t === 'ref' && refCol[f.ref]) formula = refCol[f.ref];
      else if (f.t === 'ref' && refNames) { const names = [...new Set(refNames(f.ref).filter(Boolean))].sort(); if (names.length) formula = listRange(names); } // sheet induk tidak ikut → daftar nama di sheet tersembunyi
      else if (f.sug) formula = listRange(f.sug);
      if (formula) ws.dataValidations.add(`${L}2:${L}${last}`, { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: f.t === 'select', errorStyle: 'warning', errorTitle: 'Pilihan tidak ada di daftar', error: 'Nilai ini tidak ada di daftar. Tetap simpan?' });
      if (f.t === 'date') ws.dataValidations.add(`${L}2:${L}${last}`, { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Tanggal', error: 'Isi dengan tanggal (mis. 10/10/2026)' });
      if (['int', 'num', 'money'].includes(f.t)) ws.dataValidations.add(`${L}2:${L}${last}`, { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [-1e12], showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Angka', error: 'Isi dengan angka saja' });
    });
    if (rows.length) ws.autoFilter = { from: 'A1', to: `${colLetter(F.length - 1)}1` };
    // warna selang-seling ringan biar mudah dibaca
    for (let r = 2; r <= rows.length + 1; r++) if (r % 2 === 0) ws.getRow(r).eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAF7' } }));
  }
  ps.activate?.();
  return wb;
}

// ---------------------------------------------------------------- EXPORT SEDERHANA (tabel → xlsx)
// sheets: [{ name, rows: [{kolom: nilai}] }]
export async function simpleWorkbook(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(String(s.name || 'Data').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Data', { views: [{ state: 'frozen', ySplit: 1 }] });
    const keys = s.header || [...new Set((s.rows || []).flatMap((r) => Object.keys(r)))];
    ws.columns = keys.map((k) => ({ header: k, key: k, width: Math.min(40, Math.max(10, String(k).length + 3)) }));
    for (const r of s.rows || []) ws.addRow(r);
    ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- BACA FILE
function cellVal(v) {
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return cellVal(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if (v.error) return null;
    return null;
  }
  return v;
}
const pad = (x) => String(x).padStart(2, '0');
function toDate(v) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  return undefined;
}
// jam: teks "14:00" / "14.00", nilai waktu Excel (Date 1899-12-30 14:00 atau pecahan hari 0,5833)
function toTime(v) {
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number') { const mins = Math.round((v % 1) * 1440); return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
  const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})/);
  return m && +m[1] < 24 && +m[2] < 60 ? `${pad(m[1])}:${m[2]}` : undefined;
}
function toNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v).replace(/\s|rp|kg|ha/gi, '');
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// hasil: [{ cfg, found, rows, errors, kosong }]
export async function parseWorkbook(buffer, { TABLES, SHEETS }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = [];
  for (const cfg of SHEETS) {
    const ws = wb.getWorksheet(cfg.sheet);
    const res = { cfg, found: !!ws, rows: [], errors: [], kosong: false };
    out.push(res);
    if (!ws) continue;
    const F = sheetFields(TABLES, cfg);
    const map = {}; // kolom → field
    let asing = 0;
    ws.getRow(1).eachCell((c, col) => {
      const h = norm(cellVal(c.value));
      const f = F.find((x) => norm(x.l) === h || x.k === h);
      if (f) map[col] = f; else if (h) asing++;
    });
    res.layoutBeda = asing > 0 || Object.keys(map).length !== F.length;
    const miss = F.filter((f) => f.req && !Object.values(map).includes(f));
    if (miss.length) { res.errors.push({ row: 1, msg: `Judul kolom wajib tidak ditemukan: ${miss.map((f) => f.l).join(', ')}` }); continue; }
    res.kosong = String(cellVal(ws.getCell('A2').value) ?? '').trim().toUpperCase() === 'KOSONG';
    for (let r = 2; r <= ws.rowCount; r++) {
      if (res.kosong && r === 2) continue; // baris penanda KOSONG tidak dibaca sebagai data
      const row = ws.getRow(r);
      const obj = {}; let any = false;
      for (const [col, f] of Object.entries(map)) {
        let v = cellVal(row.getCell(Number(col)).value);
        if (typeof v === 'string') v = v.trim();
        if (v === '' || v == null) { obj[f.k] = null; continue; }
        any = true;
        if (f.t === 'date') { const d = toDate(v); if (d === undefined) res.errors.push({ row: r, msg: `${f.l}: "${v}" bukan tanggal` }); obj[f.k] = d ?? null; }
        else if (['int', 'num', 'money'].includes(f.t)) { const x = toNum(v); if (x === undefined) res.errors.push({ row: r, msg: `${f.l}: "${v}" bukan angka` }); obj[f.k] = x === undefined ? null : f.t === 'int' ? Math.round(x) : x; }
        else if (f.time) { const t = toTime(v); if (t === undefined) res.errors.push({ row: r, msg: `${f.l}: "${v}" bukan jam (JJ:MM)` }); obj[f.k] = t ?? null; }
        else obj[f.k] = v instanceof Date ? toDate(v) : String(v);
      }
      if (!any || (res.kosong && r === 2)) continue;
      for (const f of F) if (f.req && (obj[f.k] == null || obj[f.k] === '')) res.errors.push({ row: r, msg: `${f.l} wajib diisi` });
      Object.defineProperty(obj, '__baris', { value: r }); // nomor baris Excel untuk pesan (tidak ikut disimpan)
      res.rows.push(obj);
    }
  }
  return out;
}
