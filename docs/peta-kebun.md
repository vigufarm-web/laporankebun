# Pusat Peta Kebun

Peta Kebun adalah editor tersendiri di `/peta`. Penyimpanan GIS menggunakan koneksi backend yang sama selama migrasi, dengan tabel khusus GIS. Tidak membuat salinan database bisnis kedua.

## Memperbarui peta

1. Unduh GeoJSON ber-ID dari layer yang akan direvisi. Simpan sebagai cadangan.
2. Edit di aplikasi GIS. Pertahankan `blok_id`; jangan menggantinya dengan OBJECTID atau nomor urut shapefile.
3. Gunakan satu jenis layer per ZIP: Blok Tanam, Persil Lahan, atau Jalan. ZIP shapefile menyertakan `.shp`, `.shx`, `.dbf`, `.prj`, dan `.cpg` bila ada.
4. Pilih layer lama yang diganti. Jangan membuat layer duplikat untuk revisi layer yang sama.
5. Unggah ZIP/GeoJSON dan periksa daftar perubahan. Nama baru yang masih blok yang sama harus dipetakan ke ID lama.
6. Untuk pecah/gabung, gunakan ID baru dan isi `parent_ids` dengan ID asal. Riwayat asal tetap dipertahankan; kuantitas lama tidak disalin ke seluruh blok anak.
7. Terapkan setelah hasil sesuai. Versi lama, luas, batas dan pelakunya disimpan.

Beberapa poligon dengan nama dan atribut blok yang sama dapat merupakan bagian dari satu blok. Jangan menghapus bagian tersebut hanya karena namanya berulang. Luas batas GIS, luas milik kebun, luas kelompok tanam dan luas pekerjaan berbeda pengertian.

## Data tanaman

Tanggal tanam, varietas, luas tanam dan pokok dicatat per kelompok atau musim di Peta Kebun. Satu blok dapat memiliki beberapa tanggal tanam. Musim Padi tidak digabungkan menjadi satu umur. Tanggal tutup kelompok mengakhiri masa aktif kelompok tersebut; kelompok lama tetap tercatat.

Aturan Pisang: PC 0–52 minggu, R1 53–91, R2 92–130, R3 131–169, R4 mulai 170. Koreksi siklus harus memiliki tanggal berlaku dan alasan. Angka ini merupakan aturan kebun, bukan kepastian biologis panen.

## Payroll dan Gudang

Admin menghubungkan referensi melalui Pengaturan. Peta meminta persetujuan baca untuk aplikasi tujuan; izin hanya membaca referensi, bukan mengubah peta atau mengakses upah. Izin sesi berlaku 8 jam. Tidak ada token GitHub yang dikirim antar proyek.

Pencocokan mempertahankan ID lokal numerik. Nama ambigu, tanggal berbeda, tanggal GIS kosong yang sebelumnya sudah ada di Payroll, dan blok nonaktif perlu diperiksa. Blok baru tidak dibuat diam-diam. Transaksi lama mempertahankan kuantitas dan acuan awal; transaksi baru menyimpan snapshot referensi. Tidak melakukan sinkronisasi otomatis saat formulir terbuka atau data belum disimpan.

## Foto udara

`VIGUFARM_261014.zip` berisi ECW sekitar 622 MB, PRJ WGS84 dan world file. Jangan unggah ECW langsung sebagai layer vektor, database transaksi, atau berkas GitHub. Konversi di perangkat yang mempunyai pembaca ECW menjadi GeoTIFF/COG atau tile XYZ. Simpan hasil foto di penyimpanan berkas/tile terpisah; peta hanya memuat bagian yang terlihat. Gunakan nama dan tanggal pemotretan yang jelas, pengaturan transparansi dan batas zoom. Foto baru menjadi lapisan baru dan tidak otomatis mengganti batas/luas blok.

## Berkas pembaruan 30 Oktober 2026

- Persil Lahan: 615 fitur, sumber EPSG:32749.
- Jalan: 79 fitur poligon/multipoligon, sumber EPSG:32749.
- Blok Tanam 21 Oktober: 84 fitur, 75 nama blok unik; beberapa blok multipart. `OBJECTID`/`Id` bukan ID pusat GIS.

Jumlah bidang/poligon bukan jumlah transaksi dan bukan otomatis luas milik kebun. Konversi koordinat ke WGS84 tidak mengubah kepemilikan.
