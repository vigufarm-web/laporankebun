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
const OPT_PADI = ['Wereng Batang Coklat', 'Penggerek Batang', 'Tikus', 'Blast', 'Hawar Daun Bakteri (Kresek)', 'Tungro', 'Keong Mas', 'Walang Sangit', 'Ulat Grayak', 'Lainnya'];

export const DIVISIONS = [
  { key: 'pisang', name: 'Pisang', icon: '🍌', color: '#ca8a04',
    tables: ['pisang_blok', 'pisang_panen_pkk', 'pisang_box', 'pisang_estimasi', 'pisang_handclass', 'pisang_bibit', 'pisang_kegiatan'] },
  { key: 'padi', name: 'Padi', icon: '🌾', color: '#65a30d',
    tables: ['padi_benih', 'padi_petak', 'padi_tanam', 'padi_kegiatan', 'padi_opt', 'padi_panen', 'padi_giling'] },
  { key: 'lahan', name: 'Infra & Pembukaan Lahan', icon: '🚜', color: '#b45309',
    tables: ['lahan_blok', 'lahan_harian', 'lahan_aktivitas'] },
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
    title: 'Penjualan', div: 'pisang', date: 'tanggal', sort: '-tanggal',
    desc: 'Penjualan per baris surat jalan. Tipe "Mutasi Internal" (kirim ke gudang ripening sendiri) dan "Ongkir" tidak dihitung sebagai penjualan pisang.',
    f: [
      { k: 'tanggal', l: 'Tanggal SJ', t: 'date', req: true },
      { k: 'no_sj', l: 'No. Surat Jalan', t: 'text' },
      { k: 'gudang', l: 'Asal Gudang', t: 'text', sug: ['TGL', 'SMG'] },
      { k: 'pembeli', l: 'Pembeli', t: 'text' },
      { k: 'tipe', l: 'Tipe', t: 'select', opt: TIPE_JUAL, req: true },
      { k: 'jenis_barang', l: 'Jenis Barang', t: 'text' },
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
  padi_panen: {
    title: 'Panen Padi', div: 'padi', sort: 'petak',
    desc: 'Satu baris per blok: total karung & berat gabah blok itu (semua tahap panen dijumlah).',
    f: [
      { k: 'petak', l: 'Petak / Blok', t: 'ref', ref: 'padi_petak', req: true },
      { k: 'luas_blok', l: 'Luas Blok (ha)', t: 'calc', fmt: 'num2', fn: (r, c) => luasPetak(c, r.petak) },
      { k: 'jumlah_karung', l: 'Jumlah Karung', t: 'int' },
      { k: 'gkp_kg', l: 'Berat Gabah / GKP (kg)', t: 'num', req: true },
      { k: 'kg_karung', l: 'Rata-rata kg/karung', t: 'calc', fmt: 'num2', fn: (r) => (n(r.jumlah_karung) ? n(r.gkp_kg) / n(r.jumlah_karung) : null) },
      { k: 'ton_ha', l: 'Hasil (ton/ha)', t: 'calc', fmt: 'num2', fn: (r, c) => { const l = luasPetak(c, r.petak); return l ? n(r.gkp_kg) / 1000 / l : null; } },
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
    title: 'Penjualan Padi', div: 'padi', date: 'tanggal', sort: '-tanggal',
    f: [
      { k: 'tanggal', l: 'Tanggal', t: 'date', req: true },
      { k: 'no_sj', l: 'No. Surat Jalan', t: 'text' },
      { k: 'pembeli', l: 'Pembeli', t: 'text' },
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
  lahan_aktivitas: {
    title: 'Urutan Aktivitas', div: 'lahan', display: 'aktivitas', sort: 'urutan',
    desc: 'Urutan tahapan persiapan lahan. Bisa ditambah/diubah sesuai kebutuhan (mis. untuk sawah).',
    f: [
      { k: 'untuk', l: 'Untuk Komoditas', t: 'select', opt: ['Pisang', 'Padi', 'Semua'], req: true },
      { k: 'urutan', l: 'Urutan', t: 'int', req: true },
      { k: 'aktivitas', l: 'Aktivitas', t: 'text', req: true },
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
  { sheet: 'Padi - Blok Padi', table: 'padi_petak' },
  { sheet: 'Padi - Stok Benih', table: 'padi_benih', omit: ['untuk'] },
  { sheet: 'Padi - Panen', table: 'padi_panen', omit: ['musim_tanam'] },
  { sheet: 'Padi - Beras Masuk', table: 'padi_giling' },
  { sheet: 'Progres - Urutan Tahap', table: 'lahan_aktivitas' },
  { sheet: 'Progres - Rencana Blok', table: 'lahan_blok' },
  { sheet: 'Progres - Harian', table: 'lahan_harian' },
  { sheet: 'Iklim - Data 2 Jam', table: 'iklim' },
];

// ------------------------------------------------------------ PERAN PENGGUNA
// Semua pengguna yang login bisa MELIHAT semua data. `edit` = tabel yang boleh diubah.
// Satu pengguna boleh punya beberapa peran (izinnya digabung).
export const ROLES = {
  admin: { label: 'Admin', desc: 'Semua data, pengguna, peta, backup', edit: '*' },
  management: { label: 'Management / Owner', desc: 'Hanya melihat & export laporan', edit: [] },
  panen_pisang: { label: 'Panen Pisang', desc: 'Panen PKK, box PH, estimasi panen, hand class', edit: ['pisang_panen_pkk', 'pisang_box', 'pisang_estimasi', 'pisang_handclass'] },
  panen_padi: { label: 'Panen Padi', desc: 'Panen padi & penggilingan (beras masuk)', edit: ['padi_panen', 'padi_giling'] },
  kebun_pisang: { label: 'Kebun Pisang', desc: 'Blok, bibit, kegiatan pisang', edit: ['pisang_blok', 'pisang_bibit', 'pisang_kegiatan'] },
  kebun_padi: { label: 'Kebun Padi', desc: 'Stok benih, petak, musim tanam, kegiatan, OPT', edit: ['padi_benih', 'padi_petak', 'padi_tanam', 'padi_kegiatan', 'padi_opt'] },
  lahan: { label: 'Progres Tanam / Pembukaan Lahan', desc: 'Progres LC/bajak/tanam pisang & padi', edit: ['lahan_blok', 'lahan_harian', 'lahan_aktivitas'] },
  gis: { label: 'GIS', desc: 'Layer peta, catatan peta, titik lokasi', edit: ['gis_layer', 'gis_titik'] },
  iklim: { label: 'Iklim', desc: 'Data stasiun cuaca', edit: ['iklim'] },
};
export function canEdit(user, table) {
  if (!user) return false;
  return (user.peran || []).some((r) => ROLES[r] && (ROLES[r].edit === '*' || ROLES[r].edit.includes(table)));
}
export const isAdmin = (user) => !!user && (user.peran || []).includes('admin');

// Data awal (hanya diisi kalau tabel masih kosong)
export const SEED = {
  lahan_aktivitas: [
    ...['Land Clearing', 'Bajak 1', 'Dolomite', 'Bajak 2', 'Stik Ridger', 'Ridger', 'Install Drip', 'Stik Tanam', 'Ecer Pupuk', 'Tanam'].map((a, i) => ({ untuk: 'Pisang', urutan: i + 1, aktivitas: a })),
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

export function displayOf(table, row) {
  const d = TABLES[table].display;
  return typeof d === 'function' ? d(row) : row[d];
}
