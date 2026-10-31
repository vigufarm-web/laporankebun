# Monitoring Kebun - PT VIGU FARM INDONESIA

Aplikasi Pisang, Padi, Infra, Daily Report, iklim, penjualan, dan GIS. Node.js + SQLite lokal; Turso dan Vercel Blob untuk versi online.

## Menjalankan

1. Gunakan Node.js 22.13 atau lebih baru (Node.js 24 direkomendasikan).
2. Jalankan `npm ci`, lalu `npm start`, atau klik `Jalankan.bat`.
3. Buka `http://localhost:3000`. Instalasi baru menyediakan pembuatan admin pertama.
4. Komputer/HP di WiFi yang sama dapat memakai alamat jaringan yang dicetak oleh server.

## Pembaruan keandalan input

- Revisi blok transaksi melalui Excel memperbarui ID dan tautan blok tujuan. Pratinjau menampilkan nilai sebelum dan sesudah.
- Rencana mingguan dan realisasi tidak lagi dipotong pada 200/100 baris. Ukuran kiriman tetap mengikuti batas teknis layanan; kegagalan tidak dianggap tersimpan.
- Revisi rencana memeriksa versi terakhir dan mempertahankan ID rincian. Rincian yang dihapus dari rencana tetap tersimpan untuk riwayat realisasi.
- Kiriman Daily memakai nomor unik agar pengulangan respons jaringan tidak membuat laporan baru.
- Antrean foto dan keterangannya disimpan di IndexedDB per akun/tanggal/divisi, lalu dilanjutkan saat formulir dibuka kembali. Jika penyimpanan perangkat tidak tersedia atau penuh, tampil peringatan. Menghapus data browser juga menghapus draf dan foto yang belum diunggah.
- Ringkasan, laporan selesai, dan foto publik tetap dapat dibuka tanpa login.

## Pembaruan 1.1

- Ringkasan owner dan modul memakai respons ringkas. Transaksi ditampilkan 50 baris per halaman, dengan filter tanggal dan pencarian dari server.
- Kode halaman dimuat ketika menunya dibuka. Layer GIS yang tersembunyi tidak diunduh sampai diaktifkan. Analisis lama tetap tersedia lewat Analisis lengkap & peta.
- Daily menyediakan pilihan kegiatan, isian hasil dan HK, draf perangkat, foto terkompres, thumbnail, serta retry unggahan tanpa mengulang foto yang sudah berhasil.
- Mandor dapat mengunduh PDF Daily dan membagikan PDF/ringkasan melalui pilihan berbagi perangkat. Browser tanpa dukungan berbagi berkas mengunduh PDF dan membuka WhatsApp; pengguna melampirkan PDF secara manual.
- Owner/management dapat mengunduh PDF gabungan sesuai periode. Mandor tidak dapat mengunduh divisi di luar izinnya atau PDF owner.
- Blok mengikuti GIS melalui ID permanen. Nama diperbarui tanpa menghapus hasil atau status pekerjaan yang sudah selesai.
- Impor Excel memperbarui berdasarkan ID dan versi baris, menambah baris baru, dan mempertahankan baris lama yang tidak terdapat di file. Menghapus baris Excel bukan perintah menghapus data aplikasi.

## GIS sebagai sumber blok

Menu **Blok & Riwayat GIS** menampilkan ID, nama sekarang, nama lama, luas GIS saat ini, kepemilikan, status aktif, dan riwayat.

1. Download GeoJSON dengan ID dari menu tersebut.
2. Pertahankan kolom `blok_id` saat mengganti nama atau batas poligon di perangkat GIS.
3. Upload kembali ke layer yang sama, periksa pratinjau, lalu terapkan.
4. Pilih **Sudah milik kebun** hanya untuk lahan yang sudah terverifikasi. Blok aktif yang belum diverifikasi atau bukan milik kebun tidak masuk pilihan operasional.
5. Jika `blok_id` hilang, aplikasi mencocokkan nama yang dikenal. Bentuk identik dengan nama baru menghasilkan permintaan pencocokan; aplikasi tidak menebak berdasarkan kesamaan luas.
6. Blok hilang dari revisi dinonaktifkan, bukan dihapus.
7. Pecah/gabung memakai ID baru dan `parent_ids` berisi ID asal. Riwayat induk dapat ditelusuri tanpa menggandakan transaksi atau membagi hasil lama secara otomatis.

Nama pada kolom lama tetap diperbarui untuk kompatibilitas laporan/Excel. ID dan nama saat pencatatan juga disimpan. Nama atau rentang blok lama yang ambigu tetap dipertahankan untuk pemeriksaan; tidak otomatis dianggap milik kebun.

## Data dan pembaruan

Baca [panduan pembaruan aman](docs/UPGRADE.md) sebelum memperbarui instalasi yang berisi data.

Folder `data/` menyimpan database, akun, foto lokal, dan backup. Folder ini tidak masuk GitHub. Perubahan schema menambah tabel/kolom tanpa menghapus tabel atau transaksi lama. Gunakan database yang sama saat mengganti kode aplikasi.

Data panen padi lama yang belum bertanggal ditampilkan sebagai arsip terpisah. Data ini tidak dimasukkan ke hasil periode sampai tanggal panennya diverifikasi. Luas GIS saat ini dipisahkan dari luas operasional dan angka historis; revisi peta tidak menulis ulang hasil atau target pekerjaan lama.

## Excel

Download template terbaru pada modul terkait. Pertahankan **ID baris (jangan diubah)** dan **Versi baris (jangan diubah)** untuk revisi. File yang versinya tertinggal ditolak agar perubahan aplikasi tidak tertimpa. Baris baru diketik dengan ID dan versi kosong.

File lama tanpa ID masih dapat memasukkan data baru dan melewati baris yang identik. Koreksi data induk yang sudah ada memerlukan template baru. Jangan memakai penghilangan baris atau `KOSONG` untuk menghapus data; keduanya tidak menghapus data lama.

Sinkronisasi file lokal dijalankan terpisah setelah perubahan. Versi online memakai download/upload, bukan pemantauan file lokal.

## PDF dan WhatsApp

- Daily: buka daftar/detail laporan, pilih periode, klik **Unduh PDF** atau **Bagikan ke WhatsApp**.
- Owner: pilih periode di Ringkasan, klik **Unduh PDF** untuk laporan gabungan.
- Pembagian berkas memerlukan dukungan browser/perangkat dan biasanya HTTPS. Tombol pertama menyiapkan PDF, tombol berikutnya membuka pilihan berbagi. Pengguna memilih penerima dan mengirim sendiri.
- PDF memuat teks/tabel dan jumlah dokumentasi. Foto ditinjau melalui aplikasi oleh pengguna yang berwenang; foto tidak diunduh otomatis ke setiap PDF agar ukuran tetap ringan.
- Saldo stok dan pembayaran memakai kondisi tercatat saat PDF dibuat; detail transaksi mengikuti periode. Arsip tanpa tanggal diberi label tersendiri.

## Online: Vercel + Turso

Import repo ke Vercel dengan Framework Preset Other. Hubungkan database Turso dan Blob Private, lalu tetapkan:

- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `BLOB_READ_WRITE_TOKEN`
- `CRON_SECRET` untuk pembersihan foto

Redeploy setelah variabel diatur. Jangan mengganti database Turso saat hanya memperbarui kode. Pengaturan dan akun tetap berasal dari database yang sama. Foto mengikuti kebijakan retensi aplikasi (14 hari berdasarkan tanggal laporan, WIB; foto asli dan thumbnail dihapus otomatis); teks laporan tetap disimpan.

Opsional lokal: `PORT`, `DATA_DIR`, `EXCEL_FILE`, atau `data/online.json` untuk memakai database online dari komputer kantor. Jangan commit kredensial atau folder data.

## Pengujian

`npm test` menjalankan server dengan database terpisah di `work/`, lalu memeriksa migrasi, ID blok, rename, pekerjaan selesai, relasi pecah blok, kepemilikan, pagination, Excel aman, PDF, dan pembatasan akses mandor. Tidak menghubungi database operasional atau mengirim pesan WhatsApp.

Kinerja perangkat lapangan dan integrasi Turso/Blob perlu diverifikasi pada lingkungan staging; pengujian lokal tidak mengukur latensi jaringan produksi.
