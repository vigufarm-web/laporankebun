// Server lokal Monitoring Kebun — Node.js (tanpa dependensi server) + SQLite bawaan Node.
// Jalankan: node server.js   lalu buka http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERCEL = !!process.env.VERCEL; // berjalan online di Vercel: tidak ada folder tetap, hanya /tmp
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : VERCEL ? path.join(os.tmpdir(), 'kebun') : path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const DB_FILE = path.join(DATA_DIR, 'kebun.db');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const { TABLES, SEED, SEED_SEKALI, KECEPATAN_AWAL, liburDefault, alatDefault, susunRencana, ROLES, canEdit, isAdmin, displayOf, EXCEL_SHEETS, util } = await import('./public/js/schema.js');
const { buildWorkbook, parseWorkbook, sheetFields, simpleWorkbook } = await import('./lib/excel.js');
const { turso, onlineConfig } = await import('./lib/turso.js');

// ---------- database online (Turso) — dari variabel lingkungan (Vercel) atau file data/online.json {url, token}
const ONLINE = (() => {
  const env = onlineConfig(process.env);
  if (env) return env;
  try { const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'online.json'), 'utf8')); return j.url && j.token ? j : null; } catch { return null; }
})();
const BELUM_ONLINE = VERCEL && !ONLINE; // di Vercel tapi database Turso belum disambungkan → tampilkan petunjuk
const cloud = ONLINE ? turso(ONLINE.url, ONLINE.token) : null;

// Mode online: data dibaca dari salinan di memori (cepat), setiap perubahan dikirim ke database online sebagai satu transaksi.
// Nomor versi (_ver) mencegah dua tempat menimpa perubahan satu sama lain.
let raw = null, ver = 0, txMark = -1;
const pend = [];
const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i;
const db = {
  prepare(sql) {
    const st = raw.prepare(sql);
    if (!cloud || !WRITE.test(sql)) return st;
    return { run: (...a) => { const r = st.run(...a); pend.push({ sql, args: a }); return r; }, get: (...a) => st.get(...a), all: (...a) => st.all(...a) };
  },
  exec(sql) {
    raw.exec(sql);
    if (!cloud) return;
    const s = sql.trim().toUpperCase();
    if (s === 'BEGIN') txMark = pend.length;
    else if (s === 'COMMIT') txMark = -1;
    else if (s === 'ROLLBACK') { if (txMark >= 0) pend.length = txMark; txMark = -1; }
    else if (WRITE.test(sql)) pend.push({ sql });
  },
};
const q = (s) => `"${s.replace(/"/g, '')}"`;
async function loadCloud(coba = 0) {
  // daftar tabel + nomor versi dulu, lalu semua isi dibaca dalam SATU transaksi baca (potret yang konsisten).
  // Kalau ada yang menyimpan di antara keduanya (versi berubah) → ulangi.
  const [master, [v0]] = await cloud.query(["SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '\\_litestream%' ESCAPE '\\'", 'SELECT MAX(v) v FROM _ver']);
  const tables = master.filter((t) => !t.name.startsWith('sqlite_'));
  const hasSeq = master.some((t) => t.name === 'sqlite_sequence'), hasVer = true;
  const res = (await cloud.query(['BEGIN', ...tables.map((t) => `SELECT * FROM ${q(t.name)}`), ...(hasSeq ? ['SELECT name, seq FROM sqlite_sequence'] : []), 'SELECT MAX(v) v FROM _ver', 'COMMIT'])).slice(1, -1);
  if (Number(res[res.length - 1][0]?.v || 0) !== Number(v0?.v || 0)) {
    if (coba < 5) return loadCloud(coba + 1);
    throw new Error('Database online sedang sibuk, coba lagi sebentar');
  }
  const mem = new DatabaseSync(':memory:');
  mem.exec('BEGIN');
  tables.forEach((t, i) => {
    mem.exec(t.sql);
    const rows = res[i]; if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const st = mem.prepare(`INSERT INTO ${q(t.name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    for (const r of rows) st.run(...cols.map((c) => r[c]));
  });
  if (hasSeq) { mem.exec('DELETE FROM sqlite_sequence'); const st = mem.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)'); for (const s of res[tables.length]) st.run(s.name, s.seq); }
  mem.exec('COMMIT');
  const old = raw; raw = mem; old?.close();
  ver = hasVer ? Number(res[res.length - 1][0]?.v || 0) : 0;
}
// kirim perubahan yang tertunda ke database online (dipecah bila sangat besar, mis. pulihkan database)
async function flush() {
  if (!cloud || !pend.length) return;
  const list = pend.splice(0), nv = ver + 1, chunks = [[]];
  let size = 0;
  for (const s of list) { const z = JSON.stringify(s.args || '').length + s.sql.length; if (size + z > 3e6 && chunks.at(-1).length) { chunks.push([]); size = 0; } chunks.at(-1).push(s); size += z; }
  try {
    for (const [i, c] of chunks.entries()) await cloud.batch([...(i === 0 ? [{ sql: 'INSERT INTO _ver (v) VALUES (?)', args: [nv] }] : []), ...c, ...(i === chunks.length - 1 ? [{ sql: 'DELETE FROM _ver WHERE v < ?', args: [nv - 20] }] : [])]);
    ver = nv;
  } catch (e) { await loadCloud(); throw e; } // salinan di memori disamakan lagi dengan isi online
}
// ada perubahan dari tempat lain (perangkat/instance lain)? → muat ulang salinan
async function syncCloud() {
  if (!cloud) return false;
  const [[r]] = await cloud.query(['SELECT MAX(v) v FROM _ver']);
  if (Number(r.v || 0) === ver) return false;
  await loadCloud(); return true;
}
// satu permintaan pada satu waktu dalam mode online (urutan perubahan & nomor versi tetap rapi)
let lock = Promise.resolve();
const serial = (fn) => { const p = lock.then(fn, fn); lock = p.catch(() => {}); return p; };

if (cloud) { await cloud.batch(['CREATE TABLE IF NOT EXISTS _ver (v INTEGER PRIMARY KEY)']); await loadCloud(); }
else if (BELUM_ONLINE) raw = new DatabaseSync(':memory:');
else {
  raw = new DatabaseSync(DB_FILE);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA journal_size_limit=1048576;');
  // rapikan file database: buang ruang kosong bekas data terhapus & kecilkan log transaksi
  const free = raw.prepare('PRAGMA freelist_count').get().freelist_count * raw.prepare('PRAGMA page_size').get().page_size;
  if (free > 256 * 1024) raw.exec('VACUUM');
  raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  setInterval(() => { try { raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {} }, 10 * 60e3).unref();
}

// ---------- migrasi otomatis: buat tabel & tambah kolom baru sesuai schema.js
const colType = (f) => (f.t === 'int' ? 'INTEGER' : f.t === 'num' || f.t === 'money' ? 'REAL' : 'TEXT');
function migrate() {
  const ada = (n) => !!raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
  if (!ada('_log')) db.exec(`CREATE TABLE IF NOT EXISTS _log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, aksi TEXT, tabel TEXT, row_id INTEGER, data TEXT)`);
  if (!ada('_settings')) db.exec(`CREATE TABLE IF NOT EXISTS _settings (k TEXT PRIMARY KEY, v TEXT)`);
  if (!ada('_users')) db.exec(`CREATE TABLE IF NOT EXISTS _users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nama TEXT, peran TEXT, salt TEXT, hash TEXT, aktif INTEGER DEFAULT 1, created_at TEXT, last_login TEXT)`);
  if (!ada('_sessions')) db.exec(`CREATE TABLE IF NOT EXISTS _sessions (token TEXT PRIMARY KEY, user_id INTEGER, expires TEXT)`);
  if (!db.prepare('PRAGMA table_info(_log)').all().some((c) => c.name === 'oleh')) db.exec('ALTER TABLE _log ADD COLUMN oleh TEXT');
  for (const [name, t] of Object.entries(TABLES)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${q(name)})`).all().map((c) => c.name));
    if (!have.size) db.exec(`CREATE TABLE IF NOT EXISTS ${q(name)} (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, updated_at TEXT)`);
    const baru = have.size === 0; // tabel baru dibuat — tidak perlu daftar kolom
    for (const f of t.f) {
      if (f.t !== 'calc' && !have.has(f.k)) {
        db.exec(`ALTER TABLE ${q(name)} ADD COLUMN ${q(f.k)} ${colType(f)}`);
        if (!baru) console.log(`  + kolom baru ${name}.${f.k}`);
      }
    }
  }
}
migrate();

// ---------- backup otomatis (simpan 10 terakhir; saat start hanya bila ada perubahan sejak backup terakhir)
// backup disimpan terkompres (.db.gz, ±5× lebih kecil). Memulihkan: ekstrak dengan 7-Zip/WinRAR → ganti data/kebun.db
const BACKUP_KEEP = 10;
const backupFiles = () => fs.readdirSync(BACKUP_DIR).filter((f) => /\.db(\.gz)?$/.test(f))
  .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs })).sort((a, b) => a.t - b.t);
function pruneBackups() { const files = backupFiles(); while (files.length > BACKUP_KEEP) fs.unlinkSync(path.join(BACKUP_DIR, files.shift().f)); }
function backup(tag = 'auto', { gzip = true } = {}) {
  if (VERCEL) return ''; // online: tidak ada folder tetap; cadangan ada di database online
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, `kebun_${tag}_${ts}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  let out = file;
  if (gzip) { out = file + '.gz'; fs.writeFileSync(out, zlib.gzipSync(fs.readFileSync(file), { level: 9 })); fs.unlinkSync(file); }
  pruneBackups();
  return out;
}
if (!VERCEL) try {
  // backup lama yang belum dikompres → dikompres (isi sama persis, ukuran ±5× lebih kecil)
  for (const { f } of backupFiles().filter((x) => x.f.endsWith('.db'))) {
    const src = path.join(BACKUP_DIR, f), st = fs.statSync(src);
    fs.writeFileSync(src + '.gz', zlib.gzipSync(fs.readFileSync(src), { level: 9 }));
    fs.utimesSync(src + '.gz', st.atime, st.mtime); fs.unlinkSync(src);
  }
  pruneBackups();
  const last = backupFiles().pop();
  const lastChange = db.prepare('SELECT MAX(ts) t FROM _log').get().t || '';
  if (!last || lastChange > new Date(last.t).toISOString()) backup('start');
} catch (e) { console.warn('Backup gagal:', e.message); }

// ---------- helper data
const now = () => new Date().toISOString();
function fieldsOf(table) { return TABLES[table].f.filter((f) => f.t !== 'calc'); }
function clean(table, row) {
  const out = {};
  for (const f of fieldsOf(table)) {
    if (!(f.k in row)) continue;
    let v = row[f.k];
    if (v === '' || v === undefined) v = null;
    if (v != null && (f.t === 'int' || f.t === 'num' || f.t === 'money')) {
      v = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, ''));
      if (!Number.isFinite(v)) v = null;
      else if (f.t === 'int') v = Math.round(v);
    } else if (v != null) v = String(v);
    out[f.k] = v;
  }
  return out;
}
let currentUser = null; // pengguna yang sedang memproses request (dipakai untuk log)
function log(aksi, tabel, id, data) {
  db.prepare('INSERT INTO _log (ts, aksi, tabel, row_id, data, oleh) VALUES (?,?,?,?,?,?)').run(now(), aksi, tabel, id ?? null, data ? JSON.stringify(data).slice(0, 4000) : null, currentUser ? currentUser.nama || currentUser.username : null);
}

// ---------- login & sesi
const SESSION_DAYS = 30;
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
function setPassword(id, pw) { const salt = crypto.randomBytes(16).toString('hex'); db.prepare('UPDATE _users SET salt=?, hash=? WHERE id=?').run(salt, hashPw(pw, salt), id); }
function publicUser(u) { return u && { id: u.id, username: u.username, nama: u.nama, peran: JSON.parse(u.peran || '[]'), aktif: u.aktif, last_login: u.last_login }; }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])); }
function sessionUser(req) {
  const tok = cookies(req).kebun_sid; if (!tok) return null;
  const s = db.prepare('SELECT * FROM _sessions WHERE token=?').get(tok);
  if (!s || s.expires < now()) return null;
  const u = db.prepare('SELECT * FROM _users WHERE id=? AND aktif=1').get(s.user_id);
  return u ? publicUser(u) : null;
}
function startSession(res, userId) {
  const tok = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO _sessions (token, user_id, expires) VALUES (?,?,?)').run(tok, userId, exp);
  db.prepare('DELETE FROM _sessions WHERE expires < ?').run(now());
  db.prepare('UPDATE _users SET last_login=? WHERE id=?').run(now(), userId);
  res.setHeader('Set-Cookie', `kebun_sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}
const userCount = () => db.prepare('SELECT COUNT(*) c FROM _users').get().c;
const cleanPeran = (p) => JSON.stringify((Array.isArray(p) ? p : []).filter((r) => ROLES[r]));
const failed = new Map(); // percobaan login gagal per username (cegah tebak password)
function insertRow(table, row, doLog = true) {
  const r = clean(table, row);
  const cols = Object.keys(r);
  const sql = `INSERT INTO ${q(table)} (created_at, updated_at${cols.map((c) => ', ' + q(c)).join('')}) VALUES (?, ?${cols.map(() => ', ?').join('')})`;
  const t = now();
  const res = db.prepare(sql).run(t, t, ...cols.map((c) => r[c]));
  const id = Number(res.lastInsertRowid);
  if (doLog) log('tambah', table, id, table === 'gis_layer' ? { nama: r.nama } : r);
  return id;
}
// ---------- keterhubungan data (field bertipe ref menyimpan nama induk, mis. nama blok)
const refsTo = (table) => Object.entries(TABLES).flatMap(([t, T]) => T.f.filter((f) => f.t === 'ref' && f.ref === table).map((f) => ({ t, k: f.k })));
// ganti nama induk → perbarui semua anak (berantai, mis. petak → musim tanam → panen)
function cascadeRename(table, oldVal, newVal, depth = 0) {
  let total = 0;
  for (const { t, k } of refsTo(table)) {
    for (const r of db.prepare(`SELECT * FROM ${q(t)} WHERE ${q(k)}=?`).all(oldVal)) {
      const before = TABLES[t].display ? displayOf(t, r) : null;
      db.prepare(`UPDATE ${q(t)} SET ${q(k)}=?, updated_at=? WHERE id=?`).run(newVal, now(), r.id); total++;
      if (before != null && depth < 3) { const after = displayOf(t, { ...r, [k]: newVal }); if (after !== before) total += cascadeRename(t, before, after, depth + 1); }
    }
  }
  return total;
}
// jumlah data anak yang merujuk ke baris induk ini
function childRefs(table, row) {
  if (!TABLES[table].display) return [];
  const v = displayOf(table, row); if (!v) return [];
  return refsTo(table).map(({ t, k }) => ({ tabel: TABLES[t].title, n: db.prepare(`SELECT COUNT(*) c FROM ${q(t)} WHERE ${q(k)}=?`).get(v).c })).filter((x) => x.n > 0);
}
function mergeRefs(list) { const m = {}; for (const l of list) for (const x of l) m[x.tabel] = (m[x.tabel] || 0) + x.n; return Object.entries(m).map(([tabel, n]) => ({ tabel, n })); }
function deleteChildren(table, row, depth = 0) {
  if (!TABLES[table].display || depth > 3) return 0;
  const v = displayOf(table, row); let total = 0;
  for (const { t, k } of refsTo(table)) for (const r of db.prepare(`SELECT * FROM ${q(t)} WHERE ${q(k)}=?`).all(v)) {
    total += deleteChildren(t, r, depth + 1);
    db.prepare(`DELETE FROM ${q(t)} WHERE id=?`).run(r.id); total++;
  }
  return total;
}
function tx(fn) {
  db.exec('BEGIN');
  try { const v = fn(); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// data awal untuk tabel yang masih kosong
function seed() {
  for (const [name, rows] of Object.entries(SEED)) {
    if (db.prepare(`SELECT COUNT(*) c FROM ${q(name)}`).get().c === 0) for (const r of rows) insertRow(name, r, false);
  }
  // urutan aktivitas progres tanam dipisah per komoditas (data lama = Pisang); tambahkan urutan Padi bila belum ada
  if (db.prepare(`SELECT 1 FROM lahan_aktivitas WHERE untuk IS NULL OR untuk=''`).get()) db.exec(`UPDATE lahan_aktivitas SET untuk='Pisang' WHERE untuk IS NULL OR untuk=''`);
  if (!db.prepare(`SELECT 1 FROM lahan_aktivitas WHERE untuk='Padi'`).get())
    for (const r of SEED.lahan_aktivitas.filter((x) => x.untuk === 'Padi')) insertRow('lahan_aktivitas', r, false);
  // data awal sekali saja (mis. target tanam Q4): bila tabel kosong & belum pernah diisi
  for (const [name, rows] of Object.entries(SEED_SEKALI || {})) {
    const flag = 'seed:' + name;
    if (db.prepare('SELECT 1 FROM _settings WHERE k=?').get(flag)) continue;
    if (db.prepare(`SELECT COUNT(*) c FROM ${q(name)}`).get().c === 0) for (const r of rows) insertRow(name, r, false);
    db.prepare('INSERT INTO _settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(flag, now());
  }
  // kecepatan kerja (hari/ha), jumlah tim & hari libur per kegiatan pisang — diisi sekali bila masih kosong (dipakai Rencana Kerja)
  if (!db.prepare('SELECT 1 FROM _settings WHERE k=?').get('isi:kecepatan')) {
    for (const a of db.prepare(`SELECT id, aktivitas, hari_per_ha, tim, libur FROM lahan_aktivitas WHERE untuk='Pisang'`).all()) {
      const v = { hari_per_ha: a.hari_per_ha ?? KECEPATAN_AWAL[a.aktivitas] ?? null, tim: a.tim ?? 1, libur: a.libur || liburDefault(a.aktivitas) };
      db.prepare('UPDATE lahan_aktivitas SET hari_per_ha=?, tim=?, libur=?, updated_at=? WHERE id=?').run(v.hari_per_ha, v.tim, v.libur, now(), a.id);
    }
    db.prepare('INSERT INTO _settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('isi:kecepatan', now());
  }
  const tandai = (k) => db.prepare('INSERT INTO _settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, now());
  const sudah = (k) => !!db.prepare('SELECT 1 FROM _settings WHERE k=?').get(k);
  // alat bersama (user): Bajak 1 & Bajak 2 = 1 traktor, Land Clearing = 1 alat — diisi sekali bila kosong
  if (!sudah('isi:alat')) {
    for (const a of db.prepare(`SELECT id, aktivitas, alat FROM lahan_aktivitas WHERE untuk='Pisang'`).all())
      if (!a.alat && alatDefault(a.aktivitas)) db.prepare('UPDATE lahan_aktivitas SET alat=?, updated_at=? WHERE id=?').run(alatDefault(a.aktivitas), now(), a.id);
    tandai('isi:alat');
  }
  // Rencana Kerja dibuat otomatis SEKALI (permintaan user): dari progres saat ini, mulai hari ini (WIB).
  // v2 = aturan alat bersama → rencana otomatis versi pertama (seed:lahan_rencana) diganti sekali; rencana yang disusun admin tidak disentuh.
  // Susun ulang berikutnya lewat tombol "Susun rencana kerja" di halaman Progres Tanam (admin).
  if (!sudah('seed:lahan_rencana_v2')) {
    const kosong = db.prepare('SELECT COUNT(*) c FROM lahan_rencana').get().c === 0;
    const otomatisLama = sudah('seed:lahan_rencana') && !db.prepare("SELECT 1 FROM _log WHERE tabel='lahan_rencana' LIMIT 1").get();
    if (kosong || otomatisLama) {
      const c = { rows: (t) => db.prepare(`SELECT * FROM ${q(t)}`).all() };
      const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      const rows = susunRencana(c, hariIni);
      db.exec('DELETE FROM lahan_rencana');
      for (const r of rows) insertRow('lahan_rencana', r, false);
    }
    tandai('seed:lahan_rencana'); tandai('seed:lahan_rencana_v2');
  }
}
seed();
// mode online: tabel/kolom baru & data awal ikut dibuat di database online.
// Dua salinan aplikasi menyala bersamaan → yang kalah memuat ulang isi online lalu cek lagi (tidak berhenti/crash).
for (let i = 0; ; i++) {
  try { await flush(); break; } catch (e) { if (!e.conflict || i >= 4) throw e; migrate(); seed(); }
}

// pulihkan / pindahkan seluruh isi database dari file .db (mis. dari komputer kantor ke online)
function restoreFrom(file, keepUser) {
  const src = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = src.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_ver', '_sessions')").all();
    if (!tables.some((t) => t.name === '_users') || !tables.some((t) => t.name === 'lahan_blok')) throw new Error('File ini bukan database Monitoring Kebun');
    const counts = {};
    tx(() => {
      const keep = new Set(['_ver', '_sessions']);
      for (const t of raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) if (!keep.has(t.name)) db.exec(`DROP TABLE ${q(t.name)}`);
      for (const t of tables) {
        db.exec(t.sql);
        const rows = src.prepare(`SELECT * FROM ${q(t.name)}`).all();
        counts[t.name] = rows.length;
        if (!rows.length) continue;
        const cols = Object.keys(rows[0]);
        const sql = `INSERT INTO ${q(t.name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
        for (const r of rows) db.prepare(sql).run(...cols.map((c) => r[c]));
      }
      db.prepare('DELETE FROM _sessions').run();
      migrate(); seed();
      // admin yang memulihkan tetap bisa login walau akunnya tidak ada di file (mis. admin sementara di versi online)
      if (keepUser && !db.prepare('SELECT 1 FROM _users WHERE username=?').get(keepUser.username)) {
        db.prepare('INSERT INTO _users (username, nama, peran, salt, hash, aktif, created_at) VALUES (?,?,?,?,?,1,?)').run(keepUser.username, keepUser.nama, keepUser.peran, keepUser.salt, keepUser.hash, keepUser.created_at || now());
        counts._users = (counts._users || 0) + 1;
      }
    });
    return counts;
  } finally { src.close(); }
}

// ---------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.map': 'application/json' };
// kirim respons; teks/JSON > 1 KB dikompres gzip (data jadi ±5–10× lebih kecil di jaringan)
const canGzip = (res, type) => /json|text|javascript|css|svg/.test(type) && /\bgzip\b/.test(res.req?.headers['accept-encoding'] || '');
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const h = { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra };
  if (buf.length > 1024 && canGzip(res, type)) { buf = zlib.gzipSync(buf, { level: 6 }); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; }
  h['Content-Length'] = buf.length;
  res.writeHead(code, h); res.end(buf);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 80e6) { reject(new Error('Data terlalu besar')); req.destroy(); } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 50e6) { reject(new Error('File terlalu besar')); req.destroy(); } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// file statis: pustaka /vendor disimpan browser 30 hari; file aplikasi dicek ulang (304 bila tidak berubah)
const gzCache = new Map(); // file → { etag, gz }
function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Tidak ditemukan', 'text/plain');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
    const h = { ETag: etag, 'Cache-Control': file.includes(`${path.sep}vendor${path.sep}`) ? 'public, max-age=2592000' : 'no-cache', 'Content-Type': type };
    if (res.req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
    fs.readFile(file, (e2, buf) => {
      if (e2) return send(res, 404, 'Tidak ditemukan', 'text/plain');
      if (buf.length > 1024 && canGzip(res, type)) {
        let c = gzCache.get(file);
        if (!c || c.etag !== etag) { c = { etag, gz: zlib.gzipSync(buf, { level: 9 }) }; gzCache.set(file, c); }
        buf = c.gz; h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding';
      }
      h['Content-Length'] = buf.length;
      res.writeHead(200, h); res.end(buf);
    });
  });
}
function safeJoin(base, rel) {
  const b = path.normalize(base), p = path.normalize(path.join(b, rel));
  return p === b || p.startsWith(b + path.sep) ? p : null;
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const m = req.method;
  const user = sessionUser(req);
  currentUser = user;

  // --- akun pertama (admin) & login
  if (parts[1] === 'me' && m === 'GET') return send(res, 200, { user, setup: userCount() === 0, roles: ROLES, online: !!cloud, vercel: VERCEL });
  if (parts[1] === 'setup' && m === 'POST') {
    if (userCount() > 0) return send(res, 403, { error: 'Admin sudah dibuat' });
    const b = await readBody(req);
    if (!b.username || String(b.password || '').length < 6) return send(res, 400, { error: 'Username wajib & password minimal 6 karakter' });
    const id = Number(db.prepare('INSERT INTO _users (username, nama, peran, aktif, created_at) VALUES (?,?,?,1,?)').run(String(b.username).trim().toLowerCase(), b.nama || b.username, '["admin"]', now()).lastInsertRowid);
    setPassword(id, b.password); startSession(res, id);
    currentUser = publicUser(db.prepare('SELECT * FROM _users WHERE id=?').get(id)); log('buat admin', '_users', id, { username: b.username });
    return send(res, 200, { ok: true });
  }
  if (parts[1] === 'login' && m === 'POST') {
    const b = await readBody(req);
    const un = String(b.username || '').trim().toLowerCase();
    const f = failed.get(un) || { n: 0, t: 0 };
    if (f.n >= 5 && Date.now() - f.t < 5 * 60e3) return send(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 5 menit lagi.' });
    const u = db.prepare('SELECT * FROM _users WHERE username=? AND aktif=1').get(un);
    if (!u || !u.hash || !crypto.timingSafeEqual(Buffer.from(hashPw(b.password || '', u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) {
      failed.set(un, { n: f.n + 1, t: Date.now() });
      return send(res, 401, { error: 'Username atau password salah' });
    }
    failed.delete(un); startSession(res, u.id);
    return send(res, 200, { user: publicUser(u) });
  }
  if (parts[1] === 'logout' && m === 'POST') {
    const tok = cookies(req).kebun_sid; if (tok) db.prepare('DELETE FROM _sessions WHERE token=?').run(tok);
    res.setHeader('Set-Cookie', 'kebun_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  // membaca data & tampilan terbuka untuk semua; menambah/mengubah/menghapus wajib login
  // export tabel yang sedang dilihat ke Excel (data memang terbuka untuk dilihat)
  if (parts[1] === 'export' && m === 'POST') {
    const b = await readBody(req);
    const buf = await simpleWorkbook((b.sheets || []).slice(0, 40));
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Length': buf.length });
    return res.end(buf);
  }
  const publicRead = m === 'GET' && ['tables', 't', 'settings', 'excel'].includes(parts[1]);
  if (!user && !publicRead) return send(res, 401, { error: 'Silakan login sebagai admin untuk menambah / mengubah data' });
  if (parts[1] === 'password' && m === 'POST') {
    const b = await readBody(req);
    const u = db.prepare('SELECT * FROM _users WHERE id=?').get(user.id);
    if (hashPw(b.lama || '', u.salt) !== u.hash) return send(res, 400, { error: 'Password lama salah' });
    if (String(b.baru || '').length < 6) return send(res, 400, { error: 'Password baru minimal 6 karakter' });
    setPassword(user.id, b.baru); log('ganti password', '_users', user.id, null);
    return send(res, 200, { ok: true });
  }

  // --- kelola pengguna (admin)
  if (parts[1] === 'users') {
    if (!isAdmin(user)) return send(res, 403, { error: 'Khusus admin' });
    const id = parts[2] ? Number(parts[2]) : null;
    if (m === 'GET') return send(res, 200, db.prepare('SELECT * FROM _users ORDER BY id').all().map(publicUser));
    if (m === 'POST') {
      const b = await readBody(req);
      if (!b.username || String(b.password || '').length < 6) return send(res, 400, { error: 'Username wajib & password minimal 6 karakter' });
      if (db.prepare('SELECT 1 FROM _users WHERE username=?').get(String(b.username).trim().toLowerCase())) return send(res, 400, { error: 'Username sudah dipakai' });
      const nid = Number(db.prepare('INSERT INTO _users (username, nama, peran, aktif, created_at) VALUES (?,?,?,1,?)').run(String(b.username).trim().toLowerCase(), b.nama || b.username, cleanPeran(b.peran), now()).lastInsertRowid);
      setPassword(nid, b.password); log('tambah pengguna', '_users', nid, { username: b.username, peran: b.peran });
      return send(res, 200, { id: nid });
    }
    if (m === 'PUT' && id) {
      const b = await readBody(req);
      const admins = db.prepare("SELECT id FROM _users WHERE aktif=1 AND peran LIKE '%\"admin\"%'").all().map((r) => r.id);
      const willLoseAdmin = admins.length === 1 && admins[0] === id && ((b.peran && !b.peran.includes('admin')) || b.aktif === 0);
      if (willLoseAdmin) return send(res, 400, { error: 'Harus ada minimal 1 admin aktif' });
      if (b.nama != null) db.prepare('UPDATE _users SET nama=? WHERE id=?').run(b.nama, id);
      if (b.peran) db.prepare('UPDATE _users SET peran=? WHERE id=?').run(cleanPeran(b.peran), id);
      if (b.aktif != null) { db.prepare('UPDATE _users SET aktif=? WHERE id=?').run(b.aktif ? 1 : 0, id); if (!b.aktif) db.prepare('DELETE FROM _sessions WHERE user_id=?').run(id); }
      if (b.password) { if (String(b.password).length < 6) return send(res, 400, { error: 'Password minimal 6 karakter' }); setPassword(id, b.password); db.prepare('DELETE FROM _sessions WHERE user_id=?').run(id); }
      log('ubah pengguna', '_users', id, { nama: b.nama, peran: b.peran, aktif: b.aktif, password: b.password ? '(diganti)' : undefined });
      return send(res, 200, { ok: true });
    }
  }

  // --- Excel input
  if (parts[1] === 'excel') {
    // Excel per halaman: ?tables=iklim,lahan_blok&kom=Pisang&panel=Iklim → hanya sheet tabel itu (lahan_* hanya baris komoditas itu)
    const panel = panelOf(url);
    if (panel && !panel.tables.length) return send(res, 400, { error: 'Tabel tidak dikenal untuk Excel' });
    if (m === 'GET' && parts[2] === 'download') {
      const buf = Buffer.from(await (await makeWorkbook(panel)).xlsx.writeBuffer());
      const fname = panel ? `Excel ${panel.label} ${now().slice(0, 10)}.xlsx` : path.basename(EXCEL_FILE);
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fname.replace(/[^w .-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fname)}` });
      return res.end(buf);
    }
    if (m === 'GET' && parts[2] === 'status') return send(res, 200, excelStatus());
    if (m === 'POST' && parts[2] === 'upload') {
      // upload satu halaman: cukup punya izin ubah tabel-tabel halaman itu; upload file lengkap: khusus admin
      const boleh = panel ? panel.tables.every((t) => canEdit(user, t)) : isAdmin(user);
      if (!boleh) return send(res, 403, { error: panel ? 'Akun Anda tidak punya izin mengubah data halaman ini' : 'Khusus admin' });
      const buf = await readRaw(req);
      const rep = await syncExcel(buf, { preview: url.searchParams.get('preview') === '1', oleh: user.nama || user.username, sumber: panel ? `upload ${panel.label}` : 'upload', panel });
      if (!rep.preview) scheduleExcelWrite(2000); // tulis ulang file Excel di folder agar sama dengan yang diupload
      return send(res, 200, rep);
    }
    if (m === 'POST' && parts[2] === 'tulis') {
      if (!isAdmin(user)) return send(res, 403, { error: 'Khusus admin' });
      return send(res, 200, { ok: await writeExcelFile() });
    }
  }
  if (parts[1] === 'tables' && m === 'GET') {
    const counts = {};
    for (const t of Object.keys(TABLES)) counts[t] = db.prepare(`SELECT COUNT(*) c, MAX(updated_at) u FROM ${q(t)}`).get();
    return send(res, 200, counts);
  }
  if (parts[1] === 't') {
    const table = parts[2];
    if (!TABLES[table]) return send(res, 404, { error: 'Tabel tidak dikenal' });
    const id = parts[3] ? Number(parts[3]) : null;
    if (m === 'GET') return send(res, 200, db.prepare(`SELECT * FROM ${q(table)} ORDER BY id`).all());
    if (!canEdit(user, table)) return send(res, 403, { error: `Anda tidak punya izin mengubah "${TABLES[table].title}"` });
    if (m === 'POST' && parts[3] === 'hapus') {
      const { ids, cascade } = await readBody(req);
      const olds = (ids || []).map((i) => db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(Number(i))).filter(Boolean);
      const refs = mergeRefs(olds.map((o) => childRefs(table, o)));
      if (refs.length && !cascade) return send(res, 409, { error: 'Ada data lain yang terhubung', refs });
      const r = tx(() => { let c = 0, d = 0; for (const o of olds) { d += cascade ? deleteChildren(table, o) : 0; c += Number(db.prepare(`DELETE FROM ${q(table)} WHERE id=?`).run(o.id).changes); } return { c, d }; });
      log('hapus massal', table, null, { jumlah: r.c, data_terkait_ikut_dihapus: r.d || undefined });
      return send(res, 200, { deleted: r.c, related: r.d });
    }
    if (m === 'POST') {
      const body = await readBody(req);
      if (Array.isArray(body)) {
        const ids = tx(() => body.map((r) => insertRow(table, r, false)));
        log('import', table, null, { jumlah: ids.length });
        return send(res, 200, { ids });
      }
      return send(res, 200, { id: insertRow(table, body) });
    }
    if (m === 'PUT' && id) {
      const r = clean(table, await readBody(req));
      const cols = Object.keys(r);
      const old = db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(id);
      let related = 0;
      tx(() => {
        if (cols.length) db.prepare(`UPDATE ${q(table)} SET updated_at=?${cols.map((c) => `, ${q(c)}=?`).join('')} WHERE id=?`).run(now(), ...cols.map((c) => r[c]), id);
        // nama induk berubah → ikut ganti di semua data yang merujuk (mis. nama blok di panen/progres)
        const nu = db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(id);
        if (old && nu && TABLES[table].display) {
          const a = displayOf(table, old), b = displayOf(table, nu);
          if (a && b && a !== b) related = cascadeRename(table, a, b);
        }
      });
      log('ubah', table, id, table === 'gis_layer' ? { layer: r.nama || old?.nama, diubah: Object.keys(r).map((k) => ({ geojson: 'isi peta / atribut / catatan', gaya: 'tampilan', tampil: 'tampil/sembunyi' }[k] || k)).join(', ') } : { ...r, ...(related ? { data_terkait_diperbarui: related } : {}) });
      return send(res, 200, { ...(db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(id) || {}), _related: related });
    }
    if (m === 'DELETE' && id) {
      const old = db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(id);
      const refs = old ? childRefs(table, old) : [];
      const cascade = url.searchParams.get('cascade') === '1';
      if (refs.length && !cascade) return send(res, 409, { error: 'Ada data lain yang terhubung', refs });
      const related = tx(() => { const d = cascade && old ? deleteChildren(table, old) : 0; db.prepare(`DELETE FROM ${q(table)} WHERE id=?`).run(id); return d; });
      if (old && table === 'gis_layer') delete old.geojson;
      log('hapus', table, id, { ...old, ...(related ? { data_terkait_ikut_dihapus: related } : {}) });
      return send(res, 200, { ok: true, related });
    }
  }
  if (parts[1] === 'log' && m === 'GET') {
    const lim = Math.min(2000, Number(url.searchParams.get('limit')) || 300);
    return send(res, 200, db.prepare('SELECT * FROM _log ORDER BY id DESC LIMIT ?').all(lim));
  }
  if (parts[1] === 'settings') {
    if (m === 'GET') return send(res, 200, Object.fromEntries(db.prepare('SELECT k, v FROM _settings').all().map((r) => [r.k, r.v])));
    if (m === 'PUT' && !isAdmin(user)) return send(res, 403, { error: 'Khusus admin' });
    if (m === 'PUT') {
      const body = await readBody(req);
      for (const [k, v] of Object.entries(body)) {
        db.prepare('INSERT INTO _settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v == null ? null : String(v));
        if (k.startsWith('note:')) log(v ? 'ubah' : 'hapus', 'Catatan', null, { halaman: k.slice(5), teks: v ? (() => { try { return JSON.parse(v).teks; } catch { return String(v); } })() : null });
      }
      return send(res, 200, { ok: true });
    }
  }
  if ((parts[1] === 'backup' || parts[1] === 'backups') && !isAdmin(user)) return send(res, 403, { error: 'Khusus admin' });
  if (parts[1] === 'backup') {
    if (m === 'POST') return VERCEL ? send(res, 400, { error: 'Versi online tidak menyimpan file backup — pakai "Download backup database".' }) : send(res, 200, { file: path.basename(backup('manual')) });
    if (m === 'GET') {
      // salinan database siap pakai (tidak dikompres), langsung dikirim lalu dihapus dari server
      const file = path.join(DATA_DIR, `kebun_download_${Date.now()}.db`);
      raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const buf = fs.readFileSync(file); fs.unlink(file, () => {});
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="kebun_${new Date().toISOString().slice(0, 10)}.db"`, 'Content-Length': buf.length });
      return res.end(buf);
    }
  }
  // pulihkan / pindahkan database: unggah file .db (boleh dikompres .gz) → seluruh isi diganti
  if (parts[1] === 'restore' && m === 'POST') {
    if (!isAdmin(user)) return send(res, 403, { error: 'Khusus admin' });
    let buf = await readRaw(req);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    if (buf.subarray(0, 15).toString() !== 'SQLite format 3') return send(res, 400, { error: 'File harus database .db (dari "Download backup database")' });
    const file = path.join(DATA_DIR, `kebun_restore_${Date.now()}.db`);
    fs.writeFileSync(file, buf);
    try {
      const sebelum = backup('sebelum-pulihkan');
      const counts = restoreFrom(file, db.prepare('SELECT * FROM _users WHERE id=?').get(user.id));
      res.setHeader('Set-Cookie', 'kebun_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      log('pulihkan database', null, null, { baris: counts, backup_sebelumnya: path.basename(sebelum || '') || undefined, oleh: user.nama || user.username });
      return send(res, 200, { ok: true, counts });
    } finally { fs.unlink(file, () => {}); }
  }
  if (parts[1] === 'backups' && m === 'GET') {
    return send(res, 200, backupFiles().reverse().map(({ f }) => ({ file: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size })));
  }
  send(res, 404, { error: 'Endpoint tidak ada' });
}

// ======================================================================= EXCEL INPUT
// File Excel di folder aplikasi = jalur input. Disimpan → otomatis dibaca & database disamakan dengan isinya.
// Data diubah lewat aplikasi → file Excel ditulis ulang (kalau sedang tidak dibuka di Excel).
const EXCEL_FILE = process.env.EXCEL_FILE || path.join(process.env.DATA_DIR ? DATA_DIR : ROOT, 'Input Data Kebun.xlsx');
const EXCEL_TABLES = new Set(EXCEL_SHEETS.map((s) => s.table));
const xl = { lastWriteMtime: 0, stale: false, staleSince: null, lastReport: null, timer: null, busy: false };
const sortRows = (table, rows) => {
  // di Excel: tabel bertanggal diurut lama → baru (input baru ditulis di bawah); lainnya ikut urutan tabel
  const T = TABLES[table];
  const s = T.date || T.sort || 'id', desc = !T.date && s.startsWith('-'), k = s.replace(/^-/, '');
  return [...rows].sort((a, b) => { const c = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'id', { numeric: true }); return (desc ? -c : c) || a.id - b.id; });
};
const rowsOf = (t) => sortRows(t, db.prepare(`SELECT * FROM ${q(t)}`).all());
const getSetting = (k) => db.prepare('SELECT v FROM _settings WHERE k=?').get(k)?.v;
// ---- Excel per halaman
function panelOf(url) {
  const tl = url.searchParams.get('tables'); if (!tl) return null;
  const tables = tl.split(',').filter((t) => EXCEL_TABLES.has(t));
  const kom = ['Pisang', 'Padi'].includes(url.searchParams.get('kom')) ? url.searchParams.get('kom') : null;
  return { tables, kom, label: String(url.searchParams.get('panel') || tables.map((t) => TABLES[t].title).join(', ')).slice(0, 60) };
}
// tabel progres tanam dipakai bersama pisang & padi → di halaman satu komoditas hanya barisnya yang diambil/diganti
// (aturan sama dengan tampilan di halaman Progres Tanam)
function scopeOf(table, kom) {
  if (!kom) return null;
  if (table === 'lahan_blok') return (r) => (r.peruntukan || 'Pisang') === kom;
  if (table === 'lahan_aktivitas') return (r) => (r.untuk || 'Pisang') === kom || r.untuk === 'Semua';
  if (table === 'lahan_harian') {
    const kb = new Map(db.prepare('SELECT blok, peruntukan FROM lahan_blok').all().map((b) => [util.key(b.blok), b.peruntukan || 'Pisang']));
    const acts = new Set(db.prepare('SELECT untuk, aktivitas FROM lahan_aktivitas').all().filter((a) => (a.untuk || 'Pisang') === kom || a.untuk === 'Semua').map((a) => a.aktivitas));
    return (r) => { const k = kb.get(util.key(r.blok)); return k ? k === kom : acts.has(r.aktivitas); };
  }
  return null;
}
const makeWorkbook = (panel = null) => {
  const SHEETS = panel ? EXCEL_SHEETS.filter((s) => panel.tables.includes(s.table)) : EXCEL_SHEETS;
  const scoped = (t) => { const f = panel && scopeOf(t, panel.kom); const rows = rowsOf(t); return f ? rows.filter(f) : rows; };
  const refNames = (t) => (TABLES[t]?.display ? db.prepare(`SELECT * FROM ${q(t)}`).all().map((r) => displayOf(t, r)) : []);
  return buildWorkbook({ TABLES, SHEETS, rowsOf: scoped, nama: getSetting('nama') || 'PT VIGU FARM INDONESIA', panel: panel?.label, refNames });
};
const excelLocked = () => fs.existsSync(path.join(path.dirname(EXCEL_FILE), '~$' + path.basename(EXCEL_FILE)));
function excelStatus() {
  const laporan = xl.lastReport || JSON.parse(getSetting('excel_laporan') || 'null');
  if (VERCEL) return { online: true, ada: false, laporan }; // online: tidak ada file Excel di server — pakai download & upload
  let mtime = null; try { mtime = fs.statSync(EXCEL_FILE).mtime.toISOString(); } catch {}
  return { file: EXCEL_FILE, ada: !!mtime, diubah: mtime, sedangDibuka: excelLocked(), stale: xl.stale, staleSince: xl.staleSince, laporan };
}
async function writeExcelFile() {
  if (VERCEL) return false;
  if (excelLocked()) { if (!xl.stale) { xl.stale = true; xl.staleSince = now(); } return false; }
  const tmp = EXCEL_FILE + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(await (await makeWorkbook()).xlsx.writeBuffer()));
  try { fs.renameSync(tmp, EXCEL_FILE); } catch (e) { try { fs.unlinkSync(tmp); } catch {} if (!xl.stale) { xl.stale = true; xl.staleSince = now(); } return false; }
  xl.lastWriteMtime = fs.statSync(EXCEL_FILE).mtimeMs; xl.stale = false; xl.staleSince = null;
  return true;
}
function scheduleExcelWrite(ms = 4000) { if (VERCEL) return; clearTimeout(xl.timer); xl.timer = setTimeout(() => writeExcelFile().catch((e) => console.warn('Tulis Excel gagal:', e.message)), ms); }
// jika file sempat terkunci, coba tulis ulang setelah Excel ditutup
if (!VERCEL) setInterval(() => { if (xl.stale && !excelLocked()) writeExcelFile().catch(() => {}); }, 15000);

const sig = (table, cfg, r) => { const c = clean(table, r); return JSON.stringify(sheetFields(TABLES, cfg).map((f) => (c[f.k] == null ? null : c[f.k]))); };
// Nama induk di Excel (aktivitas, blok, dll.) dicocokkan dengan daftarnya tanpa peduli huruf besar/kecil, spasi & tanda baca:
//  • beda tulisan saja (mis. "land clearing", "LandClearing") → dibetulkan otomatis ke nama di daftar;
//  • aktivitas yang tidak ada di daftar → KESALAHAN (sheet ditahan) karena barisnya tidak akan terhitung di progres;
//  • nama lain yang tidak ada di daftar (mis. blok baru) → peringatan saja, data tetap masuk.
const kunciNama = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
function cekNamaInduk(parsed) {
  const cache = {};
  const daftar = (t) => (cache[t] ??= (() => {
    const m = new Map(), dariSheet = parsed.find((p) => p.cfg.table === t && p.found && !p.errors.length);
    for (const r of [...db.prepare(`SELECT * FROM ${q(t)}`).all(), ...(dariSheet ? dariSheet.rows : [])]) { const v = displayOf(t, r); if (v != null && v !== '') m.set(kunciNama(v), String(v)); }
    return m;
  })());
  for (const p of parsed) {
    if (!p.found) continue;
    const kor = new Map(), asing = new Map();
    for (const f of sheetFields(TABLES, p.cfg).filter((f) => f.t === 'ref')) {
      const m = daftar(f.ref);
      for (const r of p.rows) {
        const v = r[f.k]; if (v == null || v === '') continue;
        const hit = m.get(kunciNama(v));
        if (hit != null) { if (hit !== String(v)) { const kk = `${f.l} "${v}" → "${hit}"`; kor.set(kk, [...(kor.get(kk) || []), r.__baris]); r[f.k] = hit; } }
        else if (f.ref === 'lahan_aktivitas') p.errors.push({ row: r.__baris, msg: `${f.l} "${v}" tidak ada di daftar ${TABLES[f.ref].title} (cek ejaan) — kalau dibiarkan tidak akan terhitung di progres` });
        else { const kk = `${f.l} "${v}" tidak ada di ${TABLES[f.ref].title}`; asing.set(kk, [...(asing.get(kk) || []), r.__baris]); }
      }
    }
    const fmt = (m) => [...m].map(([k, b]) => `${k} (${b.length} baris: ${b.slice(0, 6).join(', ')}${b.length > 6 ? ', …' : ''})`).slice(0, 20);
    p.koreksi = fmt(kor); p.peringatan = fmt(asing);
  }
}
async function syncExcel(buf, { preview = false, oleh = 'Excel', sumber = 'file', panel = null } = {}) {
  const parsed = await parseWorkbook(buf, { TABLES, SHEETS: panel ? EXCEL_SHEETS.filter((s) => panel.tables.includes(s.table)) : EXCEL_SHEETS });
  const scopes = Object.fromEntries(parsed.map((p) => [p.cfg.table, panel ? scopeOf(p.cfg.table, panel.kom) : null])); // dihitung sebelum ada yang diganti
  cekNamaInduk(parsed);
  const rep = { waktu: now(), sumber, preview, oleh, panel: panel?.label || null, sheets: [], backup: null, peringatan: [] };
  if (xl.stale) rep.peringatan.push(`Ada perubahan dari aplikasi sejak ${new Date(xl.staleSince).toLocaleString('id-ID')} yang belum masuk ke Excel (file sedang dibuka). Isi Excel ini menimpa perubahan tersebut.`);
  const todo = [];
  for (const p of parsed) {
    const { cfg } = p; const all = db.prepare(`SELECT * FROM ${q(cfg.table)}`).all(); const cur = scopes[cfg.table] ? all.filter(scopes[cfg.table]) : all;
    const s = { sheet: cfg.sheet, tabel: TABLES[cfg.table].title, baris: p.rows.length, sebelum: cur.length, tambah: 0, hapus: 0, status: 'ok', koreksi: p.koreksi || [], peringatan: p.peringatan || [], errors: p.errors.slice(0, 30), jumlahError: p.errors.length, layoutBeda: !!p.layoutBeda };
    rep.sheets.push(s);
    if (!p.found) { s.status = 'sheet tidak ada — dilewati'; continue; }
    if (p.errors.length) { s.status = 'ada kesalahan — tidak diproses'; continue; }
    if (!p.rows.length && cur.length && !p.kosong) { s.status = 'sheet kosong — dilewati (tulis KOSONG di A2 untuk mengosongkan)'; continue; }
    // hitung beda (multiset)
    const count = new Map();
    for (const r of cur) { const k = sig(cfg.table, cfg, r); count.set(k, (count.get(k) || 0) + 1); }
    for (const r of p.rows) { const k = sig(cfg.table, cfg, r); if (count.get(k)) count.set(k, count.get(k) - 1); else s.tambah++; }
    s.hapus = [...count.values()].reduce((a, b) => a + b, 0);
    if (!s.tambah && !s.hapus) { s.status = 'tidak berubah'; continue; }
    s.status = preview ? 'akan diperbarui' : 'diperbarui';
    todo.push({ p, s });
  }
  if (preview || !todo.length) { if (!preview) { xl.lastReport = rep; } return rep; }
  rep.backup = path.basename(backup('excel') || '') || null;
  const prevUser = currentUser; currentUser = { nama: oleh };
  try {
    tx(() => {
      for (const { p } of todo) {
        // kolom yang tidak ada di Excel (mis. kolom lama) tetap dipertahankan hanya untuk baris yang identik — sisanya diganti
        const sc = scopes[p.cfg.table];
        if (sc) { const del = db.prepare(`DELETE FROM ${q(p.cfg.table)} WHERE id=?`); for (const r of db.prepare(`SELECT * FROM ${q(p.cfg.table)}`).all().filter(sc)) del.run(r.id); } // hanya baris komoditas ini
        else db.prepare(`DELETE FROM ${q(p.cfg.table)}`).run();
        for (const r of p.rows) insertRow(p.cfg.table, r, false);
      }
    });
    for (const { p, s } of todo) log('sinkron Excel', p.cfg.table, null, { sheet: s.sheet, baris: s.baris, tambah_atau_ubah: s.tambah, hapus_atau_ubah: s.hapus, sumber });
  } finally { currentUser = prevUser; }
  xl.lastReport = rep;
  db.prepare('INSERT INTO _settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('excel_laporan', JSON.stringify(rep));
  return rep;
}
// pantau file Excel: setiap disimpan → sinkron otomatis
async function onExcelChanged() {
  if (xl.busy) return; xl.busy = true;
  try {
    let st; try { st = fs.statSync(EXCEL_FILE); } catch { return; }
    if (Math.abs(st.mtimeMs - xl.lastWriteMtime) < 5) return; // file baru saja ditulis oleh aplikasi
    let buf = null;
    for (let i = 0; i < 5 && !buf; i++) { try { buf = fs.readFileSync(EXCEL_FILE); } catch { await new Promise((r) => setTimeout(r, 1500)); } }
    if (!buf) return;
    const rep = await serial(async () => { await syncCloud(); const r = await syncExcel(buf, { oleh: 'Excel (otomatis)', sumber: 'file' }); await flush(); return r; });
    const ub = rep.sheets.filter((s) => s.status === 'diperbarui'), er = rep.sheets.filter((s) => s.jumlahError);
    console.log(`  Excel disinkron: ${ub.length} sheet diperbarui${er.length ? `, ${er.length} sheet ada kesalahan` : ''}`);
    xl.lastWriteMtime = st.mtimeMs;
    // format kolom di file sudah lama (ada kolom yang dihapus/ditambah) → tulis ulang file dengan format terbaru
    if (rep.sheets.some((s) => s.layoutBeda) && !rep.sheets.some((s) => s.jumlahError)) scheduleExcelWrite(1500);
  } catch (e) { console.warn('Sinkron Excel gagal:', e.message); xl.lastReport = { waktu: now(), gagal: e.message, sheets: [] }; }
  finally { xl.busy = false; }
}
let watchTimer = null;
if (!VERCEL) fs.watchFile(EXCEL_FILE, { interval: 2000 }, (cur, prev) => {
  if (!cur.mtimeMs || cur.mtimeMs === prev.mtimeMs) return;
  clearTimeout(watchTimer); watchTimer = setTimeout(onExcelChanged, 2500);
});
// komputer lokal yang memakai database online: cek perubahan dari online tiap menit → file Excel ikut diperbarui
if (cloud && !VERCEL) setInterval(() => serial(async () => { if (await syncCloud()) scheduleExcelWrite(1000); }).catch((e) => console.warn('Cek database online gagal:', e.message)), 60e3).unref();
if (VERCEL) { /* online: tanpa file Excel */ }
else if (!fs.existsSync(EXCEL_FILE)) writeExcelFile().then((ok) => ok && console.log('  File Excel input dibuat:', EXCEL_FILE)).catch((e) => console.warn('Buat Excel gagal:', e.message));
else {
  // saat start: mana yang lebih baru — data di aplikasi atau file Excel?
  const fileTime = fs.statSync(EXCEL_FILE).mtime.toISOString();
  const dbTime = [...EXCEL_TABLES].map((t) => db.prepare(`SELECT MAX(updated_at) u FROM ${q(t)}`).get().u || '').sort().pop() || '';
  const last = JSON.parse(getSetting('excel_laporan') || 'null')?.waktu || '';
  if (dbTime > fileTime && dbTime > last) writeExcelFile().catch(() => {});            // aplikasi lebih baru → perbarui file (atau tunggu sampai file ditutup)
  else if (fileTime > last) setTimeout(onExcelChanged, 1500);                          // file diubah saat server mati → baca file
}

// mode online: respons ditahan sampai perubahan benar-benar tersimpan di database online
function holdResponse(res) {
  const wh = res.writeHead, end = res.end; let a = null, b = null;
  res.writeHead = (...x) => { a = x; return res; };
  res.end = (...x) => { b = x; return res; };
  const restore = () => { res.writeHead = wh; res.end = end; };
  return { release() { restore(); if (a) res.writeHead(...a); if (b) res.end(...b); }, discard() { restore(); res.removeHeader('Set-Cookie'); } };
}
async function apiRequest(req, res, url) {
  if (!cloud) return api(req, res, url);
  return serial(async () => {
    if (await syncCloud() && !VERCEL) scheduleExcelWrite(1000);
    const hold = holdResponse(res);
    try { await api(req, res, url); await flush(); hold.release(); }
    catch (e) {
      hold.discard(); txMark = -1;
      if (pend.length) { pend.length = 0; await loadCloud(); } // perubahan setengah jalan dibatalkan → samakan lagi dengan isi online
      if (!e.conflict) throw e;
      send(res, 409, { error: 'Data baru saja diubah dari tempat lain. Muat ulang halaman lalu ulangi.' });
    }
  });
}

// Vercel menjalankan server.js sebagai satu fungsi (export default di bawah); isi public/ dilayani CDN Vercel.
// Halaman utama dibaca dengan alamat tetap supaya ikut terbawa dalam paket fungsi.
const INDEX_HTML = VERCEL ? fs.readFileSync(new URL('./public/index.html', import.meta.url)) : null;
const KEBUN_HTML = VERCEL ? fs.readFileSync(new URL('./public/kebun.html', import.meta.url)) : null; // halaman Tim Kebun (/kebun)

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    if (VERCEL && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, INDEX_HTML, MIME['.html'], { 'Cache-Control': 'no-cache' });
    if (url.pathname === '/kebun' || url.pathname === '/kebun/') return VERCEL ? send(res, 200, KEBUN_HTML, MIME['.html'], { 'Cache-Control': 'no-cache' }) : serveFile(res, path.join(ROOT, 'public', 'kebun.html'));
    if (BELUM_ONLINE && url.pathname.startsWith('/api/')) return send(res, 503, { error: 'Database online belum disambungkan. Di Vercel: buka proyek → Storage → Create Database → Turso → Connect ke proyek ini, lalu Deployments → Redeploy.' });
    if (url.pathname.startsWith('/api/')) {
      await apiRequest(req, res, url);
      // perubahan lewat aplikasi → samakan file Excel
      const t = url.pathname.split('/')[3];
      if (req.method !== 'GET' && url.pathname.startsWith('/api/t/') && res.statusCode < 300 && EXCEL_TABLES.has(t)) scheduleExcelWrite();
      return;
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const f = safeJoin(path.join(ROOT, 'public'), rel);
    return f ? serveFile(res, f) : send(res, 403, 'Forbidden', 'text/plain');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
}

if (!VERCEL) http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log('\n  Monitoring Kebun berjalan:');
  console.log(`   Komputer ini : http://localhost:${PORT}`);
  for (const ifs of Object.values(os.networkInterfaces())) for (const i of ifs || [])
    if (i.family === 'IPv4' && !i.internal) console.log(`   Jaringan/HP  : http://${i.address}:${PORT}`);
  console.log(`   Database     : ${cloud ? 'ONLINE (Turso) — data sama dengan versi internet' : DB_FILE}\n   Excel input  : ${EXCEL_FILE}\n   Tutup jendela ini untuk menghentikan server.\n`);
});
