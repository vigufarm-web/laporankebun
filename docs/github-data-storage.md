# Penyimpanan data GitHub

Mode ini menyimpan satu file SQLite yang dikompres dan dienkripsi AES-256-GCM
di repository data privat. Perhitungan SQL dilakukan pada salinan sementara di
server, bukan membaca baris berulang kali dari Turso. Kode aplikasi tetap
di-deploy dari repository aplikasi ke Vercel. Foto tetap memakai Blob dengan
aturan retensi 7 hari yang sama.

## Persiapan migrasi

1. Simpan backup SQLite terbaru dan periksa tanggal pembaruannya. Jangan
   mengganti database dengan seed atau menghapus layanan lama.
2. Jalankan `node scripts/prepare-github-data.mjs backup.db work/github-migration`.
   Paket berisi `kebun.enc.json`, `data-key.secret`, dan hasil audit. Folder ini
   wajib tetap diabaikan Git. Cadangkan kunci di tempat rahasia: kehilangan
   kunci membuat data terenkripsi tidak dapat dibaca.
3. Unggah **hanya** `kebun.enc.json` ke `storage/kebun.enc.json` di repository
   data privat. Kunci, token, database mentah, dan audit tidak boleh diunggah.
4. Pemilik akun membuat fine-grained personal access token yang hanya mencakup
   repository data, dengan Contents read/write. Token tidak dikirim ke browser
   mandor atau dimasukkan ke repository kode.
5. Atur environment server Vercel:

   | Nama | Isi |
   | --- | --- |
   | `DATA_BACKEND` | `github` |
   | `GITHUB_DATA_REPO` | `vigufarm-web/laporankebun-data` |
   | `GITHUB_DATA_BRANCH` | `main` |
   | `GITHUB_DATA_PATH` | `storage/kebun.enc.json` |
   | `GITHUB_DATA_TOKEN` | token khusus repository data |
   | `GITHUB_DATA_KEY` | isi `data-key.secret` |

6. Uji deployment terisolasi terlebih dahulu menggunakan salinan repository
   data. Jangan biarkan Preview dan Production sama-sama menulis data produksi.
7. Setelah aktivasi, periksa summary anonim, login admin dan mandor, hak akses,
   riwayat GIS, PDF, serta penyimpanan dan pembacaan ulang setelah cold start.

## Ketahanan dan batas penggunaan

- Versi lokal dicek ke GitHub paling sering sekali setiap 15 detik per instance
  untuk pembacaan. Pemeriksaan memakai ETag; SQL berikutnya bekerja lokal.
- Penulisan selalu memeriksa versi terbaru. Insert `_ver` dan blob SHA GitHub
  mencegah update dari dua instance menimpa data. Konflik menjadi HTTP 409 dan
  pengguna harus memuat ulang sebelum mengulangi perubahan.
- Respons sukses ditahan sampai commit GitHub selesai. Penulisan dengan
  respons jaringan ambigu tidak diputar ulang otomatis; salinan lokal harus
  disamakan dengan repository.
- File hilang, kunci salah, atau data rusak menggagalkan start. Sistem tidak
  membuat database kosong sebagai pengganti data lama.
- Setiap penulisan mengirim seluruh file terenkripsi. Cocok untuk data teks
  kecil dengan frekuensi input sedang; tetap memiliki batas API GitHub dan
  bukan pengganti database transaksi untuk beban tinggi. Jangan taruh foto
  atau lampiran besar di file database ini.
- Mode Turso tetap tersedia bila `DATA_BACKEND` tidak disetel `github`; tidak
  ada migrasi atau penghapusan otomatis pada database Turso.

API file dan pengaman SHA mengikuti
[GitHub Contents API](https://docs.github.com/en/rest/repos/contents).
ETag mengikuti [praktik REST GitHub](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).
