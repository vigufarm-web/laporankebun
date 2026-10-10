# Monitoring Kebun — PT VIGU FARM INDONESIA

Aplikasi web untuk memantau kebun **Pisang** dan **Padi**: stok bibit/benih, blok tertanam, progres tanam (LC → bajak → … → tanam), panen, iklim, dan peta lahan (GIS).

- **Semua orang bisa melihat** tanpa login.
- **Login Admin** (pojok kanan atas) untuk menambah, mengubah, dan menghapus data.
- Data bisa diisi lewat aplikasi **atau** lewat file Excel `Input Data Kebun.xlsx` (tersinkron dua arah).
- Ringan: ±2 MB, **tanpa `npm install`**. Database SQLite bawaan Node.js.

## Menjalankan

1. Pasang **Node.js versi 22.13 atau lebih baru** (disarankan versi 24 LTS) dari https://nodejs.org
2. Download repo ini (tombol hijau **Code → Download ZIP**, lalu ekstrak) atau `git clone`.
3. Klik dua kali **`Jalankan.bat`** (Windows) — browser terbuka di http://localhost:3000
   Atau lewat terminal: `npm start` (sama dengan `node server.js`).
4. Pertama kali dibuka: klik **Login Admin → Buat Admin** untuk membuat akun admin pertama.

HP/komputer lain di WiFi yang sama: buka alamat "Jaringan/HP" yang tampil di jendela server.

> Aplikasi ini butuh server Node.js yang menyala. GitHub hanya menyimpan kodenya — aplikasi tidak bisa dijalankan langsung dari GitHub Pages.

## Menu

| Menu | Isi |
|---|---|
| Ringkasan | Lahan serah terima, tertanam, progres minggu ini + peta, tanggal tanam per blok, panen |
| Pisang | Stok Bibit · Tertanam · Progres Tanam · Panen |
| Padi | Stok Benih · Tertanam · Progres Tanam · Panen |
| Iklim | Curah hujan, hari hujan, suhu, kelembapan per bulan |
| Peta & Lahan | Layer shapefile/GeoJSON, warna per status, ringkasan luas, catatan peta |
| Input Excel | Status sinkron, download & upload file Excel input |
| Sistem (setelah login) | Riwayat Perubahan · Pengguna & Akses · Pengaturan & Backup |

Admin bisa menambah **catatan mengambang** (📌) di setiap halaman, mis. kendala di lapangan. Catatan kosong tidak tampil.

## Data

Folder **`data/` tidak ikut di repo** (berisi database, akun login, dan cadangan). Saat pertama dijalankan aplikasi membuat:

- `data/kebun.db` — database (data kosong + urutan aktivitas bawaan)
- `data/backup/` — cadangan otomatis terkompres `.db.gz`, 10 terakhir
- `Input Data Kebun.xlsx` — file Excel input

**Memindahkan data ke komputer lain:** matikan server, salin folder `data/` (dan `Input Data Kebun.xlsx`) dari komputer lama ke folder aplikasi di komputer baru.
**Memulihkan cadangan:** ekstrak `.db.gz` (mis. dengan 7-Zip) → ganti `data/kebun.db` saat server mati.

⚠️ Jangan upload folder `data/` atau file Excel ke GitHub — sudah dikecualikan lewat `.gitignore`.

## Input lewat Excel

Ubah/tambah/hapus baris di `Input Data Kebun.xlsx` lalu simpan → aplikasi otomatis ter-update (server harus menyala). Setiap sheet = isi lengkap satu tabel; sheet yang ada kesalahan dilewati dan dilaporkan di menu **Input Excel**. Perubahan lewat aplikasi juga ditulis balik ke file Excel (menunggu file ditutup bila sedang dibuka di Excel).

## Login & akses

- Admin membuat akun lain di **Pengguna & Akses** dan memilih perannya (Management = hanya lihat, Panen Pisang, Panen Padi, Kebun Pisang, Kebun Padi, Progres Tanam, Iklim, GIS, Admin).
- Izin dicek di server. Login salah 5× → dikunci 5 menit. Sesi berlaku 30 hari.
- Setiap perubahan tercatat di **Riwayat Perubahan** beserta nama pengubahnya.

## Pengaturan lanjutan

Variabel lingkungan (opsional): `PORT` (bawaan 3000), `DATA_DIR` (folder database), `EXCEL_FILE` (lokasi file Excel).

## Struktur

```
server.js            server HTTP + API + sinkron Excel (node:http, node:sqlite)
lib/excel.js         baca/tulis file Excel input
lib/exceljs.min.cjs  pustaka ExcelJS (file tunggal)
public/              tampilan web (HTML, CSS, JS modul)
public/js/schema.js  definisi semua tabel & kolom — tambah kolom di sini, kolom baru dibuat otomatis
public/vendor/       Leaflet, Chart.js, shpjs (dimuat hanya saat dibutuhkan)
Jalankan.bat         pintasan menjalankan server di Windows
```
