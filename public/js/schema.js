// =====================================================================
//  DEFINISI DIVISI & TABEL
//  File ini dipakai server (membuat/menambah kolom database otomatis)
//  dan browser (form, tabel, import Excel).
//  Menambah field baru: cukup tambahkan di daftar `f` lalu restart
//  server -> kolom baru dibuat otomatis, data lama tetap aman.
//
//  Tipe field (t):
//    text | area | int | num | money | date | select (opt) |
//    ref (ref: nama tabel lain, disimpan sebagai teks) |
//    calc (dihitung otomatis: fn(row, ctx), fmt: int|num|money|pct|text|date)
// =====================================================================

export const util = {
  d(s) {
    if (!s) return null;
    const [y, m, dd] = String(s).slice(0, 10).split('-').map(Number);
    return y ? new Date(y, (m || 1) - 1, dd || 1) : null;
  },
  iso(d) {
    if (!d) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
  today() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; },
  daysSince(s) { const d = util.d(s); return d ? Math.round((util.today() - d) / 86400000) : null; },
  addDays(s, n) { const d = util.d(s); if (!d) return ''; d.setDate(d.getDate() + n); return util.iso(d); },
  n(v) { return v == null || v === '' ? 0 : Number(v) || 0; },
  key(s) { return String(s ?? '').toUpperCase().replace(/\s+/g, '').trim(); },
};
const { n, daysSince } = util;

// Jumlahkan kolom `col` di tabel `tbl` untuk baris dengan field `by` == nilai
const sumBy = (ctx, tbl, by, val, col) =>
  ctx.rows(tbl).filter((x) => util.key(x[by]) === util.key(val)).reduce((a, x) => a + n(x[col]), 0);

const KEGIATAN_PISANG = ['Pemupukan', 'Irigasi / Siram', 'Fertigasi', 'Desuckering', 'Deleafing / Sanitasi', 'Bagging / Bungkus', 'Propping / Ajir', 'Pengendalian OPT', 'Penyiangan', 'Panen', 'Packing', 'Sulam', 'Lainnya'];
const KEGIATAN_PADI = ['Olah Tanah', 'Persemaian', 'Tanam / Tandur', 'Penyulaman', 'Pemupukan', 'Penyemprotan', 'Pengairan', 'Penyiangan', 'Panen', 'Pengeringan', 'Lainnya'];
export const PADI_AKT = ['Olah Tanah 1 (Bajak)', 'Olah Tanah 2 (Rotary/Garu)', 'Persemaian', 'Tanam (Tandur)'];
const TIPE_JUAL =['Penjualan', 'Sampel', 'Retur', 'Mutasi Internal', 'Ongkir'];
export const nominalJual = (r) => (r.nominal != null && r.nominal !== '' ? n(r.nominal) : n(r.harga) * (n(r.jumlah_box) || n(r.berat_kg)));
export const isJual = (r) => !['Mutasi Internal', 'Ongkir'].includes(r.tipe);
// ---- Penjualan pisang: cukup isi SALAH SATU — Jenis Barang (gaya Excel kantor) ATAU Bentuk/Kelas/Kondisi; sisanya diisi otomatis.
// Tahan huruf besar/kecil, spasi/tanda baca, salah ketik ringan (mis. "pisang cavendsih fh a matng" → FH / A / Matang).
// Hanya mengisi kolom yang KOSONG; isian manual tidak pernah ditimpa (hanya dirapikan ejaannya, mis. "fh" → "FH").
const jarak = (a, b) => { // jarak salah ketik (Damerau-Levenshtein sederhana)
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
};
const mirip = (w, kata) => w === kata || (kata.length >= 4 && w.length >= 3 && jarak(w, kata) <= (kata.length >= 7 ? 2 : 1));
const KATA_JUAL = [['Ongkir', ['ONGKIR', 'ONGKOS']], ['Retur', ['RETUR', 'RETURN']], ['Sampel', ['SAMPEL', 'SAMPLE']]];
const KATA_KONDISI = [['Matang', ['MATANG']], ['Mentah', ['MENTAH']]], KATA_REJECT = ['REJECT', 'REJEK'], KATA_MIX = ['MIX', 'MIKS', 'MIXED'];
const OPSI_JUAL = { tipe: TIPE_JUAL, bentuk: ['FH', 'CL', 'SL'], kelas: ['A', 'B', 'C', 'MIX', 'Reject'], kondisi: ['Matang', 'Mentah', 'Reject'] };
const SINONIM = { tipe: { SAMPLE: 'Sampel', MUTASI: 'Mutasi Internal', JUAL: 'Penjualan', RETURN: 'Retur', ONGKOS: 'Ongkir' }, kelas: { MIKS: 'MIX', MIXED: 'MIX', REJEK: 'Reject' }, kondisi: { REJEK: 'Reject' } };
const rapikanPilihan = (k, v) => { // "penjualn" → "Penjualan", "fh" → "FH", "matng" → "Matang"; tidak dikenal → dibiarkan
  if (v == null || v === '') return v;
  const w = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return OPSI_JUAL[k].find((o) => o.toUpperCase().replace(/[^A-Z0-9]/g, '') === w) || SINONIM[k]?.[w] || OPSI_JUAL[k].find((o) => mirip(w, o.toUpperCase().replace(/[^A-Z0-9]/g, ''))) || v;
};
export function bacaJenisBarang(teks) { // → { tipe, bentuk, kelas, kondisi } yang terbaca dari tulisan Jenis Barang
  const tok = String(teks || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
    .flatMap((w) => { const m = w.match(/^(FH|CL|SL)(A|B|C|MIX)$/), t = w.match(/^(A|B|C)(FH|CL|SL)$/); return m ? [m[1], m[2]] : t ? [t[2], t[1]] : [w]; }); // "FHA" / "AFH" → FH A (urutan kata bebas)
  const ada = (daftar) => tok.some((w) => daftar.some((k) => mirip(w, k)));
  const o = {};
  o.tipe = KATA_JUAL.find(([, d]) => ada(d))?.[0];
  const satu = (xs) => { const u = [...new Set(xs.filter(Boolean))]; return u.length === 1 ? u[0] : undefined; }; // campuran (mis. "FH A & CL A", "A+B") → tidak ditebak
  o.bentuk = satu(tok.filter((w) => ['FH', 'CL', 'SL'].includes(w)));
  const reject = ada(KATA_REJECT);
  o.kelas = reject ? 'Reject' : satu(tok.map((w) => (['A', 'B', 'C'].includes(w) ? w : KATA_MIX.some((k) => mirip(w, k)) ? 'MIX' : null)));
  o.kondisi = reject ? 'Reject' : KATA_KONDISI.find(([, d]) => ada(d))?.[0];
  return o;
}
export function lengkapiJual(row, lama) { // lama = isi sebelum diedit (form / PUT) → kolom yang dulu terisi otomatis ikut menyesuaikan
  const r = { ...row }, kosong = (v) => v == null || v === '';
  if (lama) {
    const K = ['tipe', 'bentuk', 'kelas', 'kondisi'], sm = (a, b) => (a ?? null) === (b ?? null);
    if (!sm(r.jenis_barang, lama.jenis_barang)) { const dulu = lengkapiJual({ jenis_barang: lama.jenis_barang, pembeli: lama.pembeli }); for (const k of K) if (sm(r[k], lama[k]) && sm(lama[k], dulu[k])) r[k] = null; } // Jenis Barang diganti → isian otomatis lama dihitung ulang
    else if (K.some((k) => !sm(r[k], lama[k])) && sm(lama.jenis_barang, lengkapiJual({ ...lama, jenis_barang: null }).jenis_barang)) r.jenis_barang = null; // Bentuk/Kelas/Kondisi diganti & Jenis dulu otomatis → dibuat ulang
  }
  for (const k of Object.keys(OPSI_JUAL)) r[k] = rapikanPilihan(k, r[k]);
  if (!kosong(r.jenis_barang)) { const b = bacaJenisBarang(r.jenis_barang); for (const k of ['tipe', 'bentuk', 'kelas', 'kondisi']) if (kosong(r[k]) && b[k]) r[k] = b[k]; }
  if (kosong(r.tipe)) r.tipe = /RIPENING/.test(String(r.pembeli || '').toUpperCase()) ? 'Mutasi Internal' : 'Penjualan';
  if (kosong(r.jenis_barang) && (r.bentuk || r.kelas || r.kondisi || r.tipe === 'Ongkir')) {
    const isi = r.tipe === 'Ongkir' ? 'ONGKIR PISANG CAVENDISH' : ['PISANG CAVENDISH', r.bentuk, r.kelas === 'Reject' ? 'REJECT' : r.kelas, r.kelas === 'Reject' || r.kondisi === 'Reject' ? '' : r.kondisi].filter(Boolean).join(' ').toUpperCase();
    r.jenis_barang = r.tipe === 'Retur' ? 'RETUR ' + isi : r.tipe === 'Sampel' ? isi + ' (SAMPLE)' : isi;
  }
  return r;
}
const OPT_PADI = ['Wereng Batang Coklat', 'Penggerek Batang', 'Tikus', 'Blast', 'Hawar Daun Bakteri (Kresek)', 'Tungro', 'Keong Mas', 'Walang Sangit', 'Ulat Grayak', 'Lainnya'];

export const DIVISIONS = [
  { key: 'pisang', name: 'Pisang', icon: '🍌', color: '#ca8a04',
    tables: ['pisang_blok', 'pisang_panen_pkk', 'pisang_box', 'pisang_estimasi', 'pisang_handclass', 'pisang_bibit', 'pisang_kegiatan'] },
  { key: 'padi', name: 'Padi', icon: '🌾', color: '#65a30d',
    tables: ['padi_benih', 'padi_petak', 'padi_tanam', 'padi_kegiatan', 'padi_opt', 'padi_rencana', 'padi_panen', 'padi_giling'] },
  { key: 'lahan', name: 'Infra & Pembukaan Lahan', icon: '🚜', color: '#b45309',
    tables: ['lahan_blok', 'lahan_harian', 'lahan_target', 'lahan_aktivitas'] },
  { key: 'iklim', name: 'Iklim', icon: '🌦️', color: '#0284c7',
    tables: ['iklim'] },
  { key: 'gis', name: 'GIS & Peta', icon: '🗺️', color: '#7c3aed',
    tables: ['gis_titik'] },
];

export const TABLES = {
  // ------------------------------------------------------------ PISANG
  pisang_blok: {
    title: 'Blok Tanam', div: 'pisang', display: 'nama_blok', sort: 'nama_blok',
    desc: 'Data induk blok pisang: tanggal tanam, luas, pokok, kehilangan & sulam. Nama blok dipakai untuk menghubungkan ke peta GIS.',
    f: [
      { k: 'nama_blok', l: 'Nama Blok', t: 'text', req: true },
      { k: 'wilayah', l: 'Wilayah', t: 'select', opt: ['Utara', 'Selatan', 'Timur', 'Barat'] },
      { k: 'tanggal_tanam', l: 'Tanggal Tanam', t: 'date' },
      { k: 'luas_ha', l: 'Luas (ha)', t: 'num' },
      { k: 'pokok_tanam', l: 'Pokok Tanam', t: 'int' },
      { k: 'klon', l: 'Klon / Varietas', t: 'text', sug: ['Moka', 'G9', 'Cavendish', 'Mas Kirana', 'Raja Bulu'] },
      { k: 'status', l: 'Status', t: 'select', opt: ['Belum Tanam', 'TBM', 'PC', 'R1', 'R2', 'R3', 'R4', 'Bongkar'] },
      { k: 'kehilangan', l: 'Kehilangan (pkk)', t: 'int' },
      { k: 'sulam', l: 'Sulam (pkk)', t: 'int' },
      { k: 'populasi', l: 'Populasi', t: 'calc', fmt: 'int', fn: (r) => n(r.pokok_tanam) - n(r.kehilangan) + n(r.sulam) },
      { k: 'umur_bln', l: 'Umur (bln)', t: 'calc', fmt: 'num1', fn: (r) => (r.tanggal_tanam ? daysSince(r.tanggal_tanam) / 30.44 : null) },
      { k: 'total_pkk', l: 'Total PKK Panen', t: 'calc', fmt: 'int', fn: (r, c) => sumBy(c, 'pisang_panen_pkk', 'blok', r.nama_blok, 'pkk_panen') },
      { k: 'keterangan', l: 'Keterangan', t: 'area' },
    ],
  },
  pisang_panen_pkk: {
    title: 'Panen Pokok (PKK)', div: 'pisang', date: 'tanggal', sort: '-tanggal',
    desc: 'Log jumlah pokok (tandan) yang dipanen per blok per tanggal.',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'blok', l: 'Blok', t: 'ref', ref: 'pisang_blok', req: true },
      { k: 'fase', l: 'Fase', t: 'select', opt: ['PC', 'R1', 'R2', 'R3', 'R4'] },
      { k: 'pkk_panen', l: 'PKK Panen', t: 'int', req: true },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  pisang_box: {
    title: 'Box Panen (Packing House)', div: 'pisang', date: 'tanggal', sort: '-tanggal',
    desc: 'Hasil packing per hari: jumlah box per kelas & bentuk, berat kg.',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'blok', l: 'Blok (opsional)', t: 'ref', ref: 'pisang_blok' },
      { k: 'kelas', l: 'Kelas', t: 'select', opt: ['A', 'B', 'C', 'MIX'], req: true },
      { k: 'bentuk', l: 'Bentuk', t: 'select', opt: ['FH', 'Cluster', 'Single'] },
      { k: 'jumlah_box', l: 'Jumlah Box', t: 'int', req: true },
      { k: 'berat_kg', l: 'Berat (kg)', t: 'num' },
      { k: 'kg_per_box', l: 'kg/Box', t: 'calc', fmt: 'num1', fn: (r) => (n(r.jumlah_box) ? n(r.berat_kg) / n(r.jumlah_box) : null) },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  pisang_estimasi: {
    title: 'Estimasi Panen', div: 'pisang', date: 'bulan', sort: '-bulan',
    desc: 'Estimasi box panen per bulan — disandingkan dengan realisasi Box Panen (Packing House).',
    f: [
      { k: 'bulan', l: 'Bulan', t: 'date', req: true, hint: 'Isi tanggal berapa saja di bulan itu (mis. 1/10/2026) — yang dipakai bulannya.' },
      { k: 'box', l: 'Estimasi Box', t: 'int', req: true },
      { k: 'box_a', l: 'Box A', t: 'int' },
      { k: 'box_b', l: 'Box B', t: 'int' },
      { k: 'box_c', l: 'Box C', t: 'int' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  pisang_handclass: {
    title: 'Hand Class', div: 'pisang', date: 'tanggal', sort: '-tanggal',
    desc: 'Rata-rata hand (sisir) per tandan per blok per hari.',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'blok', l: 'Blok', t: 'ref', ref: 'pisang_blok', req: true },
      { k: 'status', l: 'Status', t: 'select', opt: ['PC', 'R1', 'R2', 'R3', 'R4'] },
      { k: 'rata_hand', l: 'Rata-rata Hand Class', t: 'num', req: true },
      { k: 'jumlah_sampel', l: 'Jumlah Sampel', t: 'int' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  pisang_bibit: {
    title: 'Monitoring Bibit', div: 'pisang', date: 'tanggal_datang', sort: '-tanggal_datang',
    desc: 'Bibit per kedatangan/batch: afkir, mortalitas, yang sudah ditanam, saldo.',
    f: [
      { k: 'tanggal_datang', l: 'Tanggal Datang', t: 'date', req: true },
      { k: 'batch', l: 'Batch', t: 'text' },
      { k: 'keterangan', l: 'Keterangan Bibit', t: 'text' },
      { k: 'klon', l: 'Klon', t: 'text', sug: ['Moka', 'G9', 'Cavendish'] },
      { k: 'umur_datang_bln', l: 'Umur Saat Datang (bln)', t: 'num' },
      { k: 'qty_datang', l: 'Qty Datang', t: 'int', req: true },
      { k: 'afkir', l: 'Afkir', t: 'int' },
      { k: 'splitting', l: 'Tambahan Splitting', t: 'int' },
      { k: 'mortal', l: 'Mortal (total)', t: 'int' },
      { k: 'ditanam', l: 'Sudah Ditanam', t: 'int' },
      { k: 'saldo', l: 'Saldo', t: 'calc', fmt: 'int', fn: (r) => n(r.qty_datang) - n(r.afkir) + n(r.splitting) - n(r.mortal) - n(r.ditanam) },
      { k: 'pct_mortal', l: '% Mortal', t: 'calc', fmt: 'pct', fn: (r) => (n(r.qty_datang) ? (n(r.afkir) + n(r.mortal)) / n(r.qty_datang) : null) },
      { k: 'umur_kini', l: 'Umur Kini (bln)', t: 'calc', fmt: 'num1', fn: (r) => (r.tanggal_datang ? n(r.umur_datang_bln) + daysSince(r.tanggal_datang) / 30.44 : null) },
      { k: 'harga_satuan', l: 'Harga/Bibit', t: 'money' },
    ],
  },
  pisang_kegiatan: {
    title: 'Kegiatan Kebun', div: 'pisang', date: 'tanggal', sort: '-tanggal',
    desc: 'Kegiatan harian per blok: HK, bahan yang dipakai, biaya.',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'blok', l: 'Blok', t: 'ref', ref: 'pisang_blok' },
      { k: 'kegiatan', l: 'Kegiatan', t: 'select', opt: KEGIATAN_PISANG, req: true },
      { k: 'hk', l: 'HK', t: 'num' },
      { k: 'bahan', l: 'Bahan', t: 'text' },
      { k: 'qty', l: 'Qty Bahan', t: 'num' },
      { k: 'satuan', l: 'Satuan', t: 'text', sug: ['kg', 'liter', 'sak', 'pcs', 'roll'] },
      { k: 'biaya', l: 'Biaya (Rp)', t: 'money' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  pisang_penjualan: {
    title: 'Penjualan', div: 'pisang', date: 'tanggal', sort: '-tanggal', lengkapi: lengkapiJual,
    desc: 'Penjualan per baris surat jalan. Cukup isi Jenis Barang (mis. "PISANG CAVENDISH FH A MATANG") ATAU pilih Bentuk/Kelas/Kondisi — sisanya terisi otomatis. Tipe "Mutasi Internal" (kirim ke gudang ripening sendiri) dan "Ongkir" tidak dihitung sebagai penjualan pisang.',
    f: [
      { k: 'tanggal', l: 'Tanggal SJ', t: 'date', req: true },
      { k: 'no_sj', l: 'No. Surat Jalan', t: 'text' },
      { k: 'gudang', l: 'Asal Gudang', t: 'text', sug: ['TGL', 'SMG'] },
      { k: 'pembeli', l: 'Pembeli', t: 'text' },
      { k: 'tipe', l: 'Tipe', t: 'select', opt: TIPE_JUAL, req: true, hint: 'Boleh dikosongkan: terbaca dari Jenis Barang (ONGKIR/RETUR/SAMPEL), selain itu Penjualan' },
      { k: 'jenis_barang', l: 'Jenis Barang', t: 'text', sembunyi: true, hint: 'Isi ini SAJA (mis. pisang cavendish fh a matang) → Bentuk/Kelas/Kondisi terisi otomatis; atau pilih Bentuk/Kelas/Kondisi → kolom ini terisi otomatis' },
      { k: 'bentuk', l: 'Bentuk', t: 'select', opt: ['FH', 'CL', 'SL'] },
      { k: 'kelas', l: 'Kelas', t: 'select', opt: ['A', 'B', 'C', 'MIX', 'Reject'] },
      { k: 'kondisi', l: 'Kondisi', t: 'select', opt: ['Matang', 'Mentah', 'Reject'] },
      { k: 'jumlah_box', l: 'Qty (Box)', t: 'int' },
      { k: 'berat_kg', l: 'Berat (kg)', t: 'num' },
      { k: 'harga', l: 'Harga @', t: 'money' },
      { k: 'nominal', l: 'Nominal (Rp)', t: 'money', hint: 'Kosongkan untuk dihitung otomatis: harga × box (atau × kg bila box kosong)' },
      { k: 'total', l: 'Total (Rp)', t: 'calc', fmt: 'money', fn: (r) => nominalJual(r) },
      { k: 'dibayar', l: 'Sudah Dibayar (Rp)', t: 'money' },
      { k: 'piutang', l: 'Piutang', t: 'calc', fmt: 'money', fn: (r) => nominalJual(r) - n(r.dibayar) },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },

  // ------------------------------------------------------------ PADI
  padi_benih: {
    title: 'Stok Benih', div: 'padi', date: 'tanggal', sort: '-tanggal',
    desc: 'Mutasi benih padi: Masuk (beli/terima) menambah stok, Pakai (semai) & Afkir mengurangi stok. Stok dihitung per varietas.',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'varietas', l: 'Varietas', t: 'text', req: true, sug: ['Inpari 32', 'Inpari 42', 'Ciherang', 'IR64', 'Mekongga', 'Situ Bagendit', 'Cakrabuana'] },
      { k: 'jenis', l: 'Jenis Mutasi', t: 'select', opt: ['Masuk', 'Pakai', 'Afkir'], req: true },
      { k: 'qty_kg', l: 'Jumlah (kg)', t: 'num', req: true },
      { k: 'kelas_benih', l: 'Kelas Benih', t: 'select', opt: ['BS', 'FS', 'SS', 'ES', 'Lainnya'] },
      { k: 'untuk', l: 'Untuk Petak · Musim', t: 'ref', ref: 'padi_tanam', hint: 'Diisi bila jenis = Pakai' },
      { k: 'sumber', l: 'Sumber / Pemasok', t: 'text' },
      { k: 'harga_kg', l: 'Harga/kg', t: 'money' },
      { k: 'saldo_varietas', l: 'Stok Varietas Ini', t: 'calc', fmt: 'num', fn: (r, c) => stokBenih(c, r.varietas) },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  padi_petak: {
    title: 'Petak Sawah', div: 'padi', display: 'nama_petak', sort: 'nama_petak',
    desc: 'Data induk petak sawah (tetap). Nama petak dipakai untuk menghubungkan ke peta.',
    f: [
      { k: 'nama_petak', l: 'Nama Petak', t: 'text', req: true },
      { k: 'lokasi', l: 'Lokasi / Hamparan', t: 'text' },
      { k: 'luas_ha', l: 'Luas (ha)', t: 'num' },
      { k: 'status', l: 'Status', t: 'select', opt: ['Sudah Tanam', 'Belum Tanam', 'Olah Lahan', 'Sudah Panen', 'Bera'] },
      { k: 'sumber_air', l: 'Sumber Air', t: 'select', opt: ['Irigasi Teknis', 'Irigasi ½ Teknis', 'Sumur / Pompa', 'Tadah Hujan'] },
      { k: 'keterangan', l: 'Keterangan', t: 'area' },
    ],
  },
  padi_tanam: {
    title: 'Musim Tanam', div: 'padi', sort: '-tgl_tanam',
    display: (r) => `${r.petak || '?'} · ${r.musim || ''} ${r.tahun || ''}`.trim(),
    desc: 'Satu baris = satu petak dalam satu musim tanam. Fase dihitung otomatis dari tanggal tanam & umur panen varietas.',
    f: [
      { k: 'petak', l: 'Petak', t: 'ref', ref: 'padi_petak', req: true },
      { k: 'musim', l: 'Musim', t: 'select', opt: ['MT1', 'MT2', 'MT3'], req: true },
      { k: 'tahun', l: 'Tahun', t: 'int', req: true },
      { k: 'varietas', l: 'Varietas', t: 'text', sug: ['Inpari 32', 'Inpari 42', 'Ciherang', 'IR64', 'Mekongga', 'Situ Bagendit', 'Cakrabuana'] },
      { k: 'luas_tanam_ha', l: 'Luas Tanam (ha)', t: 'num' },
      { k: 'tgl_semai', l: 'Tgl Semai', t: 'date' },
      { k: 'tgl_tanam', l: 'Tgl Tanam', t: 'date' },
      { k: 'umur_panen_hst', l: 'Umur Panen (HST)', t: 'int', hint: 'Umur varietas (HSS) dikurangi umur bibit. Contoh Inpari 32: ±120 HSS − 20 = 100 HST' },
      { k: 'sistem', l: 'Sistem Tanam', t: 'select', opt: ['Jajar Legowo 2:1', 'Jajar Legowo 4:1', 'Tegel', 'Tabela', 'Lainnya'] },
      { k: 'hst', l: 'HST', t: 'calc', fmt: 'int', fn: (r) => (r.tgl_tanam ? daysSince(r.tgl_tanam) : null) },
      { k: 'fase', l: 'Fase', t: 'calc', fmt: 'text', fn: (r, c) => padiFase(r, c) },
      { k: 'est_panen', l: 'Estimasi Panen', t: 'calc', fmt: 'date', fn: (r) => (r.tgl_tanam ? util.addDays(r.tgl_tanam, n(r.umur_panen_hst) || 100) : '') },
      { k: 'gkp_ton', l: 'Hasil GKP (ton)', t: 'calc', fmt: 'num2', fn: (r, c) => sumBy(c, 'padi_panen', 'musim_tanam', padiKey(r), 'gkp_kg') / 1000 },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  padi_kegiatan: {
    title: 'Kegiatan Budidaya', div: 'padi', date: 'tanggal', sort: '-tanggal',
    desc: 'Kegiatan harian per musim tanam: HK, bahan, biaya.',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'musim_tanam', l: 'Petak · Musim', t: 'ref', ref: 'padi_tanam' },
      { k: 'kegiatan', l: 'Kegiatan', t: 'select', opt: KEGIATAN_PADI, req: true },
      { k: 'hk', l: 'HK', t: 'num' },
      { k: 'bahan', l: 'Bahan', t: 'text', sug: ['Urea', 'NPK Phonska', 'SP-36', 'ZA', 'KCl', 'Organik'] },
      { k: 'qty', l: 'Qty Bahan', t: 'num' },
      { k: 'satuan', l: 'Satuan', t: 'text', sug: ['kg', 'liter', 'sak'] },
      { k: 'biaya', l: 'Biaya (Rp)', t: 'money' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  padi_opt: {
    title: 'Pengamatan OPT', div: 'padi', date: 'tanggal', sort: '-tanggal',
    desc: 'Serangan hama/penyakit (Organisme Pengganggu Tanaman) dan tindakannya.',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'musim_tanam', l: 'Petak · Musim', t: 'ref', ref: 'padi_tanam', req: true },
      { k: 'jenis_opt', l: 'Jenis OPT', t: 'select', opt: OPT_PADI, req: true },
      { k: 'intensitas_pct', l: 'Intensitas (%)', t: 'num' },
      { k: 'luas_serangan_ha', l: 'Luas Serangan (ha)', t: 'num' },
      { k: 'kategori', l: 'Kategori', t: 'calc', fmt: 'text', fn: (r) => { const v = n(r.intensitas_pct); return !r.intensitas_pct ? '' : v < 25 ? 'Ringan' : v < 50 ? 'Sedang' : v < 90 ? 'Berat' : 'Puso'; } },
      { k: 'tindakan', l: 'Tindakan', t: 'text' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  padi_rencana: {
    title: 'Rencana Kerja Mingguan', div: 'padi', date: 'mulai', sort: '-mulai',
    desc: 'Rencana & realisasi kerja mingguan divisi padi (format sama dengan Excel "Laporan mingguan Padi"): satu baris per aktivitas per petak. Baris dengan Pekerjaan "Catatan" = keterangan umum minggu itu. Dipakai Laporan Owner (realisasi minggu ini & rencana minggu depan).',
    f: [
      { k: 'mulai', l: 'Minggu Mulai', t: 'date', req: true },
      { k: 'selesai', l: 'Minggu Selesai', t: 'date', req: true },
      { k: 'minggu_ke', l: 'Minggu ke', t: 'int' },
      { k: 'pekerjaan', l: 'Pekerjaan', t: 'text', sug: ['Perawatan padi', 'Panen dan Pascapanen', 'Olah lahan', 'Persemaian', 'Tanam', 'Catatan'] },
      { k: 'aktivitas', l: 'Aktivitas', t: 'text', req: true, sug: ['Jaga Burung dan Irigasi', 'Spray Pestisida', 'Pemasangan tali dan jaring burung', 'Pemupukan', 'Penyiangan', 'Arit manual', 'Perontokan Gabah', 'Penjemuran'] },
      { k: 'petak', l: 'Petak', t: 'ref', ref: 'padi_petak' },
      { k: 'rencana', l: 'Rencana', t: 'num' },
      { k: 'satuan', l: 'Satuan', t: 'select', opt: ['ha', 'kg', 'HK'] },
      { k: 'realisasi', l: 'Realisasi', t: 'num' },
      { k: 'capaian', l: '% Capaian', t: 'calc', fmt: 'pct', fn: (r) => (n(r.rencana) && r.realisasi != null && r.realisasi !== '' ? n(r.realisasi) / n(r.rencana) : null) },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  padi_panen: {
    title: 'Panen Padi', div: 'padi', date: 'tanggal', sort: '-tanggal',
    desc: 'Catatan panen per petak. Arsip lama tanpa tanggal tetap disimpan dan ditampilkan terpisah dari hasil periode.',
    f: [

      { k: 'tanggal', l: 'Tanggal Panen', t: 'date', hint: 'Isi untuk panen baru; arsip lama tanpa tanggal tidak masuk angka periode.' },
      { k: 'musim_tanam', l: 'Petak · Musim', t: 'ref', ref: 'padi_tanam' },     { k: 'petak', l: 'Petak / Blok', t: 'ref', ref: 'padi_petak', req: true },
      { k: 'luas_blok', l: 'Luas Blok (ha)', t: 'calc', fmt: 'num2', fn: (r, c) => luasPetak(c, r.petak) },
      { k: 'jumlah_karung', l: 'Jumlah Karung', t: 'int' },
      { k: 'gkp_kg', l: 'Berat Gabah / GKP (kg)', t: 'num', req: true },
      { k: 'kg_karung', l: 'Rata-rata kg/karung', t: 'calc', fmt: 'num2', fn: (r) => (n(r.jumlah_karung) ? n(r.gkp_kg) / n(r.jumlah_karung) : null) },
      { k: 'ton_ha', l: 'Hasil (ton/ha)', t: 'calc', fmt: 'num2', fn: (r, c) => { const l = luasPetak(c, r.petak); return l ? n(r.gkp_kg) / 1000 / l : null; } },
      { k: 'detail_timbang', l: 'Rincian timbang (kg)', t: 'text', hint: 'Pisahkan tiap penimbangan dengan titik koma.' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  padi_giling: {
    title: 'Penggilingan / Beras Masuk', div: 'padi', date: 'tanggal', sort: '-tanggal',
    desc: 'Beras hasil giling yang masuk gudang. Stok beras = beras masuk − beras keluar (penjualan, sampel; kirim ke gudang sendiri tidak dihitung keluar).',
    f: [
      { k: 'tanggal', l: 'Tanggal Masuk Gudang', t: 'date', req: true },
      { k: 'gudang', l: 'Gudang', t: 'text', sug: ['Gudang PH Tegal', 'Kantor Semarang'] },
      { k: 'beras_kg', l: 'Beras Masuk (kg)', t: 'num', req: true },
      { k: 'gabah_kg', l: 'Gabah Digiling (kg)', t: 'num' },
      { k: 'rendemen', l: 'Rendemen', t: 'calc', fmt: 'pct', fn: (r) => (n(r.gabah_kg) ? n(r.beras_kg) / n(r.gabah_kg) : null) },
      { k: 'sumber_panen', l: 'Dari Panen', t: 'text', hint: 'mis. P1–P3 tanaman ke-1' },
      { k: 'tempat_giling', l: 'Tempat Giling', t: 'text' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  padi_penjualan: {
    title: 'Penjualan / Mutasi Padi', div: 'padi', date: 'tanggal', sort: '-tanggal',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'petak', l: 'Petak / Blok', t: 'ref', ref: 'padi_petak' },
      { k: 'detail_timbang', l: 'Rincian timbang (kg)', t: 'text' },
      { k: 'no_sj', l: 'No. Surat Jalan', t: 'text' },
      { k: 'pembeli', l: 'Pembeli / Tujuan', t: 'text' },
      { k: 'tipe', l: 'Tipe', t: 'select', opt: TIPE_JUAL },
      { k: 'jenis', l: 'Jenis', t: 'select', opt: ['GKP', 'GKG', 'Beras', 'Dedak/Lainnya'] },
      { k: 'jumlah_sak', l: 'Qty (sak/box)', t: 'int' },
      { k: 'berat_kg', l: 'Berat (kg)', t: 'num', req: true },
      { k: 'harga_kg', l: 'Harga/kg', t: 'money' },
      { k: 'nominal', l: 'Nominal (Rp)', t: 'money', hint: 'Kosongkan untuk dihitung otomatis: berat × harga' },
      { k: 'total', l: 'Total (Rp)', t: 'calc', fmt: 'money', fn: (r) => (r.nominal != null && r.nominal !== '' ? n(r.nominal) : n(r.berat_kg) * n(r.harga_kg)) },
      { k: 'dibayar', l: 'Sudah Dibayar (Rp)', t: 'money' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },

  // ------------------------------------------------------------ INFRASTRUKTUR
  infra_proyek: {
    title: 'Proyek Infrastruktur', div: 'lahan', display: 'nama_proyek', sort: 'nama_proyek',
    desc: 'Pekerjaan infrastruktur kebun: jalan, saluran, embung, sumur bor, jembatan, bangunan. Progres dihitung dari tabel Progres Proyek.',
    f: [
      { k: 'nama_proyek', l: 'Nama Proyek', t: 'text', req: true },
      { k: 'jenis', l: 'Jenis', t: 'select', opt: ['Jalan', 'Saluran / Drainase', 'Irigasi', 'Embung', 'Sumur Bor', 'Jembatan', 'Bangunan', 'Pagar', 'Lainnya'] },
      { k: 'lokasi', l: 'Lokasi', t: 'text' },
      { k: 'untuk_divisi', l: 'Untuk Divisi', t: 'select', opt: ['Pisang', 'Padi', 'Umum'] },
      { k: 'tgl_mulai', l: 'Tgl Mulai', t: 'date' },
      { k: 'target_selesai', l: 'Target Selesai', t: 'date' },
      { k: 'volume_target', l: 'Volume Target', t: 'num' },
      { k: 'satuan', l: 'Satuan', t: 'text', sug: ['m', 'm²', 'm³', 'unit', '%'] },
      { k: 'anggaran', l: 'Anggaran (Rp)', t: 'money' },
      { k: 'status', l: 'Status', t: 'select', opt: ['Rencana', 'Berjalan', 'Selesai', 'Tertunda'] },
      { k: 'progres', l: 'Progres', t: 'calc', fmt: 'pct', fn: (r, c) => (n(r.volume_target) ? sumBy(c, 'infra_progress', 'proyek', r.nama_proyek, 'volume') / n(r.volume_target) : null) },
      { k: 'realisasi', l: 'Realisasi Biaya', t: 'calc', fmt: 'money', fn: (r, c) => sumBy(c, 'infra_progress', 'proyek', r.nama_proyek, 'biaya') },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  infra_progress: {
    title: 'Progres Proyek', div: 'lahan', date: 'tanggal', sort: '-tanggal',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'proyek', l: 'Proyek', t: 'ref', ref: 'infra_proyek', req: true },
      { k: 'volume', l: 'Volume Hari Ini', t: 'num' },
      { k: 'biaya', l: 'Biaya (Rp)', t: 'money' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },

  // ------------------------------------------------------------ PEMBUKAAN LAHAN
  lahan_blok: {
    title: 'Rencana Blok Lahan', div: 'lahan', display: 'blok', sort: 'blok',
    desc: 'Blok yang akan dibuka / disiapkan. Progres tiap aktivitas dihitung dari Progres Harian.',
    f: [
      { k: 'blok', l: 'Blok', t: 'text', req: true },
      { k: 'kepemilikan', l: 'Kepemilikan terverifikasi', t: 'select', opt: ['Sudah milik kebun', 'Belum milik kebun', 'Belum diverifikasi'], hint: 'Daily Report hanya menampilkan blok yang sudah milik kebun.' },
      { k: 'luas_ha', l: 'Luas (ha)', t: 'num', req: true },
      { k: 'peruntukan', l: 'Peruntukan', t: 'select', opt: ['Pisang', 'Padi', 'Lainnya'] },
      { k: 'tahap', l: 'Tahap', t: 'select', opt: ['Tahap I', 'Tahap II', 'Tahap III', 'Tahap IV'] },
      { k: 'wilayah', l: 'Wilayah', t: 'text' },
      { k: 'target_tanam', l: 'Target Tanam', t: 'date' },
      { k: 'tanam_sebelumnya', l: 'Sudah Tanam Sebelum Pencatatan', t: 'select', opt: ['Ya'], hint: 'Pilih "Ya" untuk blok yang sudah ditanam sebelum progres harian dicatat — semua tahap dihitung selesai (100%).' },
      { k: 'tahap_terakhir', l: 'Aktivitas Terakhir Selesai', t: 'calc', fmt: 'text', fn: (r, c) => lahanProgress(r, c).last },
      { k: 'progres', l: 'Progres Total', t: 'calc', fmt: 'pct', fn: (r, c) => lahanProgress(r, c).total },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  lahan_harian: {
    title: 'Progres Harian', div: 'lahan', date: 'tanggal', sort: '-tanggal',
    desc: 'Hasil kerja harian (ha) per aktivitas per blok.',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'aktivitas', l: 'Aktivitas', t: 'ref', ref: 'lahan_aktivitas', req: true },
      { k: 'blok', l: 'Blok', t: 'ref', ref: 'lahan_blok', req: true },
      { k: 'hasil_ha', l: 'Hasil (ha)', t: 'num', req: true },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  lahan_target: {
    title: 'Target Tanam', div: 'lahan', date: 'bulan', sort: 'bulan',
    desc: 'Target bulan selesai tanam per blok (dipakai halaman Tim Kebun /kebun). Semua kegiatan blok itu (LC s/d Tanam) ditargetkan selesai paling lambat akhir bulan tsb.',
    f: [
      { k: 'blok', l: 'Blok', t: 'ref', ref: 'lahan_blok', req: true },
      { k: 'bulan', l: 'Target Bulan Tanam', t: 'date', req: true, hint: 'Isi tanggal berapa saja di bulan target (mis. 1/11/2026) — yang dipakai bulannya.' },
      { k: 'prioritas', l: 'Prioritas', t: 'int', hint: 'Kosong = biasa. Angka lebih besar = dikerjakan belakangan (mis. 9 = paling akhir): alat/tim baru mengerjakan blok ini setelah blok lain selesai di kegiatan itu.' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  lahan_aktivitas: {
    title: 'Urutan Aktivitas', div: 'lahan', display: 'aktivitas', sort: 'urutan',
    desc: 'Urutan tahapan persiapan lahan. Bisa ditambah/diubah sesuai kebutuhan (mis. untuk sawah).',
    f: [
      { k: 'untuk', l: 'Untuk Komoditas', t: 'select', opt: ['Pisang', 'Padi', 'Semua'], req: true },
      { k: 'urutan', l: 'Urutan', t: 'int', req: true },
      { k: 'aktivitas', l: 'Aktivitas', t: 'text', req: true },
      { k: 'hari_per_ha', l: 'Hari Kerja per Ha', t: 'num', hint: 'Kecepatan 1 tim (dipakai menyusun Rencana Kerja). Kosong = dihitung dari Progres Harian (jumlah hari aktif ÷ total ha).' },
      { k: 'tim', l: 'Jumlah Tim', t: 'int', hint: 'Kosong = 1 tim.' },
      { k: 'libur', l: 'Hari Libur', t: 'select', opt: ['Minggu', 'Sabtu & Minggu'], hint: 'Kosong: Land Clearing & Bajak = Sabtu & Minggu, kegiatan lain = Minggu.' },
      { k: 'rute', l: 'Urutan Blok', t: 'select', opt: ['Prioritas tanam', 'Blok terdekat'], hint: 'Prioritas tanam (kosong) = blok yang paling dekat jadwal tanamnya dulu. Blok terdekat = alat/tim pindah ke blok terdekat di peta (rotasi alat lebih mudah).' },
      { k: 'alat', l: 'Alat Dipakai', t: 'text', hint: 'Kegiatan dengan nama alat sama memakai 1 alat bergantian & tidak bisa bersamaan (mis. Bajak 1 & Bajak 2 = "Traktor Bajak"). Kosong = tim sendiri.' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  lahan_rencana: {
    title: 'Rencana Kerja', div: 'lahan', date: 'mulai', sort: 'urutan',
    desc: 'Jadwal kerja per blok & kegiatan sampai semua blok target tertanam — disusun dari progres saat itu, kecepatan & hari libur di Urutan Aktivitas (tombol "Susun rencana kerja" di halaman Progres Tanam). Realisasi dibandingkan otomatis dari Progres Harian.',
    f: [
      { k: 'urutan', l: 'Prioritas Blok', t: 'int' },
      { k: 'blok', l: 'Blok', t: 'ref', ref: 'lahan_blok', req: true },
      { k: 'aktivitas', l: 'Aktivitas', t: 'ref', ref: 'lahan_aktivitas', req: true },
      { k: 'luas_ha', l: 'Luas Rencana (ha)', t: 'num', req: true },
      { k: 'mulai', l: 'Mulai', t: 'date', req: true },
      { k: 'selesai', l: 'Selesai', t: 'date', req: true },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },

  // ------------------------------------------------------------ IKLIM
  iklim: {
    title: 'Data Iklim (per 2 jam)', div: 'iklim', date: 'tanggal', sort: '-tanggal',
    desc: 'Catatan stasiun cuaca VIGU Farm. Hujan = angka kumulatif harian dari alat (hujan harian = angka terbesar hari itu). Suhu & kelembapan harian dihitung dari sensor luar (outdoor).',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'jam', l: 'Jam', t: 'text', time: true, req: true, hint: 'Format JJ:MM, mis. 14:00' },
      { k: 'angin_ms', l: 'Angin (m/s)', t: 'num' },
      { k: 'arah', l: 'Arah Angin', t: 'text', sug: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] },
      { k: 'hujan_mm', l: 'Hujan (mm)', t: 'num' },
      { k: 'suhu_dalam', l: 'Suhu Dalam (°C)', t: 'num' },
      { k: 'lembap_dalam', l: 'Kelembapan Dalam (%)', t: 'num' },
      { k: 'suhu_luar', l: 'Suhu Luar (°C)', t: 'num' },
      { k: 'lembap_luar', l: 'Kelembapan Luar (%)', t: 'num' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },

  // ------------------------------------------------------------ GIS
  gis_titik: {
    title: 'Titik Lokasi', div: 'gis', display: 'nama', sort: 'nama',
    desc: 'Titik penting di peta (sumur, pompa, gudang, PH, pos jaga). Bisa ditambah langsung dengan klik di peta.',
    f: [
      { k: 'nama', l: 'Nama', t: 'text', req: true },
      { k: 'kategori', l: 'Kategori', t: 'select', opt: ['Sumur Bor', 'Pompa', 'Embung', 'Packing House', 'Gudang', 'Kantor', 'Pos Jaga', 'Workshop', 'Nursery', 'Catatan', 'Lainnya'] },
      { k: 'lat', l: 'Latitude', t: 'num' },
      { k: 'lng', l: 'Longitude', t: 'num' },
      { k: 'keterangan', l: 'Keterangan', t: 'text' },
    ],
  },
  gis_layer: {
    title: 'Layer Peta', div: 'gis', hidden: true,
    f: [
      { k: 'nama', l: 'Nama Layer', t: 'text', req: true },
      { k: 'jenis', l: 'Jenis', t: 'text' },
      { k: 'link_tabel', l: 'Hubungkan ke', t: 'text' },
      { k: 'field_nama', l: 'Kolom Nama Blok', t: 'text' },
      { k: 'warna', l: 'Warna', t: 'text' },
      { k: 'urutan', l: 'Urutan', t: 'int' },
      { k: 'tampil', l: 'Tampil', t: 'int' },
      { k: 'gaya', l: 'Gaya (JSON)', t: 'text' },
      { k: 'geojson', l: 'GeoJSON', t: 'text' },
    ],
  },

  // ------------------------------------------------------------ DAILY REPORT
  // Ditampilkan lewat halaman khusus. Tetap masuk schema agar migrasi lama -> baru
  // hanya menambah tabel/kolom dan tidak menyentuh data kebun yang sudah ada.
  daily_report: {
    title: 'Daily Report', div: 'daily', date: 'tanggal', sort: '-tanggal', hidden: true,
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'divisi', l: 'Divisi', t: 'select', opt: ['Pisang', 'Padi', 'Infra'], req: true },
      { k: 'mandor', l: 'Mandor (data lama)', t: 'text' },
      { k: 'siklus', l: 'Siklus / Periode', t: 'text' },
      { k: 'status', l: 'Status', t: 'select', opt: ['Draf', 'Rencana Dikirim', 'Selesai'], req: true },
      { k: 'apel_mulai', l: 'Apel Mulai', t: 'text' },
      { k: 'apel_selesai', l: 'Apel Selesai', t: 'text' },
      { k: 'apel_hadir', l: 'Hadir Apel (HK)', t: 'int' },
      { k: 'apel_catatan', l: 'Catatan Apel', t: 'area' },
      { k: 'kendala', l: 'Kendala', t: 'area' },
      { k: 'tindak_lanjut', l: 'Tindak Lanjut', t: 'area' },
      { k: 'dikirim_at', l: 'Dikirim', t: 'text' },
      { k: 'rencana_at', l: 'Rencana Dikirim', t: 'text' },
      { k: 'selesai_at', l: 'Laporan Selesai', t: 'text' },
      { k: 'dibuat_oleh', l: 'Dibuat Oleh', t: 'text' },
    ],
  },
  daily_week_plan: {
    title: 'Rencana Mingguan Daily Report', div: 'daily', sort: '-week_start', hidden: true,
    f: [
      { k: 'week_start', l: 'Awal Minggu', t: 'date', req: true },
      { k: 'week_end', l: 'Akhir Minggu', t: 'date', req: true },
      { k: 'divisi', l: 'Divisi', t: 'select', opt: ['Pisang', 'Padi', 'Infra'], req: true },
      { k: 'status', l: 'Status', t: 'select', opt: ['Draf', 'Dikirim'], req: true },
      { k: 'catatan', l: 'Catatan', t: 'area' },
      { k: 'dikirim_at', l: 'Dikirim', t: 'text' },
      { k: 'dibuat_oleh', l: 'Dibuat Oleh', t: 'text' },
    ],
  },
  daily_week_item: {
    title: 'Kegiatan Rencana Mingguan', div: 'daily', sort: 'urutan', hidden: true,
    f: [
      { k: 'plan_id', l: 'ID Rencana', t: 'int', req: true },
      { k: 'urutan', l: 'Urutan', t: 'int' },
      { k: 'blok', l: 'Blok / Lokasi', t: 'text', req: true },
      { k: 'aktivitas', l: 'Aktivitas', t: 'text', req: true },
      { k: 'target', l: 'Target Mingguan', t: 'num' },
      { k: 'satuan', l: 'Satuan', t: 'text' },
      { k: 'hk_rencana', l: 'HK Rencana', t: 'num' },
      { k: 'keterangan', l: 'Keterangan', t: 'area' },
    ],
  },
  daily_item: {
    title: 'Rencana & Realisasi Daily Report', div: 'daily', sort: 'urutan', hidden: true,
    f: [
      { k: 'report_id', l: 'ID Laporan', t: 'int', req: true },
      { k: 'plan_item_id', l: 'ID Kegiatan Rencana', t: 'int' },
      { k: 'di_luar_rencana', l: 'Di Luar Rencana', t: 'int' },
      { k: 'urutan', l: 'Urutan', t: 'int' },
      { k: 'aktivitas', l: 'Aktivitas', t: 'text', req: true },
      { k: 'blok', l: 'Blok / Lokasi', t: 'text' },
      { k: 'target', l: 'Rencana', t: 'num' },
      { k: 'realisasi', l: 'Hasil Kerja', t: 'num' },
      { k: 'hasil_sdhi', l: 'SDHI', t: 'num' },
      { k: 'satuan', l: 'Satuan', t: 'text' },
      { k: 'hk_rencana', l: 'HK Rencana', t: 'num' },
      { k: 'hk_realisasi', l: 'HK Realisasi', t: 'num' },
      { k: 'alat', l: 'Alat / Kendaraan', t: 'text' },
      { k: 'meter_awal', l: 'HM/KM Awal', t: 'num' },
      { k: 'meter_akhir', l: 'HM/KM Akhir', t: 'num' },
      { k: 'ritase', l: 'Ritase', t: 'num' },
      { k: 'keterangan', l: 'Keterangan', t: 'area' },
    ],
  },
  daily_photo: {
    title: 'Foto Daily Report', div: 'daily', sort: '-created_at', hidden: true,
    f: [
      { k: 'report_id', l: 'ID Laporan', t: 'int', req: true },
      { k: 'jenis', l: 'Jenis Foto', t: 'select', opt: ['Apel', 'Kegiatan', 'Kendala'] },
      { k: 'caption', l: 'Keterangan', t: 'text' },
      { k: 'storage', l: 'Penyimpanan', t: 'text' },
      { k: 'lokasi', l: 'Lokasi File', t: 'text' },
      { k: 'thumb_lokasi', l: 'File Thumbnail', t: 'text' },
      { k: 'thumb_storage', l: 'Penyimpanan Thumbnail', t: 'text' },
      { k: 'content_hash', l: 'Sidik Berkas', t: 'text' },
      { k: 'mime', l: 'Tipe File', t: 'text' },
      { k: 'ukuran', l: 'Ukuran (byte)', t: 'int' },
      { k: 'expires_at', l: 'Kedaluwarsa', t: 'text' },
      { k: 'deleted_at', l: 'Dihapus', t: 'text' },
    ],
  },
};

// ------------------------------------------------------------ EXCEL INPUT
// Sheet di file "Input Data Kebun.xlsx". Urutan = urutan proses (induk dulu). omit = kolom yang tidak ditampilkan.
export const EXCEL_SHEETS = [
  { sheet: 'Pisang - Blok Tanam', table: 'pisang_blok' },
  { sheet: 'Pisang - Stok Bibit', table: 'pisang_bibit' },
  { sheet: 'Pisang - Panen PKK', table: 'pisang_panen_pkk' },
  { sheet: 'Pisang - Box Panen', table: 'pisang_box' },
  { sheet: 'Pisang - Estimasi Panen', table: 'pisang_estimasi' },
  { sheet: 'Pisang - Hand Class', table: 'pisang_handclass' },
  { sheet: 'Pisang - Penjualan', table: 'pisang_penjualan' },
  { sheet: 'Padi - Blok Padi', table: 'padi_petak' },
  { sheet: 'Padi - Stok Benih', table: 'padi_benih', omit: ['untuk'] },
  { sheet: 'Padi - Panen', table: 'padi_panen', omit: ['musim_tanam'] },
  { sheet: 'Padi - Beras Masuk', table: 'padi_giling' },
  { sheet: 'Padi - Rencana Mingguan', table: 'padi_rencana' },
  { sheet: 'Padi - Penjualan Beras', table: 'padi_penjualan' },
  { sheet: 'Progres - Urutan Tahap', table: 'lahan_aktivitas' },
  { sheet: 'Progres - Rencana Blok', table: 'lahan_blok' },
  { sheet: 'Progres - Harian', table: 'lahan_harian' },
  { sheet: 'Progres - Target Tanam', table: 'lahan_target' },
  { sheet: 'Progres - Rencana Kerja', table: 'lahan_rencana' },
  { sheet: 'Iklim - Data 2 Jam', table: 'iklim' },
];

// ------------------------------------------------------------ PERAN PENGGUNA
// Semua pengguna yang login bisa MELIHAT semua data. `edit` = tabel yang boleh diubah.
// Satu pengguna boleh punya beberapa peran (izinnya digabung).
export const ROLES = {
  admin: { label: 'Admin', desc: 'Semua data, pengguna, peta, backup', edit: '*' },
  management: { label: 'Management / Owner', desc: 'Hanya melihat & export laporan', edit: [] },
  penjualan: { label: 'Penjualan', desc: 'Penjualan pisang & beras saja (surat jalan, harga, pembayaran)', edit: ['pisang_penjualan', 'padi_penjualan'] },
  panen_pisang: { label: 'Panen Pisang', desc: 'Panen PKK, box PH, estimasi panen, hand class', edit: ['pisang_panen_pkk', 'pisang_box', 'pisang_estimasi', 'pisang_handclass'] },
  panen_padi: { label: 'Panen Padi', desc: 'Panen padi & penggilingan (beras masuk)', edit: ['padi_panen', 'padi_giling'] },
  kebun_pisang: { label: 'Kebun Pisang', desc: 'Blok, bibit, kegiatan pisang', edit: ['pisang_blok', 'pisang_bibit', 'pisang_kegiatan'] },
  kebun_padi: { label: 'Kebun Padi', desc: 'Stok benih, petak, musim tanam, kegiatan, OPT', edit: ['padi_benih', 'padi_petak', 'padi_tanam', 'padi_kegiatan', 'padi_opt', 'padi_rencana'] },
  lahan: { label: 'Progres Tanam / Pembukaan Lahan', desc: 'Progres LC/bajak/tanam pisang & padi', edit: ['lahan_blok', 'lahan_harian', 'lahan_target', 'lahan_aktivitas', 'lahan_rencana'] },
  gis: { label: 'GIS', desc: 'Layer peta, catatan peta, titik lokasi', edit: ['gis_layer', 'gis_titik'] },
  iklim: { label: 'Iklim', desc: 'Data stasiun cuaca', edit: ['iklim'] },
  daily_pisang: { label: 'Daily Report — Pisang', desc: 'Input Daily Report divisi Pisang', edit: [] },
  daily_padi: { label: 'Daily Report — Padi', desc: 'Input Daily Report divisi Padi', edit: [] },
  daily_infra: { label: 'Daily Report — Infra', desc: 'Input Daily Report divisi Infra', edit: [] },
};
export function canEdit(user, table) {
  if (!user) return false;
  return (user.peran || []).some((r) => ROLES[r] && (ROLES[r].edit === '*' || ROLES[r].edit.includes(table)));
}
export const isAdmin = (user) => !!user && (user.peran || []).includes('admin');

// Data awal (hanya diisi kalau tabel masih kosong)
// data awal yang hanya diisi SEKALI (kalau nanti sengaja dikosongkan, tidak diisi ulang)
const TARGET_Q4 = { '2026-10-01': ['D08', 'D09b', 'D03', 'D10'], '2026-11-01': ['D04', 'D14a', 'D05b', 'D11', 'D12a', 'E01a', 'E01b'],
  '2026-12-01': ['C05', 'E02a', 'E02b', 'C05b', 'A01a', 'D14b', 'E01c', 'E01d', 'E03a', 'E03c', 'E03d', 'E08'] };
export const SEED_SEKALI = {
  lahan_target: Object.entries(TARGET_Q4).flatMap(([bulan, bl]) => bl.map((blok) => ({ blok, bulan, keterangan: bulan === '2026-12-01' ? 'Tambahan ±7 ha (setelah November)' : 'Rencana Tanam Q4 2026 (v13)' }))),
};
// kecepatan awal per kegiatan pisang (hari kerja per ha, 1 tim) = timeline Estimasi Land Prep v13 (data harian Mei–Sep 2026).
// Diisi sekali ke Urutan Aktivitas bila kolomnya masih kosong; selanjutnya diubah di sana (form / Excel).
export const KECEPATAN_AWAL = { 'Land Clearing': 2.98, 'Bajak 1': 2.44, 'Dolomite': 2.12, 'Bajak 2': 1.8, 'Stik Ridger': 1.17, 'Ridger': 1.53, 'Install Drip': 2, 'Stik Tanam': 4.07, 'Ecer Pupuk': 1.83, 'Tanam': 2.51 };
export const SEED = {
  lahan_aktivitas: [
    ...['Land Clearing', 'Bajak 1', 'Dolomite', 'Bajak 2', 'Stik Ridger', 'Ridger', 'Install Drip', 'Stik Tanam', 'Ecer Pupuk', 'Tanam'].map((a, i) => ({ untuk: 'Pisang', urutan: i + 1, aktivitas: a, hari_per_ha: KECEPATAN_AWAL[a] })),
    ...PADI_AKT.map((a, i) => ({ untuk: 'Padi', urutan: i + 1, aktivitas: a })),
  ],
};

// ------------------------------------------------------------ helper hitung
export function padiKey(r) { return TABLES.padi_tanam.display(r); }

export function padiFase(r, c) {
  if (c && c.rows('padi_panen').some((x) => x.musim_tanam === padiKey(r))) return 'Sudah Panen';
  if (!r.tgl_tanam) return r.tgl_semai ? 'Persemaian' : 'Belum Tanam';
  const h = daysSince(r.tgl_tanam), U = n(r.umur_panen_hst) || 100;
  if (h < 0) return r.tgl_semai ? 'Persemaian' : 'Belum Tanam';
  if (h < U - 65) return 'Vegetatif';      // anakan s/d primordia
  if (h < U - 30) return 'Generatif';      // primordia s/d berbunga (±35 hari)
  if (h < U) return 'Pemasakan';           // berbunga s/d masak (±30 hari)
  return 'Siap Panen';
}

// urutan aktivitas untuk komoditas tertentu (Pisang / Padi); "Semua" ikut keduanya
export function aktivitasUntuk(c, kom) {
  const k = kom || 'Pisang';
  return [...c.rows('lahan_aktivitas')].filter((a) => (a.untuk || 'Pisang') === k || a.untuk === 'Semua').sort((a, b) => n(a.urutan) - n(b.urutan));
}
// rekap iklim harian dari data per 2 jam (aturan sama dengan rekap bulanan stasiun):
// suhu & kelembapan = sensor luar; hujan = angka kumulatif terbesar hari itu; arah dominan = arah paling sering
export function iklimHarian(rows) {
  const by = {};
  for (const r of rows) if (r.tanggal) (by[r.tanggal] ??= []).push(r);
  const vals = (rs, k) => rs.map((r) => r[k]).filter((v) => v != null && v !== '' && Number.isFinite(Number(v))).map(Number);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  return Object.entries(by).map(([tanggal, rs]) => {
    const t = vals(rs, 'suhu_luar'), h = vals(rs, 'lembap_luar'), w = vals(rs, 'angin_ms'), rn = vals(rs, 'hujan_mm');
    const cnt = {}; for (const r of rs) if (r.arah) cnt[r.arah] = (cnt[r.arah] || 0) + 1;
    const wmaxRow = rs.filter((r) => r.angin_ms != null).sort((a, b) => n(b.angin_ms) - n(a.angin_ms))[0];
    return { tanggal, n: rs.length, tmin: t.length ? Math.min(...t) : null, tmax: t.length ? Math.max(...t) : null, tavg: avg(t), havg: avg(h),
      hujan: rn.length ? Math.max(...rn) : null, wmax: w.length ? Math.max(...w) : null, wmaxArah: wmaxRow?.arah || null, wavg: avg(w),
      arah: Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || null };
  }).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}
export const HARI_HUJAN_MM = 1; // hari hujan = curah hujan ≥ 1 mm (definisi BMKG)

export function luasPetak(c, petak) {
  const p = c?.rows('padi_petak').find((x) => util.key(x.nama_petak) === util.key(petak));
  return p && p.luas_ha != null ? n(p.luas_ha) : null;
}
export function stokBenih(c, varietas) {
  return c.rows('padi_benih').filter((x) => !varietas || util.key(x.varietas) === util.key(varietas))
    .reduce((s, x) => s + (x.jenis === 'Masuk' ? 1 : -1) * n(x.qty_kg), 0);
}

export function lahanProgress(r, c) {
  const acts = aktivitasUntuk(c, r.peruntukan);
  const luas = n(r.luas_ha);
  // blok yang sudah ditanam sebelum pencatatan: semua tahap dianggap selesai
  if (r.tanam_sebelumnya === 'Ya') return { per: acts.map((a) => ({ akt: a.aktivitas, ha: luas, pct: 1 })), last: acts[acts.length - 1]?.aktivitas || '-', total: 1, awal: true };
  const per = acts.map((a) => {
    const done = c.rows('lahan_harian').filter((x) => util.key(x.blok) === util.key(r.blok) && x.aktivitas === a.aktivitas).reduce((s, x) => s + n(x.hasil_ha), 0);
    return { akt: a.aktivitas, ha: done, pct: luas ? Math.min(1, done / luas) : 0 };
  });
  let last = '-';
  for (const p of per) if (p.pct >= 0.98) last = p.akt;
  const total = per.length ? per.reduce((s, p) => s + p.pct, 0) / per.length : 0;
  return { per, last, total };
}

export const POKOK_PER_HA = 2000; // jarak tanam kebun: 1 ha netto = 2.000 pokok

// Blok pisang TERTANAM — satu sumber untuk Ringkasan, peta, dan halaman lain.
// Tertanam = status sudah tanam di Blok Tanam, ATAU tahap Tanam tercatat di Progres Harian.
//  • luas  (NETTO, luas ditanami): kolom Luas (ha) di Blok Tanam (= Excel); blok baru yang statusnya belum diubah →
//    pokok ÷ 2.000 bila pokok sudah diisi, kalau belum → gross ÷ rasio rata-rata (perkiraan). Dikunci maks. luas peta.
//  • gross (luas LAHAN tertanam): luas peta di Rencana Blok × % tanam (= tabel Progres kebun);
//    blok tanpa luas peta → netto × rasio rata-rata gross/netto (dihitung dari data, ±7,8%).
export function pisangTertanam(c) {
  const akt = aktivitasUntuk(c, 'Pisang').slice(-1)[0]?.aktivitas; // tahap terakhir = Tanam
  const rencana = new Map(c.rows('lahan_blok').filter((b) => (b.peruntukan || 'Pisang') === 'Pisang').map((b) => [util.key(b.blok), b]));
  const pb = new Map(c.rows('pisang_blok').filter((r) => r.tanggal_tanam && !['Bongkar', 'Belum Tanam'].includes(r.status)).map((r) => [util.key(r.nama_blok), r]));
  const semua = new Map(c.rows('pisang_blok').map((r) => [util.key(r.nama_blok), r])); // termasuk yang statusnya belum diubah
  const tglH = new Map(); // tanggal tanam pertama per blok dari progres harian
  for (const h of c.rows('lahan_harian')) if (akt && h.aktivitas === akt && h.tanggal) { const k = util.key(h.blok); if (!tglH.has(k) || h.tanggal < tglH.get(k)) tglH.set(k, h.tanggal); }
  // rasio gross/netto dari blok yang punya keduanya (dipakai hanya bila salah satu tidak ada)
  let sg = 0, sn = 0;
  for (const [k, r] of pb) { const b = rencana.get(k); if (b && n(b.luas_ha) && n(r.luas_ha)) { sg += n(b.luas_ha); sn += n(r.luas_ha); } }
  const rasio = sn ? sg / sn : 1.078;
  const out = new Map();
  for (const k of new Set([...pb.keys(), ...rencana.keys()])) {
    const r = pb.get(k), b = rencana.get(k);
    const pct = b ? lahanProgress(b, c).per.find((p) => p.akt === akt)?.pct || 0 : 0;
    if (!r && !(pct > 0)) continue;
    const peta = b ? n(b.luas_ha) : null;
    const row = r || semua.get(k); // baris Blok Tanam (walau status belum diubah)
    const pk = row && row.pokok_tanam != null ? row : null;
    let gross = peta != null ? peta * (pct > 0 ? pct : 1) : null;
    let netto, nettoDari;
    if (r && r.luas_ha != null) { netto = n(r.luas_ha); nettoDari = 'excel'; }
    else if (pk && n(pk.pokok_tanam)) { netto = n(pk.pokok_tanam) / POKOK_PER_HA; nettoDari = 'pokok'; }
    else if (gross != null) { netto = gross / rasio; nettoDari = 'perkiraan'; }
    else { netto = n(row?.luas_ha); nettoDari = 'excel'; }
    const lebih = peta != null && netto > peta + 1e-9; // netto melebihi luas peta → dikunci & ditandai
    if (lebih) netto = peta;
    if (gross == null) gross = netto * rasio;
    out.set(k, { blok: r?.nama_blok || b?.blok || row?.nama_blok, luas: netto, gross, nettoDari, lebih, statusBelum: !r, rasio,
      tgl: r?.tanggal_tanam || tglH.get(k) || null, st: r?.status || 'PC',
      pokok: pk ? n(pk.pokok_tanam) : null, pop: pk ? n(pk.pokok_tanam) - n(pk.kehilangan) + n(pk.sulam) : null, sumber: r ? 'blok' : 'progres' });
  }
  return out;
}

// ------------------------------------------------------------ RENCANA KERJA (jadwal LC s/d Tanam per blok, pisang)
// Kalender per kegiatan: Land Clearing & Bajak libur Sabtu–Minggu, lainnya libur Minggu (bisa diubah di Urutan Aktivitas).
// urutan blok awal (user): Land Clearing pindah ke blok terdekat di peta; kegiatan lain ikut prioritas tanam
export const ruteDefault = (akt) => (/land\s*clearing/i.test(String(akt || '')) ? 'Blok terdekat' : '');
// alat awal (user): Bajak 1 & Bajak 2 = 1 traktor bersama; Land Clearing = 1 alat
export const alatDefault = (akt) => ((/bajak/i.test(String(akt || '')) || /^ridger$/i.test(String(akt || ''))) ? 'Traktor Bajak' : /land\s*clearing/i.test(String(akt || '')) ? 'Alat LC' : '');
export const liburDefault = (akt) => (/land\s*clearing|bajak/i.test(String(akt || '')) ? 'Sabtu & Minggu' : 'Minggu');
export function hariKerjaAkt(a) {
  const off = (a?.libur || liburDefault(a?.aktivitas)) === 'Sabtu & Minggu' ? [0, 6] : [0];
  return (d) => !off.includes(d.getDay());
}
// hari kerja per ha untuk 1 tim: isian Urutan Aktivitas; kosong → dari Progres Harian (jumlah hari aktif ÷ total ha)
export function hariPerHa(c, a) {
  if (n(a?.hari_per_ha) > 0) return n(a.hari_per_ha);
  const h = c.rows('lahan_harian').filter((r) => r.aktivitas === a?.aktivitas);
  const ha = h.reduce((s, r) => s + n(r.hasil_ha), 0), hari = new Set(h.map((r) => r.tanggal)).size;
  return ha > 0 ? hari / ha : 0;
}
// titik tengah tiap blok (meter, dari layer peta "Blok Tanam" di tabel gis_layer) — untuk rotasi alat ke blok terdekat
export function posisiBlok(c) {
  const out = new Map();
  try {
    const g = (c.rows('gis_layer') || []).find((x) => /blok tanam/i.test(`${x.jenis} ${x.nama}`));
    const fc = g && (typeof g.geojson === 'string' ? JSON.parse(g.geojson) : g.geojson);
    for (const f of fc?.features || []) {
      const pts = []; const jalan = (q) => (typeof q?.[0] === 'number' ? pts.push(q) : (q || []).forEach(jalan)); jalan(f.geometry?.coordinates);
      if (!pts.length || !f.properties?.Nama_Blok) continue;
      const lon = pts.reduce((t, p) => t + p[0], 0) / pts.length, lat = pts.reduce((t, p) => t + p[1], 0) / pts.length;
      out.set(util.key(f.properties.Nama_Blok), [lon * 111320 * Math.cos((lat * Math.PI) / 180), lat * 110540]);
    }
  } catch {}
  return out;
}
const dphTim = (c, a) => (hariPerHa(c, a) || 2) / Math.max(1, n(a?.tim) || 1);
// Susun rencana mulai tanggal `mulai` (ISO): sisa pekerjaan tiap blok target (Target Tanam, belum tertanam) dari progres saat ini.
// Tiap kegiatan dikerjakan timnya/alatnya sendiri, blok demi blok (prioritas blok: bulan target, lalu progres terbesar);
// kegiatan di satu blok baru mulai setelah kegiatan sebelumnya di blok itu selesai (urutan timeline).
export function susunRencana(c, mulai) {
  const acts = aktivitasUntuk(c, 'Pisang');
  const tt = pisangTertanam(c);
  const lb = new Map(c.rows('lahan_blok').filter((b) => (b.peruntukan || 'Pisang') === 'Pisang').map((b) => [util.key(b.blok), b]));
  const blok = [], ada = new Set();
  for (const t of c.rows('lahan_target')) {
    const k = util.key(t.blok), b = lb.get(k);
    if (!b || ada.has(k) || tt.has(k)) continue;
    ada.add(k);
    const p = lahanProgress(b, c), luas = n(b.luas_ha);
    blok.push({ blok: b.blok, ym: String(t.bulan || '').slice(0, 7), kelas: n(t.prioritas), total: p.total, sisa: acts.map((a) => Math.max(0, (1 - (p.per.find((x) => x.akt === a.aktivitas)?.pct || 0)) * luas)) });
  }
  blok.sort((x, y) => x.kelas - y.kelas || x.ym.localeCompare(y.ym) || y.total - x.total || String(x.blok).localeCompare(String(y.blok), 'id', { numeric: true }));
  const t0 = util.d(mulai), hari = (i) => { const d = new Date(t0); d.setDate(d.getDate() + i); return d; };
  const masuk = (t, kerja) => { let i = Math.floor(t + 1e-9); if (kerja(hari(i))) return t; while (!kerja(hari(i))) i++; return i; }; // geser ke hari kerja
  const maju = (t, w, kerja) => { // tambah w hari kerja mulai waktu t (hari pecahan sejak tanggal mulai)
    for (let g = 0; w > 1e-9 && g < 5000; g++) { const i = Math.floor(t + 1e-9); if (!kerja(hari(i))) { t = i + 1; continue; } const x = Math.min(w, i + 1 - t); t += x; w -= x; }
    return t;
  };
  // Kegiatan dengan "Alat" sama memakai 1 alat bergantian (mis. Bajak 1 & Bajak 2 = 1 traktor): alat menyelesaikan
  // pekerjaannya di satu blok dulu baru pindah. Setiap langkah: dari pekerjaan berikutnya tiap blok, ambil yang paling cepat
  // bisa mulai (alat bebas & kegiatan sebelumnya di blok itu selesai); seri → prioritas blok, lalu urutan kegiatan.
  const alatOf = (a) => (String(a.alat || '').trim() ? 'alat:' + util.key(a.alat) : 'akt:' + a.aktivitas);
  const info = acts.map((a) => ({ a, kerja: hariKerjaAkt(a), dph: dphTim(c, a), alat: alatOf(a) }));
  const bebas = {}, siap = blok.map(() => 0), lanjut = blok.map((b) => b.sisa.findIndex((h) => h > 0.005)), rows = [];
  // rotasi alat (user): kegiatan dengan Urutan Blok "Blok terdekat" (default Land Clearing) pindah ke blok TERDEKAT di peta di antara
  // blok yang sama-sama siap (Prioritas blok sama; bulan target diabaikan). Posisi awal = blok terakhir yang dikerjakan di Progres Harian.
  // Kegiatan lain (mis. traktor) tetap mendahulukan blok yang paling dekat jadwal tanamnya.
  const pos = posisiBlok(c), posAlat = {}, jarak = (p, q) => (p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity);
  for (const h of [...c.rows('lahan_harian')].filter((x) => x.tanggal && x.tanggal < mulai).sort((x, y) => String(x.tanggal).localeCompare(String(y.tanggal)))) {
    const a = acts.find((z) => z.aktivitas === h.aktivitas); if (a && pos.has(util.key(h.blok))) posAlat[alatOf(a)] = pos.get(util.key(h.blok));
  }
  for (let g = 0; g < 10000; g++) {
    let pilih = null; const calon = [];
    blok.forEach((b, i) => {
      const k = lanjut[i]; if (k < 0) return;
      // prioritas: alat/tim kegiatan ini menunggu sampai blok berprioritas lebih kecil tidak punya sisa pekerjaan dengan alat itu
      if (b.kelas && blok.some((c, j) => c.kelas < b.kelas && lanjut[j] >= 0 && c.sisa.some((h, kk) => kk >= lanjut[j] && h > 0.005 && info[kk].alat === info[k].alat))) return;
      const s = masuk(Math.max(bebas[info[k].alat] || 0, siap[i]), info[k].kerja);
      calon.push({ i, k, s });
      if (!pilih || s < pilih.s - 1e-9 || (Math.abs(s - pilih.s) <= 1e-9 && (i < pilih.i || (i === pilih.i && k < pilih.k)))) pilih = { i, k, s };
    });
    if (!pilih) break;
    if ((info[pilih.k].a.rute || ruteDefault(info[pilih.k].a.aktivitas)) === 'Blok terdekat' && posAlat[info[pilih.k].alat]) { // pilih blok terdekat dari posisi alat
      const p0 = blok[pilih.i], dari = posAlat[info[pilih.k].alat];
      const sama = calon.filter((q) => info[q.k].alat === info[pilih.k].alat && Math.abs(q.s - pilih.s) <= 1e-9 && blok[q.i].kelas === p0.kelas);
      for (const q of sama) { const dq = jarak(dari, pos.get(util.key(blok[q.i].blok))), dp = jarak(dari, pos.get(util.key(blok[pilih.i].blok))); if (dq < dp - 1e-6 || (Math.abs(dq - dp) <= 1e-6 && q.i < pilih.i)) pilih = q; }
    }
    const { i, k, s } = pilih, b = blok[i], x = info[k], ha = b.sisa[k];
    const e = maju(s, ha * x.dph, x.kerja);
    bebas[x.alat] = e; siap[i] = e;
    if (pos.has(util.key(b.blok))) posAlat[x.alat] = pos.get(util.key(b.blok));
    let nk = k + 1; while (nk < acts.length && b.sisa[nk] <= 0.005) nk++;
    lanjut[i] = nk < acts.length ? nk : -1;
    const iS = Math.floor(s + 1e-9);
    rows.push({ urutan: i + 1, blok: b.blok, aktivitas: x.a.aktivitas, luas_ha: Math.round(ha * 1e4) / 1e4,
      mulai: util.iso(hari(iS)), selesai: util.iso(hari(Math.max(iS, Math.ceil(e - 1e-9) - 1))), _k: k });
  }
  // pekerjaan yang sudah dikerjakan sejak awal bulan s/d sebelum tanggal mulai ikut jadi rencana bulan itu (sudah terealisasi),
  // agar progres sebulan penuh terlihat (permintaan user) — per blok × kegiatan dari Progres Harian
  const awalBulan = `${String(mulai).slice(0, 7)}-01`, urutBlok = new Map(blok.map((b, i) => [util.key(b.blok), i + 1]));
  const sdh = new Map();
  for (const h of c.rows('lahan_harian')) {
    if (!h.tanggal || h.tanggal < awalBulan || h.tanggal >= mulai) continue;
    const b = lb.get(util.key(h.blok)), k = acts.findIndex((a) => a.aktivitas === h.aktivitas);
    if (!b || k < 0) continue;
    const g = util.key(b.blok) + '|' + k, x = sdh.get(g) || { b, k, ha: 0, mulai: h.tanggal, selesai: h.tanggal };
    x.ha += n(h.hasil_ha); if (h.tanggal < x.mulai) x.mulai = h.tanggal; if (h.tanggal > x.selesai) x.selesai = h.tanggal;
    sdh.set(g, x);
  }
  for (const x of sdh.values()) if (x.ha > 0.005)
    rows.push({ urutan: urutBlok.get(util.key(x.b.blok)) ?? null, blok: x.b.blok, aktivitas: acts[x.k].aktivitas, luas_ha: Math.round(Math.min(x.ha, n(x.b.luas_ha)) * 1e4) / 1e4,
      mulai: x.mulai, selesai: x.selesai, keterangan: 'Sudah dikerjakan (sebelum rencana disusun)', _k: x.k });
  return rows.sort((x, y) => (x.urutan ?? 0) - (y.urutan ?? 0) || String(x.blok).localeCompare(String(y.blok), 'id', { numeric: true }) || x._k - y._k || x.mulai.localeCompare(y.mulai)).map(({ _k, ...r }) => r);
}
// luas rencana satu baris yang jatuh pada tanggal dari..sampai (ISO, termasuk) — dibagi rata per hari kerja kegiatan itu
export function porsiRencana(r, a, dari, sampai) {
  const m = util.d(r.mulai), s = util.d(r.selesai), lo = util.d(dari), hi = util.d(sampai);
  if (!m || !s || !lo || !hi) return 0;
  // baris "Sudah dikerjakan": dibagi menurut tanggal kerja sebenarnya di Progres Harian (mis. tanam hari Minggu tetap masuk minggu itu)
  if (r.harian?.length) { const tot = r.harian.reduce((t, h) => t + h.ha, 0), dlm = r.harian.filter((h) => h.tanggal >= dari && h.tanggal <= sampai).reduce((t, h) => t + h.ha, 0); if (tot > 0) return (n(r.luas_ha) * dlm) / tot; }
  const kerja = hariKerjaAkt(a);
  let tot = 0, dlm = 0;
  for (const d = new Date(m); d <= s; d.setDate(d.getDate() + 1)) if (kerja(d)) { tot++; if (d >= lo && d <= hi) dlm++; }
  return tot ? (n(r.luas_ha) * dlm) / tot : m >= lo && m <= hi ? n(r.luas_ha) : 0;
}
// status tiap baris rencana: selesai = luas rencana − sisa pekerjaan sekarang (dari Progres Harian; blok tertanam = selesai),
// jadi laporan yang diupload terlambat (tanggal lama) tetap terhitung
export function statusRencana(c) {
  const acts = aktivitasUntuk(c, 'Pisang'), A = new Map(acts.map((a) => [a.aktivitas, a]));
  const tt = pisangTertanam(c), lb = new Map(c.rows('lahan_blok').map((b) => [util.key(b.blok), b])), prog = new Map();
  const rs = c.rows('lahan_rencana').filter((r) => A.has(r.aktivitas) && r.mulai && r.selesai);
  // satu blok × kegiatan bisa punya beberapa baris (mis. sudah dikerjakan + sisa): selesai = total rencana − sisa sekarang,
  // dibagikan ke baris paling awal dulu
  const grup = new Map();
  for (const r of rs) { const g = util.key(r.blok) + '|' + r.aktivitas; if (!grup.has(g)) grup.set(g, []); grup.get(g).push(r); }
  const hasil = new Map();
  for (const list of grup.values()) {
    const r0 = list[0], k = util.key(r0.blok), b = lb.get(k);
    if (!prog.has(k)) prog.set(k, b ? lahanProgress(b, c) : null);
    const pc = tt.has(k) ? 1 : prog.get(k)?.per.find((x) => x.akt === r0.aktivitas)?.pct || 0;
    const total = list.reduce((s, r) => s + n(r.luas_ha), 0), sisa = Math.max(0, (1 - pc) * n(b?.luas_ha));
    let ada = Math.min(total, Math.max(0, total - sisa));
    for (const r of [...list].sort((x, y) => String(x.mulai).localeCompare(String(y.mulai)) || String(x.selesai).localeCompare(String(y.selesai)))) {
      const luas = n(r.luas_ha), done = Math.min(luas, ada); ada -= done;
      const harian = /^sudah dikerjakan/i.test(r.keterangan || '') ? c.rows('lahan_harian').filter((h) => h.aktivitas === r.aktivitas && util.key(h.blok) === k && h.tanggal >= r.mulai && h.tanggal <= r.selesai).map((h) => ({ tanggal: h.tanggal, ha: n(h.hasil_ha) })) : null;
      hasil.set(r, { ...r, a: A.get(r.aktivitas), urut: acts.indexOf(A.get(r.aktivitas)), luas, done, kurang: Math.max(0, luas - done), beres: luas - done <= 0.005, harian });
    }
  }
  return rs.map((r) => hasil.get(r));
}
// ringkasan per kegiatan: target s/d tanggal `sd` (ISO, termasuk) vs selesai; hari terlambat ≈ kekurangan × hari per ha
export function ringkasRencana(c, sd, R = statusRencana(c)) {
  const awal = R.reduce((m, r) => (!m || r.mulai < m ? r.mulai : m), '');
  return aktivitasUntuk(c, 'Pisang').map((a) => {
    const rs = R.filter((r) => r.aktivitas === a.aktivitas);
    if (!rs.length) return null;
    const total = rs.reduce((s, r) => s + r.luas, 0), done = rs.reduce((s, r) => s + r.done, 0);
    const target = sd < awal ? 0 : rs.reduce((s, r) => s + porsiRencana(r, a, awal, sd), 0);
    return { a, akt: a.aktivitas, total, done, target, selisih: done - target, telat: Math.max(0, target - done) * dphTim(c, a),
      mulai: rs.reduce((m, r) => (r.mulai < m ? r.mulai : m), rs[0].mulai), selesai: rs.reduce((m, r) => (r.selesai > m ? r.selesai : m), rs[0].selesai) };
  }).filter(Boolean);
}

// target vs hasil tiap kegiatan pada periode [dari, sampai] (minggu / bulan / rentang bebas) — dipakai /kebun & Laporan Owner.
// target = bagian rencana di periode itu per blok (+ tunggakan rencana sebelumnya bila periode memuat hari ini);
// selesai = hasil Progres Harian di periode itu (s/d hari ini); blokKerja = blok yang benar-benar dikerjakan.
export function targetPeriode(c, R, dari, sampai, hariIni = util.iso(util.today())) {
  if (!R.length) return [];
  const acts = aktivitasUntuk(c, 'Pisang'), awal = R.reduce((m, r) => (r.mulai < m ? r.mulai : m), R[0].mulai);
  const blokRen = new Set(R.map((r) => util.key(r.blok)));
  const blokPis = new Set(c.rows('lahan_blok').filter((b) => (b.peruntukan || 'Pisang') === 'Pisang').map((b) => util.key(b.blok)));
  const kini = dari <= hariIni && hariIni <= sampai, s1 = sampai < hariIni ? sampai : hariIni;
  const har = c.rows('lahan_harian').filter((r) => (blokRen.has(util.key(r.blok)) || blokPis.has(util.key(r.blok))) && r.tanggal >= awal && r.tanggal >= dari && r.tanggal <= s1);
  return acts.map((a) => {
    const per = new Map(); // satu baris per blok (baris "sudah dikerjakan" + sisa digabung)
    for (const r of R.filter((x) => x.aktivitas === a.aktivitas)) {
      const p = porsiRencana(r, r.a, dari, sampai), tunggak = kini && r.selesai < dari && !r.beres ? r.kurang : 0;
      if (p <= 0.005 && tunggak <= 0.005) continue;
      const b = per.get(util.key(r.blok)) || { blok: r.blok, ha: 0, tunggak: 0, beres: true };
      b.ha += p + tunggak; b.tunggak += tunggak; b.beres = b.beres && r.beres;
      per.set(util.key(r.blok), b);
    }
    const bl = [...per.values()], hk = dari <= hariIni ? har.filter((r) => r.aktivitas === a.aktivitas) : [];
    const target = bl.reduce((s, x) => s + x.ha, 0), selesai = hk.reduce((s, r) => s + n(r.hasil_ha), 0);
    return { a: a.aktivitas, bl, target, selesai, tunggak: bl.reduce((s, x) => s + x.tunggak, 0), blokKerja: [...new Set(hk.map((r) => r.blok))] };
  }).filter((x) => x.target > 0.005 || x.selesai > 0.005);
}

// Tanam per bulan berdasarkan LUASAN (permintaan user): rencana = bagian rencana Tanam di bulan itu; aktual = hasil Tanam di
// Progres Harian pada bulan itu, blok mana pun (blok yang ditanam lebih cepat/lambat dari rencananya tetap dihitung di bulan
// tanamnya). Status memakai kumulatif luas → tukar blok tidak membuat bulan "kurang" selama total luas sesuai rencana.
export function tanamPerBulan(c, R = statusRencana(c), hariIni = util.iso(util.today())) {
  const tanam = aktivitasUntuk(c, 'Pisang').slice(-1)[0]?.aktivitas;
  const rt = R.filter((r) => r.aktivitas === tanam);
  if (!tanam || !rt.length) return [];
  const awal = R.reduce((m, r) => (r.mulai < m ? r.mulai : m), R[0].mulai);
  const lb = new Map(c.rows('lahan_blok').filter((b) => (b.peruntukan || 'Pisang') === 'Pisang').map((b) => [util.key(b.blok), b]));
  const har = c.rows('lahan_harian').filter((h) => h.aktivitas === tanam && h.tanggal && h.tanggal >= awal && lb.has(util.key(h.blok)));
  const tt = pisangTertanam(c);
  // bulan rencana tanam tiap blok = bulan selesai baris Tanam terakhirnya
  const blnRen = new Map(), nama = new Map();
  for (const r of [...rt].sort((a, b) => a.selesai.localeCompare(b.selesai))) { blnRen.set(util.key(r.blok), r.selesai.slice(0, 7)); nama.set(util.key(r.blok), r.blok); }
  for (const h of har) if (!nama.has(util.key(h.blok))) nama.set(util.key(h.blok), lb.get(util.key(h.blok))?.blok || h.blok);
  const akhir = [...rt.map((r) => r.selesai), ...har.map((h) => h.tanggal)].sort().pop();
  const bulan = []; for (let m = awal.slice(0, 7); m <= akhir.slice(0, 7); ) { bulan.push(m); const d = new Date(+m.slice(0, 4), +m.slice(5), 1); m = util.iso(d).slice(0, 7); }
  const kemarin = util.addDays(hariIni, -1);
  let kR = 0, kA = 0;
  return bulan.map((m) => {
    const a0 = m === awal.slice(0, 7) ? awal : `${m}-01`, a1 = util.iso(new Date(+m.slice(0, 4), +m.slice(5), 0));
    const ren = rt.reduce((s, r) => s + porsiRencana(r, r.a, a0, a1), 0);
    const hm = new Map(); for (const h of har) if (h.tanggal >= a0 && h.tanggal <= a1) hm.set(util.key(h.blok), (hm.get(util.key(h.blok)) || 0) + n(h.hasil_ha));
    const akt = [...hm.values()].reduce((s, x) => s + x, 0);
    const kRsebelum = kR; kR += ren; kA += akt;
    const sd = kemarin < a0 ? null : kemarin < a1 ? kemarin : a1; // target dinilai s/d kemarin
    const kRsd = kRsebelum + (sd ? rt.reduce((s, r) => s + porsiRencana(r, r.a, a0, sd), 0) : 0);
    const selisih = kA - kRsd;
    const status = !sd ? 'belum' : selisih >= -0.005 ? 'sesuai' : 'kurang';
    const luasB = (k) => n(lb.get(k)?.luas_ha);
    return {
      bulan: m, rencana: ren, aktual: akt, kumRencana: kR, kumAktual: kA, kumRencanaSd: kRsd, selisih, status, lalu: a1 < hariIni,
      // blok yang direncanakan tanam bulan ini (✅ bila sudah tertanam)
      blokRencana: [...blnRen].filter(([, mm]) => mm === m).map(([k]) => ({ blok: nama.get(k), luas: luasB(k), sudah: tt.has(k), haBulanIni: hm.get(k) || 0 })),
      // blok yang ditanam bulan ini padahal rencananya bulan lain (maju / mundur) atau tidak ada di rencana
      luar: [...hm].filter(([k]) => blnRen.get(k) !== m).map(([k, ha]) => ({ blok: nama.get(k), ha, rencana: blnRen.get(k) || null, arah: !blnRen.get(k) ? 'di luar rencana' : blnRen.get(k) > m ? 'maju' : 'mundur' })),
    };
  });
}

export function displayOf(table, row) {
  const d = TABLES[table].display;
  return typeof d === 'function' ? d(row) : row[d];
}
