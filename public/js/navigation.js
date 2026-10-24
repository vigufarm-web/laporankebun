export const KOM = {
  pisang: { nama: 'Pisang', icon: '🍌', key: 'Pisang', tabs: [
    { k: 'bibit', l: 'Stok Bibit', tables: ['pisang_bibit'] },
    // Tertanam: hanya untuk admin (permintaan user) — pokok tanam per blok, tanggal tanam, tabel Blok Tanam
    { k: 'tertanam', l: 'Tertanam', tables: ['pisang_blok', 'pisang_kegiatan'], excel: ['pisang_blok'], admin: true },
    // Blok Tanam (pokok, tanggal tanam, status) disembunyikan dari tampilan tapi ikut di Excel halaman ini
    { k: 'progres', l: 'Progres Tanam', tables: ['lahan_harian', 'lahan_blok', 'lahan_target', 'lahan_rencana', 'lahan_aktivitas'], excel: ['lahan_harian', 'lahan_blok', 'lahan_target', 'lahan_rencana', 'lahan_aktivitas', 'pisang_blok'], week: true }, // Target Tanam & Rencana Kerja dipakai halaman Tim Kebun (/kebun)
    { k: 'panen', l: 'Panen', tables: ['pisang_box', 'pisang_estimasi', 'pisang_panen_pkk', 'pisang_handclass'], week: true },
    { k: 'jual', l: 'Penjualan', tables: ['pisang_penjualan'], week: true },
  ] },
  padi: { nama: 'Padi', icon: '🌾', key: 'Padi', tabs: [
    { k: 'bibit', l: 'Stok Benih', tables: ['padi_benih'] },
    { k: 'tertanam', l: 'Tertanam', tables: ['padi_petak', 'padi_tanam', 'padi_kegiatan', 'padi_opt'] },
    { k: 'progres', l: 'Progres Tanam', tables: ['lahan_harian', 'lahan_blok', 'lahan_aktivitas'], week: true },
    { k: 'rencana', l: 'Rencana Mingguan', tables: ['padi_rencana'] }, // rencana & realisasi kerja mingguan (Excel "Laporan mingguan Padi")
    { k: 'panen', l: 'Panen', tables: ['padi_panen', 'padi_giling'] },
    { k: 'jual', l: 'Penjualan', tables: ['padi_penjualan'], week: true },
  ] },
  iklim: { nama: 'Iklim', icon: '🌦️', key: 'Iklim', tabs: [
    { k: 'data', l: 'Cuaca Harian', tables: ['iklim'] },
  ] },
};

export const RECORD_ROUTES={pisang:{bibit:'pisang_bibit',tertanam:'pisang_blok',panen:'pisang_box',jual:'pisang_penjualan'},padi:{bibit:'padi_benih',tertanam:'padi_tanam',panen:'padi_panen',jual:'padi_penjualan',rencana:'padi_rencana'}};
