@echo off
title Monitoring Kebun - Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang. Download versi LTS di https://nodejs.org lalu jalankan file ini lagi.
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\@vercel\blob\package.json" (
  echo Menyiapkan komponen upload foto...
  call npm install
  if errorlevel 1 (
    echo Gagal menyiapkan komponen. Periksa koneksi internet lalu coba lagi.
    pause
    exit /b 1
  )
)
start "" http://localhost:3000
node server.js
pause
