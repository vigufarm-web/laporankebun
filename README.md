# Monitoring Kebun — PT VIGU FARM INDONESIA

Aplikasi web untuk memantau kebun **Pisang**, **Padi**, dan **Infra**: stok bibit/benih, blok tertanam, progres tanam, panen, Daily Report, iklim, dan peta lahan (GIS).

- Halaman owner bisa dilihat tanpa login. Akun mandor hanya melihat input dan riwayat Daily Report divisinya sendiri.
- **Login Admin** (pojok kanan atas) untuk menambah, mengubah, dan menghapus data.
- Data bisa diisi lewat aplikasi **atau** lewat file Excel `Input Data Kebun.xlsx` (tersinkron dua arah).
- Ringan dan tanpa framework. Database SQLite bawaan Node.js; paket resmi Vercel Blob dipakai khusus untuk foto online.

## Menjalankan

1. Pasang **Node.js versi 22.13 atau lebih baru** (disarankan versi 24 LTS) dari https://nodejs.org
2. Download repo ini (tombol hijau **Code → Download ZIP**, lalu ekstrak) atau `git clone`.
3. Klik dua kali **`Jalankan.bat`** (Windows) — komponen foto disiapkan otomatis lalu browser terbuka di http://localhost:3000
   Atau lewat terminal: `npm start` (sama dengan `node server.js`).
4. Pertama kali dibuka: klik **Login Admin → Buat Admin** untuk membuat akun admin pertama.

HP/komputer lain di WiFi yang sama: buka alamat "Jaringan/HP" yang tampil di jendela server.

## Versi online (Vercel + Turso)

Repo ini bisa langsung di-deploy ke Vercel. Data online disimpan di database **Turso** (gratis).

1. Vercel → **Create New → Project → Import** repo ini → Framework Preset **Other** → **Deploy**.
2. Di proyek Vercel: **Storage → Create Database → Turso** → hubungkan (**Connect**) ke proyek ini.
   Variabel `TURSO_DATABASE_URL` dan `TURSO_AUTH_TOKEN` otomatis terisi.
3. **Storage → Create Database → Blob → Private**, lalu hubungkan ke proyek. Variabel `BLOB_READ_WRITE_TOKEN` otomatis terisi.
4. Tambahkan Environment Variable `CRON_SECRET` dengan teks acak panjang.
5. **Deployments → ⋯ → Redeploy** supaya semua variabel baru terbaca.
6. Buka link proyek → **Login Admin → Buat Admin**.
7. Memindahkan data dari komputer: di aplikasi komputer **Pengaturan & Backup → Download backup database**,
   lalu di versi online **Pengaturan & Backup → Pindahkan / pulihkan database** → pilih file tersebut.

Di versi online: input Excel lewat **Download → isi → Upload** (tidak ada file Excel yang dipantau), backup lewat **Download backup database**.

**Komputer kantor memakai data yang sama dengan versi online (opsional):** buat file `data/online.json` berisi
`{"url": "<TURSO_DATABASE_URL>", "token": "<TURSO_AUTH_TOKEN>"}` lalu jalankan ulang `Jalankan.bat`.
File Excel di komputer tetap tersinkron dua arah, dan perubahan dari online masuk ke file Excel dalam ±1 menit.
File `data/` tidak pernah ikut ke GitHub.

## Menu

| Menu | Isi |
|---|---|
| Ringkasan | Lahan serah terima, tertanam, progres minggu ini + peta, tanggal tanam per blok, panen |
| Daily Report | Dashboard owner seluruh divisi, filter harian/7 hari/14 hari/bulanan/siklus, HI, SDHI, target, capaian, HK, kendala, alat dan foto |
| Pisang | Stok Bibit · Tertanam · Progres Tanam · Panen |
| Padi | Stok Benih · Tertanam · Progres Tanam · Panen |
| Iklim | Curah hujan, hari hujan, suhu, kelembapan per bulan |
| Peta & Lahan | Layer shapefile/GeoJSON, warna per status, ringkasan luas, catatan peta |
| Input Excel | Status sinkron, download & upload file Excel input |
| Sistem (setelah login) | Riwayat Perubahan · Pengguna & Akses · Pengaturan & Backup |

Admin bisa menambah **catatan mengambang** (📌) di setiap halaman, mis. kendala di lapangan. Catatan kosong tidak tampil.

## Data

Folder **`data/` tidak ikut di repo** (berisi database, akun login, dan cadangan). Saat pertama dijalankan aplikasi membuat:

- `data/kebun.db` — database aplikasi. Pada pemasangan baru, data awal dari Excel dan peta persil dalam paket otomatis dimasukkan.
- `data/backup/` — cadangan otomatis terkompres `.db.gz`, 10 terakhir
- `Input Data Kebun.xlsx` — file Excel input

**Memindahkan data ke komputer lain:** matikan server, salin folder `data/` (dan `Input Data Kebun.xlsx`) dari komputer lama ke folder aplikasi di komputer baru.
**Memulihkan cadangan:** ekstrak `.db.gz` (mis. dengan 7-Zip) → ganti `data/kebun.db` saat server mati.

⚠️ Jangan upload folder `data/` ke GitHub karena berisi akun dan database aktif. File Excel contoh dalam paket boleh tetap ada sebagai data awal; untuk pembaruan online gunakan menu upload/backup di aplikasi.

## Input lewat Excel

Ubah/tambah/hapus baris di `Input Data Kebun.xlsx` lalu simpan → aplikasi otomatis ter-update (server harus menyala). Setiap sheet = isi lengkap satu tabel; sheet yang ada kesalahan dilewati dan dilaporkan di menu **Input Excel**. Perubahan lewat aplikasi juga ditulis balik ke file Excel (menunggu file ditutup bila sedang dibuka di Excel).

## Login & akses

- Admin membuat akun lain di **Pengguna & Akses** dan memilih perannya: **Daily Report — Pisang**, **Daily Report — Padi**, atau **Daily Report — Infra**. Nama penginput otomatis diambil dari akun yang sedang login. Setelah login, pengguna lapangan langsung masuk ke halaman khusus dan tidak dapat membuka halaman utama/divisi lain. Management/Owner hanya melihat.
- Izin dicek di server. Login salah 5× → dikunci 5 menit. Sesi berlaku 30 hari.
- Setiap perubahan tercatat di **Riwayat Perubahan** beserta nama pengubahnya.

## Pengaturan lanjutan

Daily Report dapat dibuka langsung di `/daily`. **Rencana Mingguan** dan **Realisasi Harian** dibuat terpisah supaya alurnya sesuai pekerjaan lapangan. Pada rencana, pilih satu tanggal minggu pelaksanaan; sistem otomatis memakai Senin–Minggu sehingga tidak perlu mengetik tanggal awal dan akhir. Jika formulir dibuka Sabtu/Minggu, minggu berikutnya dipilih otomatis. Pilih blok lebih dahulu, lalu tambahkan beberapa kegiatan beserta target, satuan, dan HK rencana.

Saat membuat realisasi harian, kegiatan pada rencana minggu tersebut dimuat otomatis. Kegiatan mendadak tetap dapat diinput dan diberi tanda **Tambahan di luar rencana**. HI diisi setiap hari dan SDHI dihitung otomatis dari akumulasi realisasi pada blok, kegiatan, dan minggu yang sama. Daftar blok menempatkan petak Pisang, Padi, dan lokasi berkomoditas di bagian atas; nama yang hanya berupa nomor ditempatkan paling bawah.

Owner mendapatkan tiga kartu divisi yang dapat diklik (**Pisang, Padi, Infra**) dan rekap kegiatan berdasarkan **Hari ini, 7 hari, 14 hari, Bulanan, atau Siklus**. Tabel rekap menampilkan tanggal, divisi, blok, pekerjaan, HK, hasil hari ini (**HI**), hasil kumulatif sampai hari ini (**SDHI**), target, capaian, dan status laporan.

Di bawah tabel terdapat **galeri foto kegiatan Daily Report** yang otomatis mengikuti divisi dan periode terpilih. Di rekap owner, kegiatan yang sama pada beberapa blok digabung menjadi satu baris; blok aktif tetap dicantumkan dan angka hasil, HK, serta target dijumlahkan. Daftar lokasi diambil dari data kebun dan GIS, termasuk blok Pisang, petak Padi, blok pembukaan lahan, Embung, Packing House, gudang, pompa, pos, dan titik lokasi lainnya. Target lama tetap terbaca sebagai data kompatibilitas; data asli lainnya tidak diubah.

Data teks tersimpan tanpa batas. Foto yang diunggah langsung melalui aplikasi dikompres di browser, disimpan privat, dan dihapus otomatis setelah 14 hari; metadata bahwa foto pernah ada tetap tersimpan. Paket ini juga menyertakan data laporan awal dua minggu terakhir tanpa menampilkan sumber maupun nama mandor, dan tidak menimpa laporan yang sudah ada.

Variabel lingkungan (opsional): `PORT` (bawaan 3000), `DATA_DIR` (folder database), `EXCEL_FILE` (lokasi file Excel), `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (database online), `BLOB_READ_WRITE_TOKEN` (foto privat), dan `CRON_SECRET` (pembersihan foto harian).

## Struktur

```
server.js            server HTTP + API + sinkron Excel (node:http, node:sqlite)
vercel.json          pengaturan versi online (Vercel menjalankan server.js sebagai satu fungsi)
lib/turso.js         sambungan ke database online Turso (lewat HTTP, tanpa paket tambahan)
lib/excel.js         baca/tulis file Excel input
lib/exceljs.min.cjs  pustaka ExcelJS (file tunggal)
public/              tampilan web (HTML, CSS, JS modul)
public/js/schema.js  definisi semua tabel & kolom — tambah kolom di sini, kolom baru dibuat otomatis
public/vendor/       Leaflet, Chart.js, shpjs (dimuat hanya saat dibutuhkan)
Jalankan.bat         pintasan menjalankan server di Windows
```
