# Pembaruan aman ke versi 1.1

## Sebelum memasang

1. Download backup database dari Pengaturan & Backup pada instalasi yang dipakai.
2. Untuk lokal, hentikan server dan salin folder `data/` serta file Excel ke lokasi cadangan.
3. Simpan versi kode sebelumnya. Periksa pembaruan dahulu pada salinan database atau deployment preview yang memakai database staging tersendiri.

## Lokal

Ganti kode/dependensi, pertahankan folder `data/` dan konfigurasi. Jalankan `npm ci` dan `npm start`. Jangan mengganti `kebun.db` dengan database contoh atau database pengujian.

## Vercel

Deploy kode baru dengan database/Blob yang sama hanya setelah pemeriksaan staging selesai. Deployment preview tidak boleh tanpa sengaja memakai database produksi untuk uji perubahan GIS atau impor. Migrasi berjalan otomatis saat server dimulai; tidak memerlukan reset database.

## Apa yang dimigrasikan

- Registri `_blocks`, relasi `_block_links`, arsip revisi `_gis_revisions`, dan arsip revisi Excel `_import_revisions` ditambahkan.
- Kolom `block_id` dan `block_name_snapshot` ditambahkan pada tabel yang mengacu langsung ke blok.
- Nama lama dipertahankan sebagai alias dan snapshot. Rekaman yang namanya tidak dapat dipastikan tetap disimpan.
- GeoJSON blok dikenali dari jenis/nama Blok Tanam, Blok Kebun, atau Petak Kebun. Migrasi menambahkan `blok_id` pada fitur yang dapat dipetakan tanpa ambiguitas.
- Kepemilikan tidak ditebak dari keberadaan blok pada rencana. Lahan operasional memerlukan GIS aktif dan status Sudah milik kebun.
- Kolom tanggal/siklus pada panen padi dan metadata thumbnail foto ditambahkan tanpa menghapus angka atau foto lama.
- Luas GIS terbaru disimpan terpisah; target, HI, HK, dan luas operasional lama tidak diganti otomatis oleh luas poligon baru.

## Sesudah memasang

1. Pastikan jumlah transaksi lama, akun, dan angka laporan penting sesuai backup.
2. Buka Blok & Riwayat GIS. Periksa blok belum diverifikasi, nama/rentang lama, dan layer yang belum dikenali.
3. Download GeoJSON ber-ID. Pertahankan ID di file GIS berikutnya.
4. Verifikasi kepemilikan melalui pratinjau revisi GIS. Hanya blok terverifikasi yang menjadi pilihan mandor.
5. Download ulang template Excel agar memuat ID dan versi baris. File lama tidak dapat dipakai untuk menimpa data induk yang sudah berubah.
6. Uji satu laporan mandor, PDF, dan berbagi pada HP yang digunakan. WhatsApp tidak menerima lampiran otomatis dari tautan wa.me; pada browser tanpa Web Share berkas, lampirkan PDF hasil unduhan secara manual.

## Catatan revisi GIS

Upload ke layer yang sama. Ganti nama dengan ID yang sama. Pecah/gabung memakai ID baru dengan `parent_ids`; transaksi induk tetap disimpan, tidak diduplikasi atau dibagi secara otomatis. Blok yang tidak ada dalam revisi menjadi nonaktif. Untuk mengaktifkan kembali blok, masukkan ID yang sama dalam revisi berikutnya.

Nama yang berubah tanpa ID dan tanpa kecocokan pasti perlu dipetakan secara eksplisit pada pratinjau. Sistem tidak menyimpulkan dua blok sama hanya karena luasnya sama. Perubahan yang ambigu tidak diterapkan.

## Pemulihan

Simpan kode versi sebelumnya dan backup sebelum pembaruan. Jika perlu kembali, hentikan server lalu pulihkan salinan database dan kode yang berpasangan. Hindari memulihkan backup lama di atas transaksi baru tanpa terlebih dahulu menyimpan backup kondisi terbaru.

Arsip revisi GIS menyimpan GeoJSON sebelum/sesudah; revisi Excel menyimpan isi baris sebelumnya. Arsip ini tidak ikut terhapus oleh impor biasa. Pemulihan database penuh melalui menu Pengaturan adalah tindakan khusus yang memang mengganti isi database, bukan bagian dari pembaruan kode.

## Batas pengujian

Pengujian otomatis memakai SQLite lokal dan data uji terpisah. Belum ada uji beban pada Turso/Blob produksi atau pengukuran LCP/INP pada HP lapangan. API online masih menggunakan mirror database yang ada; perubahan ini mengurangi data ke browser dan jumlah permintaan, bukan mengganti arsitektur sinkronisasi online secara keseluruhan.
