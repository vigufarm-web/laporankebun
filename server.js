import {withGeneralDailyLocations} from './public/js/daily-locations.js';
import {hiddenActivity,visibleActivityRows} from './public/js/activity-visibility.js';
import {saveWeeklyItems} from './lib/weekly-plan-store.js';
import {prepareExcelInput,referenceSheets,capExcelLandChanges} from './lib/excel-input-policy.js';
import {padiSummary} from './lib/padi-summary.js';
import {inputRows,inputSummary} from './lib/input-summary.js';
import {isRepeatedArea,isDryingWork,isNurseryPopulation,unresolvedCoverage,cappedCoverage} from './lib/coverage-area.js';
import {activityKey,parseGroups} from './public/js/daily-work.js';
import {checkWeeklyWorkflow,checkActualWorkflow,reallocateEffectiveHK} from './lib/daily-workflow.js';
import {isPublicDailyRead} from './lib/daily-public-path.js';
import {dailyHKSummary} from './lib/daily-hk.js';
import {ownerLandClearing} from './lib/owner-lc.js';
import {reportWeek} from './lib/report-week.js';
import {githubStore,githubDataConfig} from './lib/github-store.js';
import {kebunPlan} from './lib/kebun-plan.js';
import {summaryPeriods} from './lib/summary-periods.js';
import {cloudOverview,cloudOverviewPeriods} from './lib/cloud-overview.js';
import {weeklyLand} from './lib/weekly-targets.js';
import { importLand, capLandRows, landAreas, landStages, saveDailyLand, stageForDaily, registerHistoricalDailyCoverage } from './lib/land-actual.js';
import { kebunSummary } from './lib/kebun-summary.js';
import { removeDuplicateParcelLayer } from './lib/gis-deduplicate.js';
import { createParcelLocations } from './lib/gis-ownership.js';
import { importPadi } from './lib/padi-import.js';
import { loadPhotoContext } from './lib/photo-context.js';
import { transferDaily } from './lib/daily-transfer.js';
import { execChanged } from './lib/tracked-sql.js';
import { copyCloudSnapshot, mergeSnapshotTables } from './lib/cloud-snapshot.js';
import { photoExpiresAt, photoExpired } from './lib/photo-retention.js';
import { createReadModels } from './lib/read-models.js';
import { createBlockRegistry, isBlockLayer } from './lib/blocks.js';
import {createGISRegistry} from './lib/gis-registry.js';
// Server lokal Monitoring Kebun â€” Node.js (tanpa dependensi server) + SQLite bawaan Node.
// Jalankan: node server.js   lalu buka http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { put as blobPut, get as blobGet, del as blobDel } from '@vercel/blob';

async function createApplication() {
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERCEL = !!process.env.VERCEL; // berjalan online di Vercel: tidak ada folder tetap, hanya /tmp
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : VERCEL ? path.join(os.tmpdir(), 'kebun') : path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const DB_FILE = path.join(DATA_DIR, 'kebun.db');
const PHOTO_DIR = path.join(DATA_DIR, 'daily-photos');
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const { TABLES, SEED, SEED_SEKALI, KECEPATAN_AWAL, liburDefault, alatDefault, ruteDefault, susunRencana, ROLES, canEdit, isAdmin, displayOf, EXCEL_SHEETS, util, nominalJual, isJual, iklimHarian, statusRencana, targetPeriode } = await import('./public/js/schema.js');
const { buildWorkbook, parseWorkbook, sheetFields, simpleWorkbook } = await import('./lib/excel.js');
const { turso, onlineConfig } = await import('./lib/turso.js');

// ---------- database online (Turso) â€” dari variabel lingkungan (Vercel) atau file data/online.json {url, token}
const ONLINE = (() => {
  const env = onlineConfig(process.env);
  if (env) return env;
  try { const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'online.json'), 'utf8')); return j.url && j.token ? j : null; } catch { return null; }
})();
const GITHUB_DATA=githubDataConfig(process.env);
const BELUM_ONLINE = VERCEL && !ONLINE && !GITHUB_DATA;
const cloud = GITHUB_DATA ? githubStore(GITHUB_DATA) : ONLINE ? turso(ONLINE.url, ONLINE.token) : null;

// Mode online: data dibaca dari salinan di memori (cepat), setiap perubahan dikirim ke database online sebagai satu transaksi.
// Nomor versi (_ver) mencegah dua tempat menimpa perubahan satu sama lain.
let raw = null, ver = 0, txMark = -1, completeSnapshot = true, photoContextId = null, loadedTables = null;
const pend = [];
const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i;
const db = {
  prepare(sql) {
    const st = raw.prepare(sql);
    if (!cloud || !WRITE.test(sql)) return st;
    return { run: (...a) => { const r = st.run(...a); if(r.changes>0)pend.push({ sql, args: a }); return r; }, get: (...a) => st.get(...a), all: (...a) => st.all(...a) };
  },
  exec(sql) {
    const changed = cloud && WRITE.test(sql) ? execChanged(raw,sql) : (raw.exec(sql), false);
    if (!cloud) return;
    const s = sql.trim().toUpperCase();
    if (s === 'BEGIN') txMark = pend.length;
    else if (s === 'COMMIT') txMark = -1;
    else if (s === 'ROLLBACK') { if (txMark >= 0) pend.length = txMark; txMark = -1; }
    else if (changed) pend.push({ sql });
  },
};
const q = (s) => `"${s.replace(/"/g, '')}"`;
async function loadCloud(tables=null) {
  const snapshot=await copyCloudSnapshot(cloud,{chunkSize:32768,tables});
  const old=raw;raw=snapshot.db;ver=snapshot.version;completeSnapshot=!tables;loadedTables=tables?new Set(tables):null;photoContextId=null;old?.close();
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
// ada perubahan dari tempat lain (perangkat/instance lain)? â†’ muat ulang salinan
async function syncCloud(photoReportId = null,tables=null) {
  if (!cloud) return false;
  const [[r]] = await cloud.query(['SELECT MAX(v) v FROM _ver']);
  if (Number(r.v || 0) === ver && (completeSnapshot || (tables&&tables.every(t=>loadedTables?.has(t))) || (photoReportId && photoContextId===photoReportId))) return false;
  if(photoReportId){
    try{ver=await loadPhotoContext(cloud,raw,photoReportId);completeSnapshot=false;loadedTables=null;photoContextId=photoReportId;return true;}
    catch(error){console.warn('Konteks foto dimuat ulang melalui snapshot lengkap:',error.message);}
  }
  if(tables&&loadedTables&&Number(r.v||0)===ver){
    const missing=tables.filter(t=>!loadedTables.has(t));
    if(missing.length){const snapshot=await copyCloudSnapshot(cloud,{chunkSize:32768,tables:missing});try{if(snapshot.version===ver){mergeSnapshotTables(raw,snapshot.db,missing);missing.forEach(t=>loadedTables.add(t));return true;}}finally{snapshot.db.close();}}
  }
  await loadCloud(tables); return true;
}
// satu permintaan pada satu waktu dalam mode online (urutan perubahan & nomor versi tetap rapi)
let lock = Promise.resolve();
const serial = (fn) => { const p = lock.then(fn, fn); lock = p.catch(() => {}); return p; };

const authTables=['_ver','_users','_sessions','_settings'];
if (cloud) { await cloud.batch(['CREATE TABLE IF NOT EXISTS _ver (v INTEGER PRIMARY KEY)']); await loadCloud(VERCEL?authTables:null); }
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

const existingCloud=cloud&&!!raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_report'").get();
// ---------- migrasi otomatis: buat tabel & tambah kolom baru sesuai schema.js
const colType = (f) => (f.t === 'int' ? 'INTEGER' : f.t === 'num' || f.t === 'money' ? 'REAL' : 'TEXT');
function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _import_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT,row_id INTEGER,before_json TEXT,created_at TEXT)');
  const ada = (n) => !!raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
  if (!ada('_log')) db.exec(`CREATE TABLE IF NOT EXISTS _log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, aksi TEXT, tabel TEXT, row_id INTEGER, data TEXT)`);
  if (!ada('_settings')) db.exec(`CREATE TABLE IF NOT EXISTS _settings (k TEXT PRIMARY KEY, v TEXT)`);
  if (!ada('_users')) db.exec(`CREATE TABLE IF NOT EXISTS _users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nama TEXT, peran TEXT, salt TEXT, hash TEXT, aktif INTEGER DEFAULT 1, created_at TEXT, last_login TEXT)`);
  if (!ada('_sessions')) db.exec(`CREATE TABLE IF NOT EXISTS _sessions (token TEXT PRIMARY KEY, user_id INTEGER, expires TEXT)`);
  if (!db.prepare('PRAGMA table_info(_log)').all().some((c) => c.name === 'oleh')) db.exec('ALTER TABLE _log ADD COLUMN oleh TEXT');
  for (const [name, t] of Object.entries(TABLES)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${q(name)})`).all().map((c) => c.name));
    if (!have.size) db.exec(`CREATE TABLE IF NOT EXISTS ${q(name)} (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, updated_at TEXT)`);
    const baru = have.size === 0; // tabel baru dibuat â€” tidak perlu daftar kolom
    for (const f of t.f) {
      if (f.t !== 'calc' && !have.has(f.k)) {
        db.exec(`ALTER TABLE ${q(name)} ADD COLUMN ${q(f.k)} ${colType(f)}`);
        if (!baru) console.log(`  + kolom baru ${name}.${f.k}`);
      }
    }
  }
  for(const [table,T] of Object.entries(TABLES)) for(const f of T.f.filter(f=>f.t==='ref'||f.k===T.date)) db.exec('CREATE INDEX IF NOT EXISTS '+q('idx_'+table+'_'+f.k)+' ON '+q(table)+'('+q(f.k)+')');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS daily_report_hari_divisi ON daily_report(tanggal, divisi)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS daily_week_plan_minggu_divisi ON daily_week_plan(week_start, divisi)');
  if(!db.prepare('PRAGMA table_info(daily_week_item)').all().some(c=>c.name==='retired'))db.exec('ALTER TABLE daily_week_item ADD COLUMN retired INTEGER DEFAULT 0');
  db.exec('CREATE TABLE IF NOT EXISTS _weekly_revisions(id INTEGER PRIMARY KEY,plan_id INTEGER,created_at TEXT,actor TEXT,before_json TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS _daily_submissions(request_key TEXT PRIMARY KEY,user_id INTEGER,payload_hash TEXT,response_json TEXT,created_at TEXT)');
  db.exec('CREATE INDEX IF NOT EXISTS daily_week_item_plan ON daily_week_item(plan_id)');
  db.exec('CREATE INDEX IF NOT EXISTS daily_item_report ON daily_item(report_id)');
  db.exec('CREATE INDEX IF NOT EXISTS daily_photo_expire ON daily_photo(expires_at, deleted_at)');
}
migrate();

// ---------- backup otomatis (simpan 10 terakhir; saat start hanya bila ada perubahan sejak backup terakhir)
// backup disimpan terkompres (.db.gz, Â±5Ã— lebih kecil). Memulihkan: ekstrak dengan 7-Zip/WinRAR â†’ ganti data/kebun.db
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
  // backup lama yang belum dikompres â†’ dikompres (isi sama persis, ukuran Â±5Ã— lebih kecil)
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

// ---------- Daily Report: akses mandor per divisi + foto sementara 14 hari
const DAILY_ROLE = { Pisang: 'daily_pisang', Padi: 'daily_padi', Infra: 'daily_infra' };
const DAILY_DIVISI = Object.keys(DAILY_ROLE);
const canDaily = (user, divisi) => !!user && (isAdmin(user) || (user.peran || []).includes(DAILY_ROLE[divisi]));
// Laporan pertanggungjawaban lengkap: admin, atau akun yang dicentang admin dengan peran "Unduh Laporan Lengkap" (hanya unduh).
const canDownloadFullReport = (user) => !!user && (isAdmin(user) || (user.peran || []).includes('unduh_laporan'));
const dailyOnly = (user) => !!user && !isAdmin(user) && !(user.peran || []).includes('management') && (user.peran || []).some((r) => r.startsWith('daily_'));
const dailyDivisions = (user) => DAILY_DIVISI.filter((d) => canDaily(user, d));
const textLimit = (v, n = 500) => String(v ?? '').trim().slice(0, n) || null;
const numberOrNull = (v) => v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);

function weekBounds(value) {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - dow + 1);
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { start, end: d.toISOString().slice(0, 10) };
}

function weeklyPlanPayload(plan) {
  if (!plan) return null;
  return { ...plan, items: db.prepare('SELECT * FROM daily_week_item WHERE plan_id=? AND COALESCE(retired,0)=0 ORDER BY urutan, id').all(plan.id) };
}

let parcelLocations;
function ownedDailyLocations() {
  parcelLocations ||= createParcelLocations(db,blocks,{includeGIS:true});
  return parcelLocations();
}
let planningParcelLocations;
function ownedPlanningLocations(){planningParcelLocations ||= createParcelLocations(db,blocks,{includePartial:true});return planningParcelLocations();}
let planningMapLocations;
function ownedPlanningMap(){planningMapLocations ||= createParcelLocations(db,blocks,{includePartial:true,includeGeometry:true});return {type:'FeatureCollection',features:planningMapLocations().filter(b=>b.divisi==='Pisang'&&b.geometry).map(b=>({type:'Feature',geometry:b.geometry,properties:{id:b.id,name:b.nama}}))};}

let dailyTargetCache=new Map();
function dailyLandTargets(date){
  const bounds=weekBounds(date),key=bounds.start;
  if(dailyTargetCache.has(key))return dailyTargetCache.get(key);
  const tables=['lahan_blok','lahan_harian','lahan_aktivitas','lahan_target','lahan_rencana','pisang_blok'],data=Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM '+q(t)).all()])),ctx={rows:t=>data[t]||[]};
  const result=weeklyLand(db,ctx,date).targets;
  dailyTargetCache.set(key,result);return result;
}

function verifiedOverviewBlocks(){
  const owned=new Map(ownedPlanningLocations().map(x=>[x.id,x])),layer=db.prepare("SELECT id FROM gis_layer WHERE nama='Blok Tanam' ORDER BY id LIMIT 1").get()?.id;
  return blocks.list().map(b=>owned.has(b.id)?{...b,luas_ha:owned.get(b.id).luas_ha,ownership:'Sudah milik kebun',layer_id:b.layer_id||layer}:b);
}
function dailyPayload(report) {
  const weekStart = weekBounds(report.tanggal).start;
  const plan = db.prepare('SELECT * FROM daily_week_plan WHERE week_start=? AND divisi=?').get(weekStart, report.divisi);
  const plannedById = plan ? db.prepare('SELECT * FROM daily_week_item WHERE plan_id=?').all(plan.id) : [];
  let coverageLocations;
  const cumulative = db.prepare(`SELECT SUM(COALESCE(di.realisasi_input,di.realisasi)) total, MAX(CASE WHEN dr.status='Selesai' THEN COALESCE(di.realisasi_input,di.realisasi) END) coverage_total, MAX(NULLIF(di.target,0)) weekly_target
    FROM daily_item di JOIN daily_report dr ON dr.id=di.report_id
    WHERE dr.divisi=? AND dr.tanggal BETWEEN ? AND ?
      AND lower(replace(di.aktivitas,' ',''))=lower(replace(?,' ',''))
      AND lower(replace(COALESCE(di.blok,''),' ',''))=lower(replace(COALESCE(?,''),' ',''))
      AND lower(trim(COALESCE(di.satuan,'')))=lower(trim(COALESCE(?,'')))`);
  const plannedHK=db.prepare(`SELECT SUM(di.hk_rencana) total FROM daily_item di JOIN daily_report dr ON dr.id=di.report_id
    WHERE dr.divisi=? AND dr.tanggal BETWEEN ? AND ? AND lower(replace(di.aktivitas,' ',''))=lower(replace(?,' ',''))
    AND lower(replace(COALESCE(di.blok,''),' ',''))=lower(replace(COALESCE(?,''),' ','')) AND lower(trim(COALESCE(di.satuan,'')))=lower(trim(COALESCE(?,'')))`);
  const items = db.prepare('SELECT * FROM daily_item WHERE report_id=? ORDER BY urutan, id').all(report.id)
    .map((item) => {
      const sum = cumulative.get(report.divisi, weekStart, report.tanggal, item.aktivitas, item.blok, item.satuan);
      const planned = plannedById.find((p) => Number(item.plan_item_id) === Number(p.id)) || plannedById.find((p) =>
        util.key(p.aktivitas) === util.key(item.aktivitas) && util.key(p.blok) === util.key(item.blok) && util.key(p.satuan) === util.key(item.satuan));
      const normBlock=v=>String(v||'').toLowerCase().replace(/([a-z])0+(?=[1-9])/g,'$1').replace(/\s/g,'');
      const names=String(item.blok||'').split(',').map(normBlock);
      const landTarget=item.satuan==='ha'&&stageForDaily(item.aktivitas)?dailyLandTargets(report.tanggal).find(x=>x.a===stageForDaily(item.aktivitas))?.bl.filter(x=>names.includes(normBlock(x.blok))).reduce((s,x)=>s+x.ha,0):null;
      const targetHK=planned?.hk_rencana ?? plannedHK.get(report.divisi,weekStart,weekBounds(report.tanggal).end,item.aktivitas,item.blok,item.satuan)?.total ?? null;
      let target=planned?.target ?? (item.plan_item_id!=null?item.target:null) ?? (landTarget>0?landTarget:null);
      const outside = item.di_luar_rencana != null ? Number(item.di_luar_rencana) : plan ? Number(!planned) : 0;
      const coverage=isRepeatedArea(report.divisi,item.aktivitas,item.satuan),population=isNurseryPopulation(report.divisi,item.aktivitas,item.satuan),drying=isDryingWork(report.divisi,item.aktivitas);
      let coverageSDHI=null;
      if(coverage||population){coverageLocations ||= ownedDailyLocations();const location=coverageLocations.find(l=>item.block_id?Number(l.id)===Number(item.block_id):util.key(l.nama)===util.key(item.blok));const times=Number(parseGroups(plan?.hk_kegiatan).find(g=>g.key===activityKey(item.aktivitas,item.satuan))?.times)||1;target=cappedCoverage(target==null?null:target/times,population?null:location?.luas_ha);coverageSDHI=coverage&&unresolvedCoverage(item)?null:cappedCoverage(sum.coverage_total??item.realisasi,population?null:location?.luas_ha);}
      return { ...item, realisasi_efektif:item.realisasi, realisasi:item.realisasi_input??item.realisasi, satuan:population?'pokok':item.satuan, plan_item_id: item.plan_item_id ?? planned?.id ?? null, di_luar_rencana: outside, target, target_hk_minggu:targetHK, target_basis:planned?'Rencana mingguan':landTarget>0?'Rencana land preparation':null, hasil_sdhi: drying?null:(coverage||population)?coverageSDHI:sum.total ?? item.hasil_sdhi ?? null };
    });
  const photos = db.prepare('SELECT * FROM daily_photo WHERE report_id=? ORDER BY id').all(report.id)
    .map((p) => {const expired=photoExpired(p);return { ...p, deleted_at:p.deleted_at || (expired?p.expires_at:null), thumbnail_url: !expired&&!p.deleted_at&&p.thumb_lokasi ? `/api/daily/photo/${p.id}?thumb=1` : null, url: p.deleted_at||expired ? null : `/api/daily/photo/${p.id}` };});
  return { ...report, hk_kegiatan_rencana:plan?.hk_kegiatan||null, items, photos };
}

async function storeDailyPhoto(buf, mime, report) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
  const name = `${crypto.randomUUID()}.${ext}`;
  if (VERCEL) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Vercel Blob belum disambungkan (BLOB_READ_WRITE_TOKEN tidak ada)');
    const pathname = `daily-report/${report.tanggal}/${report.divisi.toLowerCase()}/${name}`;
    const blob = await blobPut(pathname, buf, { access: 'private', cacheControlMaxAge: 3600 });
    return { storage: 'blob', lokasi: blob.url };
  }
  const rel = path.join(report.tanggal.slice(0, 7), name);
  const file = path.join(PHOTO_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return { storage: 'local', lokasi: rel.replace(/\\/g, '/') };
}

async function attachReportPhotos(reports){
  const jobs=[];for(const report of reports){report.photoImages=[];for(const photo of report.photos.filter(p=>!p.deleted_at&&!photoExpired(p)&&p.lokasi)){const image={id:photo.id,caption:photo.caption||photo.jenis||'Foto kegiatan',buffer:null};report.photoImages.push(image);jobs.push({photo,image});}}
  if(!jobs.length)return;let index=0;const {reportPhoto}=await import('./lib/report-photo.js');const budget=Math.max(3500,Math.min(45000,Math.floor(2600000/jobs.length)));
  await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(index<jobs.length){const {photo,image}=jobs[index++];try{const location=photo.thumb_lokasi||photo.lokasi,storage=photo.thumb_lokasi?photo.thumb_storage:photo.storage;let buffer;if(storage==='blob'){const r=await blobGet(location,{access:'private'});if(!r||r.statusCode!==200)throw new Error('Foto tidak ditemukan');const chunks=[];for await(const c of Readable.fromWeb(r.stream))chunks.push(c);buffer=Buffer.concat(chunks);}else{const file=safeJoin(PHOTO_DIR,location);if(!file)throw new Error('Foto tidak valid');buffer=await fs.promises.readFile(file);}image.buffer=await reportPhoto(buffer,budget);}catch(e){image.error='Foto belum dapat dimuat';console.warn('Foto laporan '+photo.id+': '+e.message);}}}));
}

async function removeStoredPhoto(photo) {
  if(photo?.thumb_lokasi) await removeStoredPhoto({lokasi:photo.thumb_lokasi,storage:photo.thumb_storage});
  if (!photo?.lokasi) return;
  if (photo.storage === 'blob') await blobDel(photo.lokasi);
  else {
    const file = safeJoin(PHOTO_DIR, photo.lokasi);
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  }
}

async function cleanupDailyPhotos() {
  const expired = db.prepare("SELECT * FROM daily_photo WHERE (lokasi IS NOT NULL OR thumb_lokasi IS NOT NULL) AND expires_at IS NOT NULL AND expires_at<=? ORDER BY id LIMIT 200").all(now());
  let deleted = 0;
  for (const photo of expired) {
    try {
      await removeStoredPhoto(photo);
      db.prepare('UPDATE daily_photo SET deleted_at=?, lokasi=NULL, thumb_lokasi=NULL, updated_at=? WHERE id=?').run(now(), now(), photo.id);
      deleted++;
    } catch (e) { console.warn(`Foto Daily Report ${photo.id} belum dapat dihapus:`, e.message); }
  }
  return deleted;
}

// ---------- riwayat perubahan blok (lampiran GIS di Laporan Owner): satu catatan per blok â€” blok baru, dihapus, ganti nama,
// atau kolom penting berubah (nilai lama â†’ baru). Dipanggil dari form (tambah/ubah/hapus), upload Excel, dan upload peta Blok Tanam.
const BLOK_T = {
  pisang_blok: { k: 'nama_blok', f: ['luas_ha', 'pokok_tanam', 'tanggal_tanam', 'status', 'kehilangan', 'sulam'] },
  lahan_blok: { k: 'blok', f: ['luas_ha', 'peruntukan', 'tahap'] },
  padi_petak: { k: 'nama_petak', f: ['luas_ha', 'status'] },
  gis_layer: { k: 'nama', f: ['luas_ha', 'lahan', 'status'] }, // fitur peta Blok Tanam
};
const samaNilai = (a, b) => (a ?? '') === (b ?? '') || (a != null && b != null && a !== '' && b !== '' && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < 1e-6);
function catatBlok(tabel, lama, baru, extra = {}) {
  const cfg = BLOK_T[tabel]; if (!cfg) return 0;
  const k = (r) => util.key(r[cfg.k]), beda = (l, b) => Object.fromEntries(cfg.f.filter((f) => !samaNilai(l[f], b[f])).map((f) => [f, [l[f] ?? null, b[f] ?? null]]));
  const out = [];
  if (lama.length === 1 && baru.length === 1 && k(lama[0]) !== k(baru[0])) { // satu baris diedit & namanya diganti
    out.push({ jenis: 'ganti nama', blok: baru[0][cfg.k], lama: lama[0][cfg.k], ubah: beda(lama[0], baru[0]) });
  } else {
    const L = new Map(lama.filter((r) => r[cfg.k]).map((r) => [k(r), r])), B = new Map(baru.filter((r) => r[cfg.k]).map((r) => [k(r), r]));
    const tambah = [...B].filter(([x]) => !L.has(x)).map(([, r]) => r), hapus = [...L].filter(([x]) => !B.has(x)).map(([, r]) => r);
    for (const t of tambah) out.push({ jenis: 'tambah', blok: t[cfg.k], nilai: Object.fromEntries(cfg.f.filter((f) => t[f] != null && t[f] !== '').map((f) => [f, t[f]])) });
    for (const h of hapus) out.push({ jenis: 'hapus', blok: h[cfg.k], nilai: Object.fromEntries(cfg.f.filter((f) => h[f] != null && h[f] !== '').map((f) => [f, h[f]])) });
    for (const [x, b] of B) { const l = L.get(x); if (!l) continue; const d = beda(l, b); if (Object.keys(d).length) out.push({ jenis: 'ubah', blok: b[cfg.k], ubah: d }); }
  }
  for (const o of out) log('perubahan blok', tabel, null, { ...o, ...extra });
  return out.length;
}
// fitur peta Blok Tanam â†’ baris { nama, luas_ha, lahan, status } (luas: Area_New > Shape_Area, mÂ² â†’ ha)
function fiturBlok(geojson) {
  let F = []; try { F = JSON.parse(geojson || '{}').features || []; } catch {}
  return F.map((f) => { const p = f.properties || {}, m2 = Number(p.Area_New) > 0 ? Number(p.Area_New) : Number(p.Shape_Area) > 0 ? Number(p.Shape_Area) : null;
    return { nama: p.Nama_Blok || p.nama_blok || p.Blok || p.NAMA_BLOK || null, luas_ha: m2 != null ? Math.round(m2) / 1e4 : null, lahan: p.Lahan ?? null, status: p.Status ?? null }; });
}
const layerBlok = (r) => r && /blok\s*tanam/i.test(`${r.jenis || ''} ${r.nama || ''}`);

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
  row = blocks.canonical(table, row);
  const r = clean(table, TABLES[table].lengkapi ? TABLES[table].lengkapi(row) : row); // mis. Penjualan: isi otomatis Bentuk/Kelas/Kondisi â‡„ Jenis Barang
  if (row.block_id) { r.block_id = row.block_id; r.block_name_snapshot = row.block_name_snapshot; }
  if(row.block_refs_snapshot)r.block_refs_snapshot=row.block_refs_snapshot;
  const cols = Object.keys(r);
  const sql = `INSERT INTO ${q(table)} (created_at, updated_at${cols.map((c) => ', ' + q(c)).join('')}) VALUES (?, ?${cols.map(() => ', ?').join('')})`;
  const t = now();
  const res = db.prepare(sql).run(t, t, ...cols.map((c) => r[c]));
  const id = Number(res.lastInsertRowid);
  if (doLog) log('tambah', table, id, table === 'gis_layer' ? { nama: r.nama } : r);
  if (doLog && BLOK_T[table] && table !== 'gis_layer') catatBlok(table, [], [r]);
  return id;
}
// ---------- keterhubungan data (field bertipe ref menyimpan nama induk, mis. nama blok)
const refsTo = (table) => Object.entries(TABLES).flatMap(([t, T]) => T.f.filter((f) => f.t === 'ref' && f.ref === table).map((f) => ({ t, k: f.k })));
// ganti nama induk â†’ perbarui semua anak (berantai, mis. petak â†’ musim tanam â†’ panen)
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

const blocks = createBlockRegistry({db,TABLES,cascadeRename,log,clock:now,snapshotForBlock:id=>gisRegistry.snapshot(id),bootstrapGIS:!cloud});
blocks.migrate();
const gisRegistry=createGISRegistry({db,blocks,clock:now,actor:()=>currentUser?.nama||currentUser?.username||'Sistem'});
gisRegistry.migrate();
db.exec('CREATE TABLE IF NOT EXISTS _import_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT,row_id INTEGER,before_json TEXT,created_at TEXT)');
const reads = createReadModels({db,TABLES,nominalJual,isJual,iklimHarian});

function validateOperationalBlock(table,row,old=null) {
  const fields=table==='pisang_blok'?['tanggal_tanam','luas_ha','pokok_tanam','klon','status']:table==='padi_tanam'?['tgl_tanam','luas_tanam_ha','varietas']:[];
  if(old&&fields.some(k=>k in row&&String(row[k]??'')!==String(old[k]??''))&&gisRegistry.plantings().some(p=>p.source_key===table+':'+old.id)){const e=new Error('Data tanaman sudah dikelola di Peta Kebun. Ubah tanggal, luas tanam dan kelompok tanaman dari sana.');e.status=409;throw e;}
  const registry=blocks.list(),masterFields={lahan_blok:'blok',pisang_blok:'nama_blok',padi_petak:'nama_petak'};
  if(masterFields[table]){
    if(!old){const e=new Error('Blok baru dibuat melalui GIS; gunakan baris induk yang dihasilkan GIS.');e.status=409;throw e;}
    if(row.kepemilikan!=null&&old.block_id&&row.kepemilikan!==registry.find(b=>b.id===old.block_id)?.ownership){const e=new Error('Kepemilikan mengikuti GIS. Ubah melalui revisi GIS.');e.status=409;throw e;}
    return;
  }
  for(const f of TABLES[table]?.f||[]) {
    if(f.t!=='ref'||!masterFields[f.ref]||!row[f.k]||old&&row[f.k]===old[f.k])continue;
    const block=blocks.find(row[f.k]);if(!block||!block.active||!ownedDailyLocations().some(x=>x.id===block.id)){const e=new Error('Pilih blok GIS aktif yang tersedia pada peta.');e.status=400;throw e;}
  }
}

// data awal untuk tabel yang masih kosong
function seed() {
  // Data kebun yang disiapkan pemilik menjadi isi awal untuk instalasi baru.
  // Instalasi yang sudah berisi data tidak ditimpa.
  const inputFile = path.join(ROOT, 'seed', 'input-data-2026-10-23.json');
  if (fs.existsSync(inputFile)) {
    const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    for (const [name, rows] of Object.entries(input)) {
      if (!TABLES[name] || db.prepare(`SELECT COUNT(*) c FROM ${q(name)}`).get().c) continue;
      for (const r of rows) insertRow(name, r, false);
    }
  }
  for (const [name, rows] of Object.entries(SEED)) {
    if (db.prepare(`SELECT COUNT(*) c FROM ${q(name)}`).get().c === 0) for (const r of rows) insertRow(name, r, false);
  }
  const persilFile = path.join(ROOT, 'seed', 'persil-lahan-2026-10-21.geojson');
  if (fs.existsSync(persilFile) && !db.prepare("SELECT 1 FROM gis_layer WHERE nama='Persil Lahan 21-10-2026'").get()) {
    insertRow('gis_layer', { nama: 'Persil Lahan 21-10-2026', jenis: 'Persil Lahan', field_nama: 'No', warna: '#7c3aed', urutan: 5, tampil: 1, gaya: JSON.stringify({ label: 'No', mode: 'attr:Status', opacity: 0.55 }), geojson: fs.readFileSync(persilFile, 'utf8') }, false);
  }
  // Tambahkan kategori legenda ke layer Persil lama tanpa menyentuh GeoJSON atau data petanya.
  for (const layer of db.prepare("SELECT id, gaya FROM gis_layer WHERE jenis='Persil Lahan' OR nama LIKE 'Persil Lahan%'").all()) {
    let gaya = {}; try { gaya = JSON.parse(layer.gaya || '{}'); } catch {}
    if (!gaya.mode) { gaya.mode = 'attr:Status'; db.prepare('UPDATE gis_layer SET gaya=?, updated_at=? WHERE id=?').run(JSON.stringify(gaya), now(), layer.id); }
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
  // kecepatan kerja (hari/ha), jumlah tim & hari libur per kegiatan pisang â€” diisi sekali bila masih kosong (dipakai Rencana Kerja)
  if (!db.prepare('SELECT 1 FROM _settings WHERE k=?').get('isi:kecepatan')) {
    for (const a of db.prepare(`SELECT id, aktivitas, hari_per_ha, tim, libur FROM lahan_aktivitas WHERE untuk='Pisang'`).all()) {
      const v = { hari_per_ha: a.hari_per_ha ?? KECEPATAN_AWAL[a.aktivitas] ?? null, tim: a.tim ?? 1, libur: a.libur || liburDefault(a.aktivitas) };
      db.prepare('UPDATE lahan_aktivitas SET hari_per_ha=?, tim=?, libur=?, updated_at=? WHERE id=?').run(v.hari_per_ha, v.tim, v.libur, now(), a.id);
    }
    db.prepare('INSERT INTO _settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('isi:kecepatan', now());
  }
  const tandai = (k) => db.prepare('INSERT INTO _settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, now());
  const sudah = (k) => !!db.prepare('SELECT 1 FROM _settings WHERE k=?').get(k);
  // alat bersama (user): Bajak 1 & Bajak 2 = 1 traktor, Land Clearing = 1 alat â€” diisi sekali bila kosong
  if (!sudah('isi:alat')) {
    for (const a of db.prepare(`SELECT id, aktivitas, alat FROM lahan_aktivitas WHERE untuk='Pisang'`).all())
      if (!a.alat && alatDefault(a.aktivitas)) db.prepare('UPDATE lahan_aktivitas SET alat=?, updated_at=? WHERE id=?').run(alatDefault(a.aktivitas), now(), a.id);
    tandai('isi:alat');
  }
  // urutan blok (user): Land Clearing pindah ke blok terdekat di peta (rotasi alat) â€” diisi sekali bila kosong
  if (!sudah('isi:rute')) {
    for (const a of db.prepare(`SELECT id, aktivitas, rute FROM lahan_aktivitas WHERE untuk='Pisang'`).all())
      if (!a.rute && ruteDefault(a.aktivitas)) db.prepare('UPDATE lahan_aktivitas SET rute=?, updated_at=? WHERE id=?').run(ruteDefault(a.aktivitas), now(), a.id);
    tandai('isi:rute');
  }
  // prioritas blok (user): A01a paling akhir â€” terpisah Â±1 km di utara, kerjakan kelompok blok utama dulu
  if (!sudah('isi:prioritas_a01a')) {
    db.prepare(`UPDATE lahan_target SET prioritas=9, updated_at=? WHERE blok='A01a' AND prioritas IS NULL`).run(now());
    tandai('isi:prioritas_a01a');
  }
  // rencana awal (user): Stik Tanam & Tanam masing-masing 2 tim â€” diisi sekali
  if (!sudah('isi:tim2')) {
    db.prepare(`UPDATE lahan_aktivitas SET tim=2, updated_at=? WHERE untuk='Pisang' AND aktivitas IN ('Stik Tanam', 'Tanam')`).run(now());
    tandai('isi:tim2');
  }
  // Rencana Kerja dibuat otomatis SEKALI (permintaan user): dari progres saat ini, mulai hari ini (WIB).
  // v3 = alat bersama + Stik Tanam & Tanam 2 tim â†’ rencana otomatis versi sebelumnya diganti sekali;
  // rencana yang sudah disusun/diubah admin (ada di riwayat) tidak disentuh.
  // Susun ulang berikutnya lewat tombol "Susun rencana kerja" di halaman Progres Tanam (admin).
  if (!sudah('seed:lahan_rencana_v3')) {
    const kosong = db.prepare('SELECT COUNT(*) c FROM lahan_rencana').get().c === 0;
    const otomatisLama = !db.prepare("SELECT 1 FROM _log WHERE tabel='lahan_rencana' LIMIT 1").get();
    if (kosong || otomatisLama) {
      const c = { rows: (t) => db.prepare(`SELECT * FROM ${q(t)}`).all() };
      const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      const rows = susunRencana(c, hariIni);
      db.exec('DELETE FROM lahan_rencana');
      for (const r of rows) insertRow('lahan_rencana', r, false);
    }
    tandai('seed:lahan_rencana'); tandai('seed:lahan_rencana_v2'); tandai('seed:lahan_rencana_v3');
  }
  // Arsip awal dari grup WhatsApp DAILY REPORT. Idempoten: tidak menimpa laporan yang sudah ada/diubah.
  const waFile = path.join(ROOT, 'seed', 'daily-wa-2026-10.json');
  if (fs.existsSync(waFile)) {
    const reports = JSON.parse(fs.readFileSync(waFile, 'utf8'));
    const addItem = db.prepare('INSERT INTO daily_item (created_at, updated_at, report_id, urutan, aktivitas, blok, target, realisasi, satuan, hk_rencana, hk_realisasi, keterangan) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const r of reports) {
      if (db.prepare('SELECT 1 FROM daily_report WHERE tanggal=? AND divisi=?').get(r.tanggal, r.divisi)) continue;
      const t = now(), finished = r.status === 'Selesai';
      const id = Number(db.prepare('INSERT INTO daily_report (created_at, updated_at, tanggal, divisi, mandor, siklus, status, apel_hadir, apel_catatan, dikirim_at, rencana_at, selesai_at, dibuat_oleh) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(t, t, r.tanggal, r.divisi, null, `${r.divisi} Oktober 2026`, r.status, r.apel_hadir ?? null, null, finished ? t : null, t, finished ? t : null, null).lastInsertRowid);
      for (const [i, x] of (r.items || []).entries()) addItem.run(t, t, id, i + 1, x[0], x[1] || null, x[2], x[3], x[4], x[5], x[6], null);
    }
    db.prepare("UPDATE daily_report SET siklus=divisi || ' Oktober 2026', updated_at=? WHERE (siklus IS NULL OR siklus='') AND tanggal BETWEEN '2026-10-01' AND '2026-10-31'").run(now());
    db.prepare("UPDATE daily_report SET mandor=NULL, dibuat_oleh=NULL, apel_catatan=NULL, updated_at=? WHERE dibuat_oleh='Impor WhatsApp' OR apel_catatan='Impor arsip WhatsApp DAILY REPORT'").run(now());
    db.prepare("UPDATE daily_item SET keterangan=NULL, updated_at=? WHERE keterangan='Sumber: WhatsApp DAILY REPORT'").run(now());
  }
  // Target lama yang kosong memakai hasil kumulatif/harian sebagai target sementara.
  // Target mingguan berikutnya diisi mandor langsung pada setiap kegiatan.
  if (!sudah('isi:daily_target_realisasi_v1')) {
    // Target hanya berasal dari rencana yang diisi; hasil aktual bukan target.
    tandai('isi:daily_target_realisasi_v1');
  }
}
if(!existingCloud){seed();blocks.boot();completeSnapshot=true;loadedTables=null;}
const removedParcelDuplicate=completeSnapshot?removeDuplicateParcelLayer(db):null;
if(removedParcelDuplicate)log('hapus layer persil duplikat','gis_layer',removedParcelDuplicate.removed,removedParcelDuplicate);
// Existing photo files follow the same report-date retention as new uploads.
for(const photo of db.prepare('SELECT p.id,p.expires_at,r.tanggal FROM daily_photo p JOIN daily_report r ON r.id=p.report_id WHERE p.lokasi IS NOT NULL OR p.thumb_lokasi IS NOT NULL').all()) {
  const expiry=photoExpiresAt(photo.tanggal);
  if(photo.expires_at!==expiry)db.prepare('UPDATE daily_photo SET expires_at=? WHERE id=?').run(expiry,photo.id);
}
// mode online: tabel/kolom baru & data awal ikut dibuat di database online.
// Dua salinan aplikasi menyala bersamaan â†’ yang kalah memuat ulang isi online lalu cek lagi (tidak berhenti/crash).
for (let i = 0; ; i++) {
  try { await flush(); break; } catch (e) { if (!e.conflict || i >= 4) throw e; migrate(); blocks.migrate(); seed(); blocks.boot(); }
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
      migrate(); blocks.migrate(); seed(); blocks.boot();
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.map': 'application/json' };
// kirim respons; teks/JSON > 1 KB dikompres gzip (data jadi Â±5â€“10Ã— lebih kecil di jaringan)
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
const gzCache = new Map(); // file â†’ { etag, gz }
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

  if(parts[1]==='gis-reference'){
    const origin=req.headers.origin,allowed=origin==='https://vigufarm-web.github.io'||(!VERCEL&&/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin||''));
    if(!allowed)return send(res,403,{error:'Asal aplikasi tidak diizinkan.'});
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization, X-GIS-App','Vary':'Origin','Cache-Control':'no-store'};
    if(m==='OPTIONS')return send(res,200,{ok:true},'application/json',headers);
    const token=String(req.headers.authorization||'').replace(/^Bearer /,''),app=req.headers['x-gis-app'];
    if(m!=='GET'||!gisRegistry.verifyGrant(token,app))return send(res,401,{error:'Hubungkan kembali ke Peta Kebun. Izin referensi belum ada atau telah berakhir.'},'application/json',headers);
    return send(res,200,gisRegistry.catalog(now().slice(0,10),ownedPlanningLocations()),'application/json',headers);
  }
  const gisEditor=process.env.GIS_EDITOR_URL;
  if(parts[1]==='gis-service'&&m==='GET')return send(res,200,{url:gisEditor||'https://laporankebun.vercel.app'});
  if(gisEditor&&['gis','gis-registry'].includes(parts[1])&&m!=='GET')return send(res,409,{error:'Pengelolaan GIS sudah dipindahkan. Buka Peta Kebun untuk memperbarui data.',editor:gisEditor});
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
  // Vercel Cron memanggil ini sekali sehari. CRON_SECRET mencegah pemanggilan umum.
  if (parts[1] === 'daily' && parts[2] === 'cleanup' && m === 'GET') {
    const bearer = req.headers.authorization === `Bearer ${process.env.CRON_SECRET || ''}`;
    if ((!process.env.CRON_SECRET || !bearer) && !(user && isAdmin(user))) return send(res, 403, { error: 'Tidak diizinkan' });
    return send(res, 200, { ok: true, deleted: await cleanupDailyPhotos() });
  }
  // membaca data & tampilan terbuka untuk semua; menambah/mengubah/menghapus wajib login
  // export tabel yang sedang dilihat ke Excel (data memang terbuka untuk dilihat)
  if (parts[1] === 'export' && m === 'POST') {
    const b = await readBody(req);
    const buf = await simpleWorkbook((b.sheets || []).slice(0, 40));
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Length': buf.length });
    return res.end(buf);
  }
  const publicRead = m === 'GET' && (['settings','overview','kebun-summary','kebun-plan','summary-periods','padi-summary'].includes(parts[1])||isPublicDailyRead(url.pathname,m));
  if (!user && !publicRead) return send(res, 401, { error: 'Silakan login sebagai admin untuk menambah / mengubah data' });
  if(user&&!isAdmin(user)&&['t','tables','records','excel','blocks','gis','kebun'].includes(parts[1])&&!(parts[1]==='excel'&&editableExcelTables(user).length))return send(res,403,{error:'Rincian input hanya dapat dilihat admin. Ringkasan tetap tersedia.'});

  if(url.pathname==='/api/kebun-plan/reconcile'&&m==='POST'){
    if(!isAdmin(user))return send(res,403,{error:'Pembaruan target dan jadwal khusus admin.'});
    const {reconcilePlanting}=await import('./lib/planting-review.js');
    return send(res,200,reconcilePlanting({db,tx,locations:ownedPlanningLocations(),insertRow,now,log},await readBody(req)));
  }

  // Laporan pertanggungjawaban lengkap (Excel): khusus admin atau akun yang diberi peran "Unduh Laporan Lengkap" oleh admin.
  if(parts[1]==='reports' && parts[2]==='lengkap.xlsx' && m==='GET') {
    if(!canDownloadFullReport(user))return send(res,403,{error:'Unduh laporan lengkap hanya untuk admin atau akun yang diberi izin oleh admin.'});
    const today=new Date(Date.now()+7*3600e3).toISOString().slice(0,10),from=url.searchParams.get('from')||today.slice(0,4)+'-01-01',to=url.searchParams.get('to')||today;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return send(res,400,{error:'Periksa periode laporan (tanggal awal tidak boleh setelah tanggal akhir).'});
    const {accountabilityData,accountabilityWorkbook}=await import('./lib/accountability-report.js'),planning=ownedPlanningLocations(),cache=new Map();
    const ctx={rows:t=>{if(!cache.has(t))cache.set(t,db.prepare(`SELECT * FROM ${q(t)}`).all());return cache.get(t);}};
    const details=[['pisang_panen_pkk','Panen Pisang PKK'],['pisang_box','Packing Pisang'],['pisang_penjualan','Penjualan Pisang'],['padi_panen','Panen Padi'],['padi_giling','Giling Padi'],['padi_penjualan','Penjualan Padi'],['pisang_bibit','Bibit Pisang Datang']].map(([t,title])=>{
      const T=TABLES[t],rows=db.prepare(`SELECT * FROM ${q(t)} WHERE ${q(T.date)} BETWEEN ? AND ? ORDER BY ${q(T.date)},id`).all(from,to);
      for(const r of rows)for(const f of T.f.filter(f=>f.t==='calc'))try{r[f.k]=f.fn(r,ctx);}catch{r[f.k]=null;}
      return {title,fields:T.f.filter(f=>!f.hide).map(f=>({k:f.k,l:f.l,t:f.t})),rows,...(t.endsWith('_penjualan')?{sale:isJual}:{})};
    });
    const activities=db.prepare("SELECT r.divisi,min(i.aktivitas) aktivitas,min(i.satuan) satuan,count(DISTINCT r.tanggal) hari,count(DISTINCT lower(trim(i.blok))) blok,sum(i.realisasi) hasil,sum(i.hk_realisasi) hk FROM daily_report r JOIN daily_item i ON i.report_id=r.id WHERE r.status='Selesai' AND r.tanggal BETWEEN ? AND ? GROUP BY r.divisi,lower(trim(i.aktivitas)),lower(trim(coalesce(i.satuan,''))) ORDER BY r.divisi,min(i.aktivitas)").all(from,to);
    const data=accountabilityData({from,to,today,company:getSetting('nama')||'PT VIGU FARM INDONESIA',createdBy:user.nama||user.username,overview:reads.overview({from,to,today,blocks:verifiedOverviewBlocks()}),plan:kebunPlan(db,planning,today),padi:padiSummary(db,planning,today),locations:planning,landPisang:kebunSummary(db,planning,today,'Pisang'),landPadi:kebunSummary(db,ownedDailyLocations(),today,'Padi'),activities,details});
    const buf=await accountabilityWorkbook(data),fname=`Laporan Lengkap Kebun ${from} sd ${to}.xlsx`;
    return send(res,200,buf,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{'Content-Disposition':`attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`});
  }
  if(parts[1]==='reports' && m==='GET') {
    if(!user)return send(res,401,{error:'Silakan login untuk mengunduh laporan.'});
    const today=new Date(Date.now()+7*3600e3).toISOString().slice(0,10),divisi=url.searchParams.get('divisi'),reportId=Number(url.searchParams.get('reportId'))||null;let from=url.searchParams.get('from')||today,to=url.searchParams.get('to')||from;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return send(res,400,{error:'Periksa periode laporan.'});
    const owner=['owner.pdf','owner-summary'].includes(parts[2])||url.searchParams.get('owner')==='true';if(owner){try{({from,to}=reportWeek(url.searchParams.get('week')||to));}catch{return send(res,400,{error:'Tanggal minggu tidak valid.'});}}
    if(!isAdmin(user)&&!dailyOnly(user))return send(res,403,{error:'Rincian laporan khusus admin atau mandor sesuai divisinya.'});
    const canOwner=isAdmin(user);
    if(owner&&!canOwner)return send(res,403,{error:'Laporan gabungan khusus owner/management.'});
    const allowed=dailyOnly(user)?dailyDivisions(user):DAILY_DIVISI;
    if(divisi&&!allowed.includes(divisi))return send(res,403,{error:'Laporan bukan divisi Anda.'});
    const args=[from,to],where=['tanggal BETWEEN ? AND ?'];
    if(divisi){where.push('divisi=?');args.push(divisi);}else{where.push('divisi IN ('+allowed.map(()=>'?').join(',')+')');args.push(...allowed);}
    if(reportId){where.push('id=?');args.push(reportId);}
    if(url.searchParams.get('cycle')){where.push('siklus=?');args.push(url.searchParams.get('cycle'));}
    const reports=db.prepare('SELECT * FROM daily_report WHERE '+where.join(' AND ')+' ORDER BY tanggal,divisi,id').all(...args).map(dailyPayload).filter(r=>!owner||r.items.some(x=>x.realisasi!=null||x.hk_realisasi!=null||x.keterangan)||r.kendala||r.tindak_lanjut||r.photos.some(p=>!p.deleted_at));
    if(owner){
      const {buildReportPDF,ownerSections}=await import('./lib/reports-pdf.js'),{ownerWeeklyWork,ownerWeeklyNotes,selectOwnerPhotos}=await import('./lib/owner-weekly.js');
      const through=to<today?to:today,completed=reports.filter(r=>r.status==='Selesai'&&r.tanggal<=through),summary=reads.overview({from,to:through,today,blocks:verifiedOverviewBlocks()}),work=ownerWeeklyWork({db,from,to:through,reports:completed,landTargets:dailyLandTargets(from),locations:ownedDailyLocations()}),notes=ownerWeeklyNotes(completed),samples=selectOwnerPhotos(completed),sections=ownerSections({db,from,to:through,climate:summary.climate,work});
      summary.lcByCrop=ownerLandClearing(db,from,through);
      if(parts[2]==='owner-summary')return send(res,200,{from,to,summary,sections,work,notes,reportCount:completed.length,photos:samples.flatMap(r=>r.photos.map(p=>({id:p.id,division:r.divisi,date:r.tanggal,caption:p.caption||p.jenis||'Foto kegiatan',url:p.url,thumbnail_url:p.thumbnail_url})))});
      if(parts[2]==='share')return send(res,200,{text:'LAPORAN MINGGUAN KEBUN VIGU FARM\n'+from+' s.d. '+to+'\n'+work.map(r=>r.division+' / '+r.activity+': '+(r.actual==null?'hasil belum tercatat':r.actual.toLocaleString('id-ID',{maximumFractionDigits:2})+' '+r.unit)+'; target '+(r.target==null?'belum ada':r.target.toLocaleString('id-ID',{maximumFractionDigits:2})+' '+r.unit+(r.targetPartial?' (sebagian)':''))).join('\n')+'\nPDF berisi rekap mingguan dan sampel foto kegiatan.'});
      if(parts[2]!=='owner.pdf')return send(res,404,{error:'Laporan tidak ditemukan'});
      await attachReportPhotos(samples);
      const pdf=await buildReportPDF({name:db.prepare("SELECT v FROM _settings WHERE k='nama'").get()?.v||'PT VIGU FARM INDONESIA',from,to,reports:samples,summary,sections,notes,owner:true,createdBy:user.nama||user.username});
      return send(res,200,pdf,'application/pdf',{'Content-Disposition':'attachment; filename="weekly-kebun-vigu-'+from+'-'+to+'.pdf"'});
    }
    if(parts[2]==='share') {
      const lines=reports.slice(0,5).map(r=>r.tanggal+' / '+r.divisi+' / '+r.status+'\n'+r.items.slice(0,4).map(x=>'- '+x.blok+': '+x.aktivitas+' '+(x.realisasi??'belum diisi')+' '+(x.satuan||'')+'; HK '+(x.hk_realisasi??'belum diisi')).join('\n'));
      return send(res,200,{text:'LAPORAN KEBUN VIGU FARM\n'+from+' s.d. '+to+'\n'+(owner?'Laporan gabungan owner.\n':'')+lines.join('\n\n')+'\n\nRincian lengkap terlampir pada PDF.'});
    }
    if(!['daily.pdf','owner.pdf'].includes(parts[2]))return send(res,404,{error:'Laporan tidak ditemukan'});
    const {buildReportPDF,ownerSections}=await import('./lib/reports-pdf.js'),summary=owner?reads.overview({from,to,today,blocks:verifiedOverviewBlocks()}):null;
    await attachReportPhotos(reports);
    const pdf=await buildReportPDF({name:db.prepare("SELECT v FROM _settings WHERE k='nama'").get()?.v||'PT VIGU FARM INDONESIA',from,to,reports,summary,sections:owner?ownerSections({db,from,to,climate:summary.climate}):[],owner,createdBy:user.nama||user.username});
    return send(res,200,pdf,'application/pdf',{'Content-Disposition':'attachment; filename="laporan-'+(owner?'owner':'daily')+'-'+from+'-'+to+'.pdf"'});
  }

  // Lightweight read models and versioned GIS changes.
  if (['records','climate','blocks','gis'].includes(parts[1]) && dailyOnly(user)) return send(res,403,{error:'Akun lapangan hanya dapat mengakses Daily Report.'});
  if(m==='GET'&&url.pathname==='/api/daily/hk-summary'){
    const from=url.searchParams.get('from'),to=url.searchParams.get('to');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||'')||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||from>to||Date.parse(to)-Date.parse(from)>31*86400000)return send(res,400,{error:'Pilih rentang tanggal maksimal 31 hari.'});
    const origin=req.headers.origin,allowed=origin==='https://vigufarm-web.github.io'||(!VERCEL&&/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin||'')),headers=allowed?{'Access-Control-Allow-Origin':origin}:{};
    return send(res,200,dailyHKSummary(db,from,to),'application/json; charset=utf-8',headers);
  }
  if(m==='GET'&&url.pathname==='/api/daily/public'){
    const today=new Date(Date.now()+7*3600e3).toISOString().slice(0,10),from=url.searchParams.get('from')||reportWeek(today).from,to=url.searchParams.get('to')||today;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||Date.parse(to)-Date.parse(from)>31*86400000)return send(res,400,{error:'Pilih rentang maksimal 31 hari.'});
    const reports=db.prepare("SELECT * FROM daily_report WHERE status='Selesai' AND tanggal BETWEEN ? AND ? ORDER BY tanggal DESC,divisi,id DESC LIMIT 100").all(from,to<today?to:today).map(dailyPayload);
    const fields=['blok','aktivitas','realisasi','hasil_sdhi','satuan','hk_realisasi','hk_rencana','target','alat','meter_awal','meter_akhir','ritase','keterangan'];
    return send(res,200,{from,to,reports:reports.map(r=>({id:r.id,tanggal:r.tanggal,divisi:r.divisi,status:r.status,kendala:r.kendala,tindak_lanjut:r.tindak_lanjut,items:r.items.map(x=>Object.fromEntries(fields.map(k=>[k,x[k]??null]))),photos:r.photos.filter(p=>!p.deleted_at&&p.url).map(p=>({id:p.id,caption:p.caption||p.jenis||'Foto kegiatan',url:'/api/daily/public/photo/'+p.id,thumbnail_url:p.thumbnail_url?'/api/daily/public/photo/'+p.id+'?thumb=1':null}))}))});
  }
  if(m==='GET'&&/^\/api\/daily\/public\/photo\/\d+$/.test(url.pathname)){
    let photo=db.prepare("SELECT p.* FROM daily_photo p JOIN daily_report r ON r.id=p.report_id WHERE p.id=? AND r.status='Selesai' AND r.tanggal<=?").get(Number(parts[4]),new Date(Date.now()+7*3600e3).toISOString().slice(0,10));
    if(!photo||photo.deleted_at||photoExpired(photo)||!photo.lokasi)return send(res,404,{error:'Foto tidak tersedia.'});
    if(url.searchParams.get('thumb')==='1'&&photo.thumb_lokasi)photo={...photo,lokasi:photo.thumb_lokasi,storage:photo.thumb_storage,mime:'image/webp'};
    if(photo.storage==='blob'){const result=await blobGet(photo.lokasi,{access:'private'});if(!result||result.statusCode!==200)return send(res,404,{error:'Foto tidak tersedia.'});res.writeHead(200,{'Content-Type':result.blob.contentType||photo.mime,'Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'});return Readable.fromWeb(result.stream).pipe(res);}
    const file=safeJoin(PHOTO_DIR,photo.lokasi);if(!file||!fs.existsSync(file))return send(res,404,{error:'Foto tidak tersedia.'});return serveFile(res,file);
  }
  if(url.pathname==='/api/kebun-plan/map'&&m==='GET')return send(res,200,ownedPlanningMap());
  if(parts[1]==='kebun-plan'&&m==='GET')return send(res,200,kebunPlan(db,ownedPlanningLocations(),new Date(Date.now()+7*3600e3).toISOString().slice(0,10)));
  if(parts[1]==='padi-summary'&&m==='GET')return send(res,200,padiSummary(db,ownedPlanningLocations(),new Date(Date.now()+7*3600e3).toISOString().slice(0,10)));
  if(parts[1]==='summary-periods'&&m==='GET'){const periods=summaryPeriods(new Date(Date.now()+7*3600e3).toISOString().slice(0,10));const values=cloud?await cloudOverviewPeriods(cloud,periods):periods.map(p=>({...p,...reads.overview({...p,blocks:verifiedOverviewBlocks()})}));return send(res,200,{periods:values.map(d=>({key:d.key,label:d.label,from:d.from,to:d.to,pisang:d.pisang,padi:d.padi,infra:d.infra,dailyTotals:d.dailyTotals,climate:{rain:d.climate.rain,observations:d.climate.observations,rainDays:d.climate.rainDays,...(d.key==='month'?{days:d.climate.days}:{})}}))});}
  if(parts[1]==='kebun-summary'&&m==='GET')return send(res,200,kebunSummary(db,url.searchParams.get('kom')==='Padi'?ownedDailyLocations():ownedPlanningLocations(),new Date(Date.now()+7*3600e3).toISOString().slice(0,10),url.searchParams.get('kom')==='Padi'?'Padi':'Pisang'));
  if(parts[1]==='kebun'&&m==='GET'){
    const tables=['lahan_blok','lahan_harian','lahan_aktivitas','lahan_target','lahan_rencana','pisang_blok'];
    const data=Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM '+q(t)).all().filter(r=>!hiddenActivity(r.aktivitas)).map(({created_at,updated_at,block_name_snapshot,...r})=>r)]));
    return send(res,200,{data,settings:Object.fromEntries(db.prepare('SELECT * FROM _settings').all().map(r=>[r.k,r.v]))});
  }
  if (parts[1]==='overview' && m==='GET') {
    const today=new Date(Date.now()+7*3600e3).toISOString().slice(0,10),from=url.searchParams.get('from')||today.slice(0,7)+'-01',to=url.searchParams.get('to')||today;
    const summary=cloud?await cloudOverview(cloud,{from,to,today,TABLES}):reads.overview({from,to,today,blocks:verifiedOverviewBlocks()});if(!user)summary.daily=[];return send(res,200,summary);
  }
  if (parts[1]==='climate' && m==='GET') {const today=new Date(Date.now()+7*3600e3).toISOString().slice(0,10);return send(res,200,reads.climate(url.searchParams.get('from')||today.slice(0,7)+'-01',url.searchParams.get('to')||today));}
  if (parts[1]==='records' && m==='GET') {
    const t=parts[2];if(!TABLES[t]||t.startsWith('daily_')||t==='gis_layer')return send(res,400,{error:'Gunakan endpoint khusus untuk data ini.'});
    return send(res,200,reads.records(t,url.searchParams));
  }
  if(parts[1]==='nursery-summary'&&m==='GET'){if(!isAdmin(user))return send(res,403,{error:'Khusus admin'});const {nurserySummary}=await import('./lib/nursery-summary.js');return send(res,200,nurserySummary(db));}
  if(parts[1]==='gis-registry') {
    if(!isAdmin(user))return send(res,403,{error:'Pengelolaan data induk GIS khusus admin.'});
    const at=url.searchParams.get('at')||now().slice(0,10);
    if(m==='POST'&&parts[2]==='grants'){const body=await readBody(req);return send(res,200,tx(()=>gisRegistry.grant(body.app)));}
    if(m==='GET'&&!parts[2])return send(res,200,gisRegistry.catalog(at,ownedPlanningLocations()));
    if(m==='GET'&&parts[2]==='history')return send(res,200,gisRegistry.history(parts[3]));
    if(parts[2]==='migration'&&m==='GET')return send(res,200,gisRegistry.legacyPreview());
    if(parts[2]==='migration'&&m==='POST'){const body=await readBody(req);return send(res,200,tx(()=>{const result=gisRegistry.importLegacy(body.token);log('migrasi data induk tanaman','_gis_plantings',null,result);return result;}));}
    if(parts[2]==='layers'&&m==='POST'){
      const body=await readBody(req),old=body.layerId?db.prepare('SELECT * FROM gis_layer WHERE id=?').get(Number(body.layerId)):null;
      if(body.layerId&&!old)return send(res,404,{error:'Layer tidak ditemukan.'});
      const layer={...old,...clean('gis_layer',body.layer||{})};if(isBlockLayer(layer))return send(res,400,{error:'Blok Tanam harus melalui pratinjau identitas blok.'});
      if(!['Persil Lahan','Jalan'].includes(layer.jenis))return send(res,400,{error:'Pilih jenis Persil Lahan atau Jalan.'});
      let fc;try{fc=JSON.parse(layer.geojson);}catch{return send(res,400,{error:'GeoJSON tidak valid.'});}
      if(fc?.type!=='FeatureCollection'||!Array.isArray(fc.features)||!fc.features.length)return send(res,400,{error:'Layer harus berisi FeatureCollection.'});
      const token=crypto.createHash('sha256').update(JSON.stringify({old,layer})).digest('hex');
      const summary={type:'layer',kind:layer.jenis,name:layer.nama,old_features:old?JSON.parse(old.geojson).features.length:0,new_features:fc.features.length,source:body.source||null};
      if(body.mode!=='apply')return send(res,200,{token,summary});if(body.token!==token)return send(res,409,{error:'Layer berubah sejak pratinjau. Periksa ulang.'});
      return send(res,200,tx(()=>{
        const before=new Map(ownedPlanningLocations().map(b=>[b.id,b.luas_ha]));for(const b of blocks.list())gisRegistry.recordBlock(b.id,'Sebelum revisi '+layer.jenis,before.get(b.id)??null);
        let id=old?.id;if(id){const vals=clean('gis_layer',layer),keys=Object.keys(vals);db.prepare('UPDATE gis_layer SET updated_at=?,'+keys.map(k=>q(k)+'=?').join(',')+' WHERE id=?').run(now(),...keys.map(k=>vals[k]),id);}else id=insertRow('gis_layer',layer);
        const after=new Map(ownedPlanningLocations().map(b=>[b.id,b.luas_ha]));for(const b of blocks.list())gisRegistry.recordBlock(b.id,'Revisi '+layer.jenis,after.get(b.id)??null);
        db.prepare('INSERT INTO _gis_revisions(layer_id,before_json,after_json,summary,oleh,created_at) VALUES(?,?,?,?,?,?)').run(id,old?.geojson||null,layer.geojson,JSON.stringify(summary),user.nama||user.username,now());log('revisi layer GIS','gis_layer',id,summary);return {id,summary};
      }));
    }
    if(parts[2]==='plantings'&&m==='POST'){const body=await readBody(req);return send(res,200,tx(()=>{const result=gisRegistry.savePlanting(body);log('ubah kelompok tanam','_gis_plantings',null,{id:result.id,block_id:result.block_id,version:result.version});return result;}));}
    return send(res,404,{error:'Endpoint pusat GIS tidak ditemukan.'});
  }
  if(parts[1]==='blocks' && m==='GET') {
    if(parts[2] && parts[3]==='history') {if(!user)return send(res,401,{error:'Silakan login.'});return send(res,200,blocks.history(parts[2]));}
    return send(res,200,verifiedOverviewBlocks());
  }
  if(parts[1]==='gis' && parts[2]==='layers' && m==='GET') {
    if(parts[3]) {const row=db.prepare('SELECT * FROM gis_layer WHERE id=?').get(Number(parts[3]));return send(res,row?200:404,row||{error:'Layer tidak ditemukan'});}
    return send(res,200,db.prepare('SELECT id,nama,jenis,field_nama,warna,tampil,urutan,gaya,updated_at FROM gis_layer ORDER BY urutan,id').all());
  }
  if(parts[1]==='gis' && parts[2]==='revisions' && m==='GET') {if(!isAdmin(user))return send(res,403,{error:'Khusus admin'});return send(res,200,db.prepare('SELECT id,layer_id,summary,oleh,created_at FROM _gis_revisions ORDER BY id DESC LIMIT 100').all());}
  if(parts[1]==='gis' && parts[2]==='revision' && m==='POST') {
    if(!isAdmin(user))return send(res,403,{error:'Khusus admin GIS'});
    const body=await readBody(req),old=body.layerId?db.prepare('SELECT * FROM gis_layer WHERE id=?').get(Number(body.layerId)):null;
    if(body.layerId&&!old)return send(res,404,{error:'Layer tidak ditemukan'});
    const layer={...old,...clean('gis_layer',body.layer||{}),id:old?.id};
    if(!isBlockLayer(layer))return send(res,400,{error:'Revisi ini khusus layer Blok Tanam / Blok Kebun.'});
    const preview=blocks.plan(layer,{mappings:body.mappings||{}});
    if(body.mode!=='apply')return send(res,200,preview);
    if(!body.token||body.token!==preview.token)return send(res,409,{error:'Pratinjau sudah berubah. Periksa kembali sebelum menerapkan.'});
    if(preview.errors.length)return send(res,400,{error:preview.errors.join('\n')});
    const result=tx(()=>{
      for(const change of preview.changes)if(change.id&&blocks.list().some(b=>b.id===change.id))gisRegistry.recordBlock(change.id,'Sebelum revisi GIS');
      const id=old?.id||insertRow('gis_layer',{...layer,geojson:preview.geojson});
      // New IDs from this exact reviewed proposal are carried into apply.
      const applied=blocks.apply({...layer,id,geojson:preview.geojson},{mappings:body.mappings||{}});
      const values=clean('gis_layer',{...layer,geojson:applied.geojson}),cols=Object.keys(values);db.prepare('UPDATE gis_layer SET updated_at=?'+cols.map(k=>', '+q(k)+'=?').join('')+' WHERE id=?').run(now(),...cols.map(k=>values[k]),id);
      db.prepare('INSERT INTO _gis_revisions (layer_id,before_json,after_json,summary,oleh,created_at) VALUES (?,?,?,?,?,?)').run(id,old?.geojson||null,applied.geojson,JSON.stringify(preview.changes),user.nama||user.username,now());
      for(const change of applied.changes)gisRegistry.recordBlock(change.id,'Revisi GIS');
      // A boundary revision must never rewrite previously recorded work quantities.
      log('revisi GIS','gis_layer',id,{changes:preview.changes});return {id,changes:preview.changes};
    });
    return send(res,200,result);
  }

  if(parts[1]==='land-prep'&&parts[2]==='import-actual'&&m==='POST'){
    if(!user||!isAdmin(user))return send(res,403,{error:'Impor aktual khusus admin.'});
    const body=await readBody(req),result=importLand({db,tx,blocks,insertRow,now,actor:user.nama||user.username},body);
    if(body.mode==='apply'&&!result.already_applied)log('sesuaikan aktual lahan','lahan_harian',null,result);
    return send(res,200,result);
  }
  if(parts[1]==='padi' && parts[2]==='import-harvest' && m==='POST') {
    if(!user || !isAdmin(user))return send(res,403,{error:'Impor panen khusus admin.'});
    const body=await readBody(req);
    const result=importPadi({db,tx,blocks,insertRow,now,actor:user.nama||user.username},body);
    if(body.mode==='apply'&&!result.already_applied)log('impor panen padi','padi_panen',null,{jumlah:result.added});
    return send(res,200,result);
  }
  if(parts[1]==='daily' && parts[2]==='transfer' && m==='POST') {
    if(!user || !isAdmin(user))return send(res,403,{error:'Pemindahan laporan khusus admin.'});
    const body=await readBody(req);
    const result=transferDaily({db,tx,blocks,now,actor:user.nama||user.username},body);
    if(body.mode==='apply'&&!result.already_applied){tx(()=>registerHistoricalDailyCoverage(db,now,result.reports.map(r=>r.id)));log('pindahkan laporan','daily_report',null,{jumlah:result.reports.length});}
    return send(res,200,result);
  }
  // --- Daily Report (harus login; mandor hanya dapat mengubah divisinya)
  if (parts[1] === 'daily') {
    if(!isAdmin(user)&&!dailyOnly(user))return send(res,403,{error:'Daily Report hanya untuk admin dan mandor sesuai divisinya.'});
    if (m === 'GET' && parts[2] === 'locations') {
      if (!user) return send(res, 401, { error: 'Silakan login untuk memilih lokasi Daily Report' });
      return send(res,200,withGeneralDailyLocations(ownedDailyLocations()));
    }
    if (m === 'GET' && parts[2] === 'plans') {
      const selected = url.searchParams.get('week') || now().slice(0, 10), bounds = weekBounds(selected);
      if (!bounds) return send(res, 400, { error: 'Minggu tidak valid' });
      const divisi = url.searchParams.get('divisi'), where = ['week_start=?'], args = [bounds.start];
      if (divisi && DAILY_DIVISI.includes(divisi)) { where.push('divisi=?'); args.push(divisi); }
      if (dailyOnly(user)) { const allowed = dailyDivisions(user); if (!allowed.length) return send(res, 200, []); where.push(`divisi IN (${allowed.map(() => '?').join(',')})`); args.push(...allowed); }
      return send(res, 200, db.prepare(`SELECT * FROM daily_week_plan WHERE ${where.join(' AND ')} ORDER BY divisi`).all(...args).map(weeklyPlanPayload));
    }
    if (m === 'POST' && parts[2] === 'plans') {
      const b = await readBody(req), divisi = String(b.divisi || ''), bounds = weekBounds(b.week_start);
      const ownedNames = new Set(withGeneralDailyLocations(ownedDailyLocations()).map(x=>util.key(x.nama)));
      if ((b.items || []).some(x=>!ownedNames.has(util.key(x.blok)))) return send(res,400,{error:'Pilih blok GIS aktif yang tersedia.'});
      if (!DAILY_DIVISI.includes(divisi)) return send(res, 400, { error: 'Divisi harus Pisang, Padi, atau Infra' });
      if (!bounds) return send(res, 400, { error: 'Minggu pelaksanaan wajib diisi' });
      if (!canDaily(user, divisi)) return send(res, 403, { error: `Akun ini tidak boleh mengubah rencana ${divisi}` });
      const old = b.id ? db.prepare('SELECT * FROM daily_week_plan WHERE id=?').get(Number(b.id)) : db.prepare('SELECT * FROM daily_week_plan WHERE week_start=? AND divisi=?').get(bounds.start, divisi);
      if (old && !canDaily(user, old.divisi)) return send(res, 403, { error: 'Tidak diizinkan mengubah rencana ini' });
      if (b.workflow_v2) {
        // Form baru tidak boleh diam-diam menimpa rencana minggu yang sama; revisi memakai id rencana tersebut.
        if (b.id && !old) return send(res, 404, { error: 'Rencana tidak ditemukan. Muat ulang halaman.' });
        const occupied = db.prepare('SELECT id, status FROM daily_week_plan WHERE week_start=? AND divisi=?').get(bounds.start, divisi);
        if (occupied && (!b.id || Number(occupied.id) !== Number(b.id))) return send(res, 409, { error: `Rencana ${divisi} minggu ${bounds.start} sudah ada (${occupied.status}). Buka rencana itu dari daftar untuk melanjutkan atau merevisi.` });
      }
      if(old&&b.workflow_v2&&(!b.updated_at||b.updated_at!==old.updated_at))return send(res,409,{error:'Rencana telah diperbarui dari tempat lain. Tutup dan buka kembali rencana agar versi terbaru tidak tertimpa.'});
      if(!Array.isArray(b.items)||!b.items.length)return send(res,400,{error:'Isi minimal satu kegiatan dan blok.'});
      const weeklyGroups=b.workflow_v2?checkWeeklyWorkflow(b,withGeneralDailyLocations(ownedDailyLocations()),old?db.prepare('SELECT * FROM daily_week_item WHERE plan_id=?').all(old.id):[]):null;
      const status = b.status === 'Dikirim' ? 'Dikirim' : 'Draf', penginput = user.nama || user.username;
      let planId;
      tx(() => {
        if(old)db.prepare('INSERT INTO _weekly_revisions(plan_id,created_at,actor,before_json) VALUES(?,?,?,?)').run(old.id,now(),penginput,JSON.stringify(weeklyPlanPayload(old)));
        if (old) { planId = old.id; db.prepare('UPDATE daily_week_plan SET updated_at=?, week_start=?, week_end=?, divisi=?, status=?, catatan=?, dikirim_at=?, dibuat_oleh=? WHERE id=?').run(now(), bounds.start, bounds.end, divisi, status, textLimit(b.catatan, 2000), status === 'Dikirim' ? old.dikirim_at || now() : old.dikirim_at || null, penginput, planId); }
        else { const r = db.prepare('INSERT INTO daily_week_plan (created_at, updated_at, week_start, week_end, divisi, status, catatan, dikirim_at, dibuat_oleh) VALUES (?,?,?,?,?,?,?,?,?)').run(now(), now(), bounds.start, bounds.end, divisi, status, textLimit(b.catatan, 2000), status === 'Dikirim' ? now() : null, penginput); planId = Number(r.lastInsertRowid); }
        saveWeeklyItems(db,planId,b.items.map(x=>({...x,blok:textLimit(x.blok,200),aktivitas:textLimit(x.aktivitas,300),satuan:textLimit(x.satuan,30),keterangan:textLimit(x.keterangan,1000)})),now());
        db.prepare('UPDATE daily_week_plan SET hk_kegiatan=? WHERE id=?').run(weeklyGroups?JSON.stringify(weeklyGroups):null,planId);
      });
      blocks.linkTable('daily_week_item');
      log(old ? 'ubah' : 'tambah', 'daily_week_plan', planId, { week_start: bounds.start, divisi, status, jumlah_kegiatan: (b.items || []).length });
      return send(res, 200, weeklyPlanPayload(db.prepare('SELECT * FROM daily_week_plan WHERE id=?').get(planId)));
    }
    if (m === 'GET' && parts[2] === 'photo' && parts[3]) {
      let photo = db.prepare('SELECT * FROM daily_photo WHERE id=?').get(Number(parts[3]));
      if (!photo || photo.deleted_at || photoExpired(photo) || !photo.lokasi) return send(res, 404, { error: 'Foto sudah dihapus atau tidak ditemukan' });
      const photoReport = db.prepare('SELECT * FROM daily_report WHERE id=?').get(photo.report_id);
      if (dailyOnly(user) && (!photoReport || !canDaily(user, photoReport.divisi))) return send(res, 403, { error: 'Foto bukan milik divisi Anda' });
      if(url.searchParams.get('thumb')==='1' && photo.thumb_lokasi)photo={...photo,lokasi:photo.thumb_lokasi,storage:photo.thumb_storage,mime:'image/webp'};
      if (photo.storage === 'blob') {
        const result = await blobGet(photo.lokasi, { access: 'private' });
        if (!result || result.statusCode !== 200) return send(res, 404, { error: 'Foto tidak ditemukan' });
        res.writeHead(200, { 'Content-Type': result.blob.contentType || photo.mime || 'application/octet-stream', 'Content-Length': result.blob.size, 'Cache-Control': 'private, max-age=300', ETag: result.blob.etag });
        return Readable.fromWeb(result.stream).pipe(res);
      }
      const file = safeJoin(PHOTO_DIR, photo.lokasi);
      if (!file || !fs.existsSync(file)) return send(res, 404, { error: 'Foto tidak ditemukan' });
      return serveFile(res, file);
    }
    if (m === 'GET' && !parts[2]) {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to'), divisi = url.searchParams.get('divisi');
      const where = [], args = [];
      if (from) { where.push('tanggal>=?'); args.push(from); }
      if (to) { where.push('tanggal<=?'); args.push(to); }
      if (divisi && DAILY_DIVISI.includes(divisi)) { where.push('divisi=?'); args.push(divisi); }
      if (dailyOnly(user)) {
        const allowed = dailyDivisions(user);
        if (!allowed.length) return send(res, 200, []);
        where.push(`divisi IN (${allowed.map(() => '?').join(',')})`); args.push(...allowed);
      }
      const sql = `SELECT * FROM daily_report${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY tanggal DESC, divisi, id DESC LIMIT 400`;
      return send(res, 200, db.prepare(sql).all(...args).map(dailyPayload));
    }
    if (m === 'POST' && parts[2] === 'photo') {
      const report = db.prepare('SELECT * FROM daily_report WHERE id=?').get(Number(url.searchParams.get('report')));
      if (!report) return send(res, 404, { error: 'Laporan tidak ditemukan' });
      if (!canDaily(user, report.divisi)) return send(res, 403, { error: `Akun ini tidak boleh mengubah Daily Report ${report.divisi}` });
      const expires = photoExpiresAt(report.tanggal);
      if(photoExpired({expires_at:expires})) return send(res,400,{error:'Foto hanya disimpan untuk laporan 14 hari terakhir. Data teks laporan tetap dapat dilengkapi.'});
      const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return send(res, 400, { error: 'Foto harus JPG, PNG, atau WebP' });
      if (Number(req.headers['content-length'] || 0) > 2.5e6) return send(res, 413, { error: 'Foto maksimal 2,5 MB setelah dikompres' });
      const buf = await readRaw(req);
      if (!buf.length || buf.length > 2.5e6) return send(res, 413, { error: 'Foto kosong atau lebih dari 2,5 MB' });
      if(parts[3] && parts[4]==='thumbnail') {const photo=db.prepare('SELECT * FROM daily_photo WHERE id=? AND report_id=? AND deleted_at IS NULL').get(Number(parts[3]),report.id);if(!photo)return send(res,404,{error:'Foto tidak ditemukan'});if(buf.length>150000)return send(res,413,{error:'Thumbnail maksimal 150 KB'});const thumb=await storeDailyPhoto(buf,mime,report);if(photo.thumb_lokasi)await removeStoredPhoto({lokasi:photo.thumb_lokasi,storage:photo.thumb_storage});db.prepare('UPDATE daily_photo SET thumb_lokasi=?,thumb_storage=?,updated_at=? WHERE id=?').run(thumb.lokasi,thumb.storage,now(),photo.id);return send(res,200,{id:photo.id});}
      const contentHash=crypto.createHash('sha256').update(buf).digest('hex');
      const duplicate=db.prepare('SELECT id,expires_at FROM daily_photo WHERE report_id=? AND content_hash=? AND deleted_at IS NULL').get(report.id,contentHash);
      if(duplicate)return send(res,200,{id:duplicate.id,url:'/api/daily/photo/'+duplicate.id,expires_at:duplicate.expires_at});
      const saved = await storeDailyPhoto(buf, mime, report);
      const result = db.prepare('INSERT INTO daily_photo (created_at, updated_at, report_id, jenis, caption, storage, lokasi, mime, ukuran, expires_at, content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(now(), now(), report.id, ['Apel', 'Kegiatan', 'Kendala'].includes(url.searchParams.get('jenis')) ? url.searchParams.get('jenis') : 'Kegiatan', textLimit(url.searchParams.get('caption'), 200), saved.storage, saved.lokasi, mime, buf.length, expires, contentHash);
      const id = Number(result.lastInsertRowid);
      log('unggah foto', 'daily_photo', id, { report_id: report.id, divisi: report.divisi, expires_at: expires });
      return send(res, 200, { id, url: `/api/daily/photo/${id}`, expires_at: expires });
    }
    if (m === 'DELETE' && parts[2] === 'photo' && parts[3]) {
      const photo = db.prepare('SELECT * FROM daily_photo WHERE id=?').get(Number(parts[3]));
      const report = photo && db.prepare('SELECT * FROM daily_report WHERE id=?').get(photo.report_id);
      if (!photo || !report) return send(res, 404, { error: 'Foto tidak ditemukan' });
      if (!canDaily(user, report.divisi)) return send(res, 403, { error: 'Tidak diizinkan' });
      await removeStoredPhoto(photo);
      db.prepare('UPDATE daily_photo SET deleted_at=?, lokasi=NULL, updated_at=? WHERE id=?').run(now(), now(), photo.id);
      log('hapus foto', 'daily_photo', photo.id, { report_id: report.id, divisi: report.divisi });
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && !parts[2]) {
      const b = await readBody(req), divisi = String(b.divisi || '');
      const ownedNames = new Set(withGeneralDailyLocations(ownedDailyLocations()).map(x=>util.key(x.nama)));
      if (!DAILY_DIVISI.includes(divisi)) return send(res, 400, { error: 'Divisi harus Pisang, Padi, atau Infra' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.tanggal || ''))) return send(res, 400, { error: 'Tanggal wajib diisi' });
      if (!canDaily(user, divisi)) return send(res, 403, { error: `Akun ini tidak boleh mengubah Daily Report ${divisi}` });
      const submissionKey=b.request_key?String(b.request_key):null;
      if(submissionKey&&!/^[a-zA-Z0-9-]{16,80}$/.test(submissionKey))return send(res,400,{error:'Nomor kiriman tidak valid.'});
      const {request_key,...submissionBody}=b,submissionHash=crypto.createHash('sha256').update(JSON.stringify(submissionBody)).digest('hex');
      if(submissionKey){const prior=db.prepare('SELECT * FROM _daily_submissions WHERE request_key=?').get(submissionKey);if(prior){if(prior.user_id!==user.id||prior.payload_hash!==submissionHash)return send(res,409,{error:'Nomor kiriman sudah digunakan untuk isian berbeda. Muat ulang laporan.'});return send(res,200,JSON.parse(prior.response_json));}}
      let old = b.id ? db.prepare('SELECT * FROM daily_report WHERE id=?').get(Number(b.id)) : db.prepare('SELECT * FROM daily_report WHERE tanggal=? AND divisi=?').get(b.tanggal, divisi);
      if (old && !canDaily(user, old.divisi)) return send(res, 403, { error: 'Tidak diizinkan mengubah laporan ini' });
      if(b.workflow_v2){
        if(b.id&&!old)return send(res,404,{error:'Laporan tidak ditemukan. Muat ulang sebelum menyimpan.'});
        if(old&&(!b.id||old.tanggal!==b.tanggal||old.divisi!==divisi||!b.updated_at||b.updated_at!==old.updated_at))return send(res,409,{error:'Laporan tanggal ini sudah ada atau telah diperbarui. Muat ulang agar laporan terbaru tidak tertimpa.'});
      }
      const previousItems = old ? db.prepare('SELECT * FROM daily_item WHERE report_id=?').all(old.id) : [];
      if(b.workflow_v2&&b.status==='Dikirim')b.status='Selesai';
      const activityGroups=b.workflow_v2?checkActualWorkflow(b,previousItems):null;
      const sameHistoricalItem = x => old && old.tanggal === b.tanggal && old.divisi === divisi && previousItems.some(p=>Number(p.id)===Number(x.id) && util.key(p.blok)===util.key(x.blok));
      if ((b.items || []).some(x=>!ownedNames.has(util.key(x.blok)) && !sameHistoricalItem(x))) return send(res,400,{error:'Kegiatan baru harus memakai blok GIS aktif. Lokasi data historis yang sama dapat dilengkapi.'});
      const status = ['Rencana Dikirim', 'Selesai'].includes(b.status) ? b.status : b.status === 'Dikirim' ? 'Selesai' : 'Draf';
      const rencanaAt = status !== 'Draf' ? old?.rencana_at || now() : old?.rencana_at || null;
      const selesaiAt = status === 'Selesai' ? now() : old?.selesai_at || null;
      if(b.apel_hadir!==''&&b.apel_hadir!=null&&(!Number.isFinite(Number(b.apel_hadir))||Number(b.apel_hadir)<0))return send(res,400,{error:'Total HK mandor harus angka nol atau lebih.'});
      const penginput = user.nama || user.username;
      const values = [b.tanggal, divisi, null, textLimit(b.siklus, 100), status, null, null, numberOrNull(b.apel_hadir), textLimit(b.apel_catatan, 2000), textLimit(b.kendala, 2000), textLimit(b.tindak_lanjut, 2000), selesaiAt, rencanaAt, selesaiAt, penginput];
      let reportId,landResult={adjusted:0};
      tx(() => {
        registerHistoricalDailyCoverage(db,now);
        if (old) {
          reportId = old.id;
          db.exec('CREATE TABLE IF NOT EXISTS _daily_revisions (id INTEGER PRIMARY KEY, report_id INTEGER, created_at TEXT, actor TEXT, before_json TEXT)');
          db.prepare('INSERT INTO _daily_revisions(report_id,created_at,actor,before_json) VALUES(?,?,?,?)').run(old.id,now(),penginput,JSON.stringify({report:old,items:previousItems}));
          db.prepare('UPDATE daily_report SET updated_at=?, tanggal=?, divisi=?, mandor=?, siklus=?, status=?, apel_mulai=?, apel_selesai=?, apel_hadir=?, apel_catatan=?, kendala=?, tindak_lanjut=?, dikirim_at=?, rencana_at=?, selesai_at=?, dibuat_oleh=? WHERE id=?').run(now(), ...values, reportId);
          db.prepare('DELETE FROM daily_item WHERE report_id=?').run(reportId);
        } else {
          const r = db.prepare('INSERT INTO daily_report (created_at, updated_at, tanggal, divisi, mandor, siklus, status, apel_mulai, apel_selesai, apel_hadir, apel_catatan, kendala, tindak_lanjut, dikirim_at, rencana_at, selesai_at, dibuat_oleh) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(now(), now(), ...values);
          reportId = Number(r.lastInsertRowid);
        }
        const insert = db.prepare('INSERT INTO daily_item (created_at, updated_at, report_id, plan_item_id, di_luar_rencana, urutan, aktivitas, blok, target, realisasi, hasil_sdhi, satuan, hk_rencana, hk_realisasi, alat, meter_awal, meter_akhir, ritase, keterangan) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const [i, x] of (Array.isArray(b.items) ? b.items : []).entries()) {
          const aktivitas = textLimit(x.aktivitas, 300); if (!aktivitas) continue;
          const inserted = insert.run(now(), now(), reportId, numberOrNull(x.plan_item_id), x.di_luar_rencana ? 1 : 0, i + 1, aktivitas, textLimit(x.blok, 200), numberOrNull(x.target), numberOrNull(x.realisasi), null, textLimit(x.satuan, 30), numberOrNull(x.hk_rencana), numberOrNull(x.hk_realisasi), textLimit(x.alat, 200), numberOrNull(x.meter_awal), numberOrNull(x.meter_akhir), numberOrNull(x.ritase), textLimit(x.keterangan, 1000));
          const historical = previousItems.find(p=>Number(p.id)===Number(x.id) && util.key(p.blok)===util.key(x.blok));
          db.prepare('UPDATE daily_item SET realisasi_input=? WHERE id=?').run(historical&&Number(x.realisasi)===Number(historical.realisasi)?historical.realisasi_input??numberOrNull(x.realisasi):numberOrNull(x.realisasi),Number(inserted.lastInsertRowid));
          if(historical) db.prepare('UPDATE daily_item SET block_id=?,block_name_snapshot=?,block_refs_snapshot=? WHERE id=?').run(historical.block_id,historical.block_name_snapshot,historical.block_refs_snapshot||null,Number(inserted.lastInsertRowid));
          else {const ref=blocks.canonical('daily_item',{blok:x.blok});if(ref.block_refs_snapshot)db.prepare('UPDATE daily_item SET block_refs_snapshot=? WHERE id=?').run(ref.block_refs_snapshot,Number(inserted.lastInsertRowid));}
        }
        db.prepare('UPDATE daily_report SET hk_kegiatan=? WHERE id=?').run(activityGroups?JSON.stringify(activityGroups):null,reportId);
        landResult=saveDailyLand(db,reportId,now,insertRow);
        if(activityGroups)reallocateEffectiveHK(db,reportId,activityGroups,status==='Selesai');
      });
      blocks.linkTable('daily_item');blocks.linkTable('lahan_harian');
      log(old ? 'ubah' : 'tambah', 'daily_report', reportId, { tanggal: b.tanggal, divisi, status, jumlah_kegiatan: (b.items || []).length });
      const savedResponse={...dailyPayload(db.prepare('SELECT * FROM daily_report WHERE id=?').get(reportId)),adjusted_land_items:landResult.adjusted};
      if(submissionKey)db.prepare('INSERT INTO _daily_submissions VALUES(?,?,?,?,?)').run(submissionKey,user.id,submissionHash,JSON.stringify(savedResponse),now());
      return send(res,200,savedResponse);
    }
    return send(res, 404, { error: 'Alamat Daily Report tidak dikenal' });
  }
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
    // Excel per halaman: ?tables=iklim,lahan_blok&kom=Pisang&panel=Iklim â†’ hanya sheet tabel itu (lahan_* hanya baris komoditas itu)
    const panel = panelOf(url) || (!isAdmin(user) ? {tables:editableExcelTables(user),kom:null,label:'Data sesuai akses'} : null);
    if(panel && !panel.tables.every(t=>canEdit(user,t)))return send(res,403,{error:'Akun Anda tidak punya izin mengakses sheet ini'});
    if (panel && !panel.tables.length) return send(res, 400, { error: 'Tabel tidak dikenal untuk Excel' });
    if(m==='GET'&&parts[2]==='summary')return send(res,200,inputSummary({tables:panel?panel.tables:[...EXCEL_TABLES],rowsOf,TABLES,today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date())}));
    if (m === 'GET' && parts[2] === 'download') {
      const buf = Buffer.from(await (await makeWorkbook(panel)).xlsx.writeBuffer());
      const fname = panel ? `Excel ${panel.label} ${now().slice(0, 10)}.xlsx` : path.basename(EXCEL_FILE);
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fname.replace(/[^w .-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fname)}` });
      return res.end(buf);
    }
    if (m === 'GET' && parts[2] === 'status') return send(res, 200, isAdmin(user)?excelStatus():{online:true,vercel:VERCEL,laporan:null,tables:editableExcelTables(user)});
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
    if (dailyOnly(user)) return send(res, 200, {});
    if(cloud){const names=Object.keys(TABLES),values=await cloud.snapshot(read=>read(names.map(t=>'SELECT count(*) c,max(updated_at) u FROM '+q(t))));return send(res,200,Object.fromEntries(names.map((t,i)=>[t,values[i][0]])));}
    const counts = {};
    for (const t of Object.keys(TABLES)) {
      if ((!user || dailyOnly(user)) && t.startsWith('daily_')) continue;
      counts[t] = db.prepare(`SELECT COUNT(*) c, MAX(updated_at) u FROM ${q(t)}`).get();
    }
    return send(res, 200, counts);
  }
  if (parts[1] === 't') {
    const table = parts[2];
    if (!TABLES[table]) return send(res, 404, { error: 'Tabel tidak dikenal' });
    if (dailyOnly(user)) return send(res, 403, { error: 'Akun mandor hanya dapat membuka Daily Report miliknya' });
    if (table.startsWith('daily_') && (!user || dailyOnly(user))) return send(res, 403, { error: 'Gunakan halaman Daily Report' });
    const id = parts[3] ? Number(parts[3]) : null;
    // ?jenis=Blok Tanam â†’ satu layer peta saja (halaman Tim Kebun di HP tidak perlu mengunduh semua layer)
    if (m === 'GET' && table === 'gis_layer' && url.searchParams.get('jenis')) { const j = url.searchParams.get('jenis'); return send(res, 200, db.prepare('SELECT * FROM gis_layer WHERE jenis=? OR nama=? ORDER BY id').all(j, j)); }
    if (m === 'GET') return send(res, 200, db.prepare(`SELECT * FROM ${q(table)}${table==='lahan_harian'?' WHERE COALESCE(diganti_aktual,0)=0':''} ORDER BY id`).all().filter(r=>!hiddenActivity(r.aktivitas)));
    if (!canEdit(user, table)) return send(res, 403, { error: `Anda tidak punya izin mengubah "${TABLES[table].title}"` });
    if (m === 'POST' && parts[3] === 'hapus') {
      if(['lahan_blok','pisang_blok','padi_petak','gis_layer'].includes(table))return send(res,409,{error:'Data induk blok/peta dipertahankan. Nonaktifkan melalui revisi GIS.'});
      const { ids, cascade } = await readBody(req);
      const olds = (ids || []).map((i) => db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(Number(i))).filter(Boolean);
      const refs = mergeRefs(olds.map((o) => childRefs(table, o)));
      if (refs.length && !cascade) return send(res, 409, { error: 'Ada data lain yang terhubung', refs });
      const r = tx(() => { let c = 0, d = 0; for (const o of olds) { d += cascade ? deleteChildren(table, o) : 0; c += Number(db.prepare(`DELETE FROM ${q(table)} WHERE id=?`).run(o.id).changes); } return { c, d }; });
      log('hapus massal', table, null, { jumlah: r.c, data_terkait_ikut_dihapus: r.d || undefined });
      if (BLOK_T[table] && table !== 'gis_layer') catatBlok(table, olds, []);
      return send(res, 200, { deleted: r.c, related: r.d });
    }
    if (m === 'POST') {
      const body = await readBody(req);
      if((Array.isArray(body)?body:[body]).some(row=>hiddenActivity(row.aktivitas)))return send(res,400,{error:'Ecer Pupuk hanya tersedia pada Daily Report mandor.'});
      if (Array.isArray(body)) {
        if(table==='gis_layer')return send(res,400,{error:'Unggah layer melalui pratinjau GIS.'});
        for(const row of body)validateOperationalBlock(table,row);
        const ids = tx(() => body.map((r) => insertRow(table, r, false)));
        log('import', table, null, { jumlah: ids.length });
        blocks.linkTable(table);
        return send(res, 200, { ids });
      }
      const blokLama = table === 'gis_layer' && layerBlok(body) ? db.prepare('SELECT * FROM gis_layer ORDER BY id DESC').all().find(layerBlok) : null; // layer Blok Tanam baru menggantikan yang lama
      if(table==='gis_layer' && isBlockLayer(body)) return send(res,409,{error:'Gunakan pratinjau revisi blok GIS.',gisRevision:true});
      validateOperationalBlock(table,body);
      const nid = insertRow(table, table==='lahan_harian'?{...body,hasil_input_ha:body.hasil_ha}:body);
      if(table==='lahan_harian')capLandRows(db,now);
      if (blokLama) catatBlok('gis_layer', fiturBlok(blokLama.geojson), fiturBlok(body.geojson), { layer: body.nama });
      blocks.linkTable(table);
      return send(res, 200, { id: nid });
    }
    if (m === 'PUT' && id) {
      const body = await readBody(req), old = db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(id);
      if(hiddenActivity(body.aktivitas))return send(res,400,{error:'Ecer Pupuk hanya tersedia pada Daily Report mandor.'});
      if(table==='gis_layer' && body.geojson && isBlockLayer({...old,...body})) return send(res,409,{error:'Gunakan pratinjau revisi blok GIS.',gisRevision:true});
      if(!old)return send(res,404,{error:'Data tidak ditemukan'});
      validateOperationalBlock(table,body,old);
      const canonical=blocks.canonical(table,table==='lahan_harian'?{...body,hasil_input_ha:body.hasil_ha}:body);
      let r = clean(table,canonical);
      if(canonical.block_id&&canonical.block_id!==old.block_id){r.block_id=canonical.block_id;r.block_name_snapshot=canonical.block_name_snapshot;r.block_refs_snapshot=canonical.block_refs_snapshot;}
      if (TABLES[table].lengkapi && old) { const L = clean(table, TABLES[table].lengkapi({ ...old, ...r }, old)); for (const [k, v] of Object.entries(L)) if (k in r || (v ?? null) !== (old[k] ?? null)) r[k] = v; } // hanya kolom yang diubah / terisi otomatis
      const cols = Object.keys(r);
      let related = 0;
      if(old && ['lahan_blok','pisang_blok','padi_petak'].includes(table) && TABLES[table].display && body[TABLES[table].display] && body[TABLES[table].display]!==old[TABLES[table].display]) return send(res,409,{error:'Ubah nama blok melalui revisi GIS agar ID dan seluruh riwayat tetap terhubung.'});
      tx(() => {
        if (cols.length) db.prepare(`UPDATE ${q(table)} SET updated_at=?${cols.map((c) => `, ${q(c)}=?`).join('')} WHERE id=?`).run(now(), ...cols.map((c) => r[c]), id);
        // nama induk berubah â†’ ikut ganti di semua data yang merujuk (mis. nama blok di panen/progres)
        const nu = db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(id);
        if (old && nu && TABLES[table].display) {
          const a = displayOf(table, old), b = displayOf(table, nu);
          if (a && b && a !== b) related = cascadeRename(table, a, b);
        }
      });
      if(table==='lahan_harian')capLandRows(db,now);
      log('ubah', table, id, table === 'gis_layer' ? { layer: r.nama || old?.nama, diubah: Object.keys(r).map((k) => ({ geojson: 'isi peta / atribut / catatan', gaya: 'tampilan', tampil: 'tampil/sembunyi' }[k] || k)).join(', ') } : { ...r, ...(related ? { data_terkait_diperbarui: related } : {}) });
      if (old && BLOK_T[table]) {
        const nu = db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(id);
        if (table !== 'gis_layer') catatBlok(table, [old], [nu]);
        else if ('geojson' in r && layerBlok(nu)) catatBlok('gis_layer', fiturBlok(old.geojson), fiturBlok(nu.geojson), { layer: nu.nama }); // peta Blok Tanam diganti
      }
      blocks.linkTable(table);
      return send(res, 200, { ...(db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(id) || {}), _related: related });
    }
    if (m === 'DELETE' && id && ['lahan_blok','pisang_blok','padi_petak','gis_layer'].includes(table)) return send(res,409,{error:'Data induk blok/peta dipertahankan. Nonaktifkan blok melalui revisi GIS.'});
    if (m === 'DELETE' && id) {
      const old = db.prepare(`SELECT * FROM ${q(table)} WHERE id=?`).get(id);
      const refs = old ? childRefs(table, old) : [];
      const cascade = url.searchParams.get('cascade') === '1';
      if (refs.length && !cascade) return send(res, 409, { error: 'Ada data lain yang terhubung', refs });
      const related = tx(() => { const d = cascade && old ? deleteChildren(table, old) : 0; db.prepare(`DELETE FROM ${q(table)} WHERE id=?`).run(id); return d; });
      if (old && table === 'gis_layer') delete old.geojson;
      log('hapus', table, id, { ...old, ...(related ? { data_terkait_ikut_dihapus: related } : {}) });
      if (old && BLOK_T[table] && table !== 'gis_layer') catatBlok(table, [old], []);
      return send(res, 200, { ok: true, related });
    }
  }
  if (parts[1] === 'log' && m === 'GET') {
    if(!isAdmin(user))return send(res,403,{error:'Riwayat rincian input khusus admin.'});
    const lim = Math.min(2000, Number(url.searchParams.get('limit')) || 300);
    return send(res, 200, db.prepare('SELECT * FROM _log ORDER BY id DESC LIMIT ?').all(lim));
  }
  if (parts[1] === 'settings') {
    if (m === 'GET') return send(res, 200, isAdmin(user)?Object.fromEntries(db.prepare('SELECT k, v FROM _settings').all().map((r) => [r.k, r.v])):{nama:db.prepare("SELECT v FROM _settings WHERE k='nama'").get()?.v||'PT VIGU FARM INDONESIA'});
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
    if (m === 'POST') return VERCEL ? send(res, 400, { error: 'Versi online tidak menyimpan file backup â€” pakai "Download backup database".' }) : send(res, 200, { file: path.basename(backup('manual')) });
    if (m === 'GET') {
      // salinan database siap pakai (tidak dikompres), langsung dikirim lalu dihapus dari server
      const file = path.join(DATA_DIR, `kebun_download_${Date.now()}.db`);
      raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const buf = fs.readFileSync(file); fs.unlink(file, () => {});
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="kebun_${new Date().toISOString().slice(0, 10)}.db"`, 'Content-Length': buf.length });
      return res.end(buf);
    }
  }
  // pulihkan / pindahkan database: unggah file .db (boleh dikompres .gz) â†’ seluruh isi diganti
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
// File Excel di folder aplikasi = jalur input. Disimpan â†’ otomatis dibaca & database disamakan dengan isinya.
// Data diubah lewat aplikasi â†’ file Excel ditulis ulang (kalau sedang tidak dibuka di Excel).
const EXCEL_FILE = process.env.EXCEL_FILE || path.join(process.env.DATA_DIR ? DATA_DIR : ROOT, 'Input Data Kebun.xlsx');
const EXCEL_TABLES = new Set(EXCEL_SHEETS.map((s) => s.table));
const xl = { lastWriteMtime: 0, stale: false, staleSince: null, lastReport: null, timer: null, busy: false };
const sortRows = (table, rows) => {
  // di Excel: tabel bertanggal diurut lama â†’ baru (input baru ditulis di bawah); lainnya ikut urutan tabel
  const T = TABLES[table];
  const s = T.date || T.sort || 'id', desc = !T.date && s.startsWith('-'), k = s.replace(/^-/, '');
  return [...rows].sort((a, b) => { const c = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'id', { numeric: true }); return (desc ? -c : c) || a.id - b.id; });
};
const rowsOf = (t) => sortRows(t,visibleActivityRows(db.prepare(`SELECT * FROM ${q(t)}`).all()));
const getSetting = (k) => db.prepare('SELECT v FROM _settings WHERE k=?').get(k)?.v;
// ---- Excel per halaman
const editableExcelTables = user => [...EXCEL_TABLES].filter(t=>canEdit(user,t));
function panelOf(url) {
  const tl = url.searchParams.get('tables'); if (!tl) return null;
  const tables = tl.split(',').filter((t) => EXCEL_TABLES.has(t));
  const kom = ['Pisang', 'Padi'].includes(url.searchParams.get('kom')) ? url.searchParams.get('kom') : null;
  return { tables, kom, label: String(url.searchParams.get('panel') || tables.map((t) => TABLES[t].title).join(', ')).slice(0, 60) };
}
// tabel progres tanam dipakai bersama pisang & padi â†’ di halaman satu komoditas hanya barisnya yang diambil/diganti
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
  const scoped = (t) => { const f = panel && scopeOf(t, panel.kom); const rows = inputRows(t,rowsOf(t)).map(r=>{const field=({pisang_blok:'nama_blok',padi_petak:'nama_petak',lahan_blok:'blok'})[t],b=field&&blocks.find(r[field]);return b?{...r,luas_ha:b.luas_ha,...(t==='lahan_blok'?{kepemilikan:b.ownership,peruntukan:b.divisi,target_tanam:rowsOf('lahan_target').find(x=>util.key(x.blok)===util.key(b.nama))?.bulan||r.target_tanam}:{} )}:r;}); return f ? rows.filter(f) : rows; };
  const refNames = (t) => (TABLES[t]?.display ? db.prepare(`SELECT * FROM ${q(t)}`).all().filter(r=>!hiddenActivity(r.aktivitas)).map((r) => displayOf(t, r)) : []);
  return buildWorkbook({ TABLES, SHEETS, rowsOf: scoped, nama: getSetting('nama') || 'PT VIGU FARM INDONESIA', panel: panel?.label, refNames }).then(wb=>{
    const data=inputSummary({tables:SHEETS.map(s=>s.table),rowsOf:scoped,TABLES,today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date())});
    const ws=wb.addWorksheet('Ringkasan Input',{views:[{state:'frozen',ySplit:1}]});
    ws.addRow(['Data','Periode','Baris','SJ unik (tanggal + no.)','Nilai baris (Rp)','Box','Berat (kg)']);
    for(const t of data.tables)for(const p of [...t.periods,...t.months.map(m=>({...m,label:m.month}))])ws.addRow([t.title,p.label,p.rows,t.sales?p.documents:null,t.sales?p.amount:null,t.table==='pisang_penjualan'?p.box:null,t.sales?p.kg:null]);
    ws.columns.forEach((c,i)=>{c.width=i===0?32:i===1?20:20;if(i>=2)c.numFmt=i<=3?'#,##0':'#,##0.00';});ws.getRow(1).font={bold:true};return wb;
  });
};
const excelLocked = () => fs.existsSync(path.join(path.dirname(EXCEL_FILE), '~$' + path.basename(EXCEL_FILE)));
function excelStatus() {
  const laporan = xl.lastReport || JSON.parse(getSetting('excel_laporan') || 'null');
  if (VERCEL) return { online: true, ada: false, laporan }; // online: tidak ada file Excel di server â€” pakai download & upload
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
//  â€¢ beda tulisan saja (mis. "land clearing", "LandClearing") â†’ dibetulkan otomatis ke nama di daftar;
//  â€¢ aktivitas yang tidak ada di daftar â†’ KESALAHAN (sheet ditahan) karena barisnya tidak akan terhitung di progres;
//  â€¢ nama lain yang tidak ada di daftar (mis. blok baru) â†’ peringatan saja, data tetap masuk.
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
        if (hit != null) { if (hit !== String(v)) { const kk = `${f.l} "${v}" â†’ "${hit}"`; kor.set(kk, [...(kor.get(kk) || []), r.__baris]); r[f.k] = hit; } }
        else if (f.ref === 'lahan_aktivitas') p.errors.push({ row: r.__baris, msg: `${f.l} "${v}" tidak ada di daftar ${TABLES[f.ref].title} (cek ejaan) â€” kalau dibiarkan tidak akan terhitung di progres` });
        else { const kk = `${f.l} "${v}" tidak ada di ${TABLES[f.ref].title}`; asing.set(kk, [...(asing.get(kk) || []), r.__baris]); }
      }
    }
    const fmt = (m) => [...m].map(([k, b]) => `${k} (${b.length} baris: ${b.slice(0, 6).join(', ')}${b.length > 6 ? ', â€¦' : ''})`).slice(0, 20);
    p.koreksi = fmt(kor); p.peringatan = fmt(asing);
    if (p.otomatis) p.koreksi.unshift(`${p.otomatis} baris: kolom kosong diisi otomatis dari Jenis Barang / Bentuk-Kelas-Kondisi`);
  }
}
async function syncExcel(buf, {preview=false,oleh='Excel',sumber='file',panel=null}={}) {
  const parsed=await parseWorkbook(buf,{TABLES,SHEETS:panel?EXCEL_SHEETS.filter(s=>panel.tables.includes(s.table)):EXCEL_SHEETS});
  cekNamaInduk(parsed);
  const rep={waktu:now(),sumber,preview,oleh,panel:panel?.label||null,sheets:[],backup:null,peringatan:['Mode aman: baris yang hilang dari file tetap disimpan. Gunakan ID dan versi baris untuk merevisi data lama.']},todo=[];
  for(const p of parsed) {
    const t=p.cfg.table,all=db.prepare('SELECT * FROM '+q(t)).all(),scope=panel?scopeOf(t,panel.kom):null,cur=scope?all.filter(scope):all;
    const s={sheet:p.cfg.sheet,tabel:TABLES[t].title,baris:p.rows.length,sebelum:cur.length,tambah:0,ubah:0,hapus:0,changes:[],status:'tidak berubah',koreksi:p.koreksi||[],peringatan:p.peringatan||[],errors:p.errors.slice(0,30),jumlahError:p.errors.length,layoutBeda:!!p.layoutBeda};rep.sheets.push(s);
    if(!p.found){s.status='sheet tidak ada â€” dilewati';continue;}
    if(referenceSheets.has(t)){s.status='referensi otomatis â€” tidak diinput ulang';s.errors=[];s.jumlahError=0;continue;}
    if(p.kosong){s.status='permintaan kosong diabaikan â€” data lama dipertahankan';continue;}
    const ops=[],seenIds=new Set(),existing=new Map();
    for(const row of cur){const sigKey=sig(t,p.cfg,row);existing.set(sigKey,(existing.get(sigKey)||0)+1);}
    for(const input of p.rows) {
      if(hiddenActivity(input.aktivitas)){s.peringatan.push('Baris '+input.__baris+': kegiatan tidak digunakan untuk input admin; data lama tetap disimpan.');continue;}
      const id=Number(input._record_id)||null,previous=id?cur.find(x=>x.id===id):null;
      if(t==='lahan_harian'&&previous?.daily_report_id){s.peringatan.push('Baris '+input.__baris+': mengikuti Daily Report; revisi melalui Daily, tidak diinput ulang.');continue;}
      let row;try{row=blocks.canonical(t,prepareExcelInput(t,input,previous,{findBlock:blocks.find,targets:rowsOf('lahan_target')}));validateOperationalBlock(t,row,previous);}catch(e){s.errors.push({row:input.__baris,msg:e.message});continue;}
      const cleaned=clean(t,TABLES[t].lengkapi?TABLES[t].lengkapi(row,previous):row);
      if(row.block_id){cleaned.block_id=row.block_id;cleaned.block_name_snapshot=row.block_name_snapshot;}
      if(row.block_refs_snapshot)cleaned.block_refs_snapshot=previous?.block_id===row.block_id?previous.block_refs_snapshot||row.block_refs_snapshot:row.block_refs_snapshot;
      if(id) {
        const old=cur.find(x=>x.id===id);
        if(!old||seenIds.has(id)){s.errors.push({row:input.__baris,msg:'ID baris tidak ditemukan dalam halaman ini atau digunakan dua kali.'});continue;}seenIds.add(id);
        if(input._row_updated_at && input._row_updated_at!==old.updated_at){s.errors.push({row:input.__baris,msg:'Data sudah berubah sejak file diunduh. Download ulang agar perubahan terbaru tidak tertimpa.'});continue;}
        if(!input._row_updated_at){s.errors.push({row:input.__baris,msg:'Versi baris wajib untuk merevisi data lama. Download template terbaru.'});continue;}
        const masterField=({lahan_blok:'blok',pisang_blok:'nama_blok',padi_petak:'nama_petak'})[t];
        if(masterField&&cleaned[masterField]!==old[masterField]){s.errors.push({row:input.__baris,msg:'Ubah nama blok melalui GIS.'});continue;}
        if(Object.entries(cleaned).some(([k,v])=>!samaNilai(v,old[k]))) {ops.push({id,old,row:cleaned});s.ubah++;for(const f of sheetFields(TABLES,p.cfg)){if(!f.k.startsWith('_')&&!samaNilai(cleaned[f.k],old[f.k])&&s.changes.length<100)s.changes.push({row:input.__baris,field:f.l,before:old[f.k]??null,after:cleaned[f.k]??null});}}
      } else {
        const sigKey=sig(t,p.cfg,row);if(existing.get(sigKey)){existing.set(sigKey,existing.get(sigKey)-1);continue;}
        const display=TABLES[t].display;
        if(typeof display==='string' && cur.some(x=>util.key(x[display])===util.key(cleaned[display]))){s.errors.push({row:input.__baris,msg:'Data induk sudah ada. Download ulang dan gunakan ID baris untuk merevisi.'});continue;}
        ops.push({row:cleaned});s.tambah++;
      }
    }
    if(t==='lahan_harian'&&ops.length&&!s.errors.length)try{s.peringatan.push(...capExcelLandChanges(ops,all,blocks.find));}catch(e){s.errors.push({row:0,msg:e.message});}
    s.jumlahError=s.errors.length;
    if(s.jumlahError){s.status='ada kesalahan â€” tidak diproses';s.tambah=s.ubah=0;continue;}
    if(ops.length){s.status=preview?'akan diperbarui':'diperbarui';todo.push({t,ops});}
  }
  if(!preview&&todo.length) {
    rep.backup=path.basename(backup('excel')||'')||null;
    const oldUser=currentUser;currentUser={nama:oleh};
    try{tx(()=>{for(const {t,ops} of todo){for(const op of ops){
      if(op.id){const cols=Object.keys(op.row);db.prepare('INSERT INTO _import_revisions (table_name,row_id,before_json,created_at) VALUES (?,?,?,?)').run(t,op.id,JSON.stringify(op.old),now());db.prepare('UPDATE '+q(t)+' SET updated_at=?'+cols.map(k=>', '+q(k)+'=?').join('')+' WHERE id=?').run(now(),...cols.map(k=>op.row[k]),op.id);}
      else insertRow(t,op.row,false);
    }blocks.linkTable(t);log('sinkron Excel aman',t,null,{jumlah:ops.length,sumber});}});}finally{currentUser=oldUser;}
  }
  if(!preview){xl.lastReport=rep;db.prepare('INSERT INTO _settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('excel_laporan',JSON.stringify(rep));}
  return rep;
}
// pantau file Excel: setiap disimpan â†’ sinkron otomatis
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
    // format kolom di file sudah lama (ada kolom yang dihapus/ditambah) â†’ tulis ulang file dengan format terbaru
    if (rep.sheets.some((s) => s.layoutBeda) && !rep.sheets.some((s) => s.jumlahError)) scheduleExcelWrite(1500);
  } catch (e) { console.warn('Sinkron Excel gagal:', e.message); xl.lastReport = { waktu: now(), gagal: e.message, sheets: [] }; }
  finally { xl.busy = false; }
}
let watchTimer = null;
if (!VERCEL) fs.watchFile(EXCEL_FILE, { interval: 2000 }, (cur, prev) => {
  if (!cur.mtimeMs || cur.mtimeMs === prev.mtimeMs) return;
  clearTimeout(watchTimer); watchTimer = setTimeout(onExcelChanged, 2500);
});
// komputer lokal yang memakai database online: cek perubahan dari online tiap menit â†’ file Excel ikut diperbarui
if (cloud && !VERCEL) setInterval(() => serial(async () => { if (await syncCloud()) scheduleExcelWrite(1000); }).catch((e) => console.warn('Cek database online gagal:', e.message)), 60e3).unref();
if (VERCEL) { /* online: tanpa file Excel */ }
else if (!fs.existsSync(EXCEL_FILE)) writeExcelFile().then((ok) => ok && console.log('  File Excel input dibuat:', EXCEL_FILE)).catch((e) => console.warn('Buat Excel gagal:', e.message));
else {
  // saat start: mana yang lebih baru â€” data di aplikasi atau file Excel?
  const fileTime = fs.statSync(EXCEL_FILE).mtime.toISOString();
  const dbTime = [...EXCEL_TABLES].map((t) => db.prepare(`SELECT MAX(updated_at) u FROM ${q(t)}`).get().u || '').sort().pop() || '';
  const last = JSON.parse(getSetting('excel_laporan') || 'null')?.waktu || '';
  if (dbTime > fileTime && dbTime > last) writeExcelFile().catch(() => {});            // aplikasi lebih baru â†’ perbarui file (atau tunggu sampai file ditutup)
  else if (fileTime > last) setTimeout(onExcelChanged, 1500);                          // file diubah saat server mati â†’ baca file
}

// mode online: respons ditahan sampai perubahan benar-benar tersimpan di database online
function holdResponse(res) {
  const wh = res.writeHead, end = res.end; let a = null, b = null;
  res.writeHead = (...x) => { a = x; return res; };
  res.end = (...x) => { b = x; return res; };
  const restore = () => { res.writeHead = wh; res.end = end; };
  return { release() { restore(); if (a) res.writeHead(...a); if (b) res.end(...b); }, discard() { restore(); res.removeHeader('Set-Cookie'); } };
}
function readScope(req,url){
  if(!VERCEL)return null;
  const p=url.pathname;
  const gisTables=['_blocks','gis_layer','_gis_block_versions','_gis_plantings','_gis_planting_revisions','_gis_reference_tokens','_gis_commodities'];
  if(p==='/api/excel/summary')return [...authTables,...editableExcelTables(sessionUser(req))];
  if(p==='/api/gis-service')return authTables;
  if(p==='/api/gis-reference')return [...authTables,...gisTables];
  if(p.startsWith('/api/gis-registry'))return [...authTables,...gisTables,'pisang_blok','padi_tanam','_log'];

  if((req.method==='POST'&&['/api/login','/api/logout'].includes(p))||(req.method==='GET'&&['/api/me','/api/settings','/api/excel/status','/api/backups'].includes(p)))return authTables;
  if(req.method==='POST'&&p==='/api/daily')return [...authTables,'_gis_block_versions','_gis_plantings','lahan_blok','lahan_harian','lahan_aktivitas','lahan_target','lahan_rencana','pisang_blok','gis_layer','_blocks','_block_links','_log','_daily_revisions','_land_daily_covered','_land_schedule_revisions','_land_week_plan_snapshots','daily_report','daily_item','daily_photo','daily_week_plan','daily_week_item','_daily_submissions'];
  if(req.method!=='GET')return null;
  const land=['lahan_blok','lahan_harian','lahan_aktivitas','lahan_target','lahan_rencana','pisang_blok'];
  if(p==='/api/tables')return authTables;
  const raw=p.match(/^\/api\/t\/([a-z_]+)$/);if(raw&&TABLES[raw[1]])return req.method==='GET'?[...authTables,raw[1]]:null;
  const page=p.match(/^\/api\/records\/([a-z_]+)$/);if(page&&TABLES[page[1]]){const dependencies={pisang_blok:['pisang_panen_pkk'],padi_tanam:['padi_panen'],padi_panen:['padi_petak'],infra_proyek:['infra_progress'],lahan_blok:['lahan_harian','lahan_aktivitas']};return [...authTables,page[1],...(dependencies[page[1]]||[])];}
  if(p==='/api/padi-summary')return [...authTables,'_gis_plantings','padi_petak','padi_tanam','padi_panen','padi_giling','padi_benih','_blocks','gis_layer'];
  if(p==='/api/nursery-summary')return [...authTables,'pisang_bibit'];
  if(/^\/api\/blocks\/[^/]+\/history$/.test(p))return [...authTables,'_blocks','_block_links',...Object.keys(TABLES).filter(t=>!['gis_layer','daily_photo','iklim'].includes(t))];
  if(p==='/api/blocks')return [...authTables,'_blocks','gis_layer'];
  if(p==='/api/summary-periods')return authTables;
  if(p==='/api/kebun-plan')return [...authTables,'_gis_plantings',...land,'pisang_bibit','pisang_box','pisang_estimasi','_blocks','gis_layer','_land_week_plan_snapshots'];
  if(p==='/api/kebun-plan/map')return [...authTables,'_blocks','gis_layer'];
  if(p==='/api/overview')return authTables;
  if(p==='/api/kebun-summary')return [...authTables,'_gis_plantings',...land,'_blocks','gis_layer','_land_week_plan_snapshots'];
  if(p==='/api/kebun')return [...authTables,...land];
  if(/^\/api\/daily\/public\/photo\/\d+$/.test(p))return [...authTables,'daily_photo','daily_report'];
  if(p==='/api/daily/hk-summary')return [...authTables,'daily_report','daily_item'];
  if(p==='/api/daily/public')return [...authTables,...land,'daily_report','daily_item','daily_photo','daily_week_plan','daily_week_item','_land_week_plan_snapshots'];
  if(p==='/api/daily')return [...authTables,...land,'daily_report','daily_item','daily_photo','daily_week_plan','daily_week_item','_land_week_plan_snapshots'];
  if(p==='/api/daily/plans')return [...authTables,'daily_week_plan','daily_week_item','_land_week_plan_snapshots'];
  if(p.startsWith('/api/gis/layers'))return [...authTables,'gis_layer'];
  if(p==='/api/daily/locations')return [...authTables,'_blocks','gis_layer'];
  if(/^\/api\/daily\/photo\/\d+$/.test(p))return [...authTables,'daily_photo','daily_report'];
  return null;
}
async function apiRequest(req, res, url) {
  if (!cloud) return api(req, res, url);
  return serial(async () => {
    const adminRead=/^\/api\/(?:t|tables|records|excel|blocks|gis|kebun|land-prep|padi|nursery-summary|backup|backups|users|log)(?:\/|$)/.test(url.pathname)&&url.pathname!=='/api/excel/status';
    const loginRead=/^\/api\/(?:reports|daily)(?:\/|$)/.test(url.pathname)&&url.pathname!=='/api/daily/cleanup'&&!isPublicDailyRead(url.pathname,req.method);
    if(VERCEL&&(adminRead||loginRead)){await syncCloud(null,authTables);const reader=sessionUser(req);if(!reader)return send(res,401,{error:'Silakan login. Ringkasan tetap tersedia.'});if(adminRead&&!isAdmin(reader)&&!(url.pathname.startsWith('/api/excel/')&&editableExcelTables(reader).length))return send(res,403,{error:'Rincian input hanya dapat dilihat admin. Ringkasan tetap tersedia.'});}
    const photoReportId=VERCEL && req.method==='POST' && /^\/api\/daily\/photo(?:\/\d+\/thumbnail)?$/.test(url.pathname) ? Number(url.searchParams.get('report'))||null : null;
    if (await syncCloud(photoReportId,readScope(req,url)) && !VERCEL) scheduleExcelWrite(1000);
    const hold = holdResponse(res);
    try { await api(req, res, url); await flush(); hold.release(); }
    catch (e) {
      hold.discard(); txMark = -1;
      if (pend.length) { pend.length = 0; await loadCloud(); } // perubahan setengah jalan dibatalkan â†’ samakan lagi dengan isi online
      if (!e.conflict) throw e;
      send(res, 409, { error: 'Data baru saja diubah dari tempat lain. Muat ulang halaman lalu ulangi.' });
    }
  });
}

// Vercel menjalankan server.js sebagai satu fungsi (export default di bawah); isi public/ dilayani CDN Vercel.
// Halaman utama dibaca dengan alamat tetap supaya ikut terbawa dalam paket fungsi.
const INDEX_HTML = VERCEL ? fs.readFileSync(new URL('./public/index.html', import.meta.url)) : null;
const KEBUN_HTML = VERCEL ? fs.readFileSync(new URL('./public/kebun.html', import.meta.url)) : null; // halaman Tim Kebun (/kebun)

async function handler(req, res) {
  dailyTargetCache=new Map();
  const url = new URL(req.url, 'http://x');
  try {
    if (VERCEL && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/daily' || url.pathname === '/daily/')) return send(res, 200, INDEX_HTML, MIME['.html'], { 'Cache-Control': 'no-cache' });
    if (!VERCEL && (url.pathname === '/daily' || url.pathname === '/daily/')) return serveFile(res, path.join(ROOT, 'public', 'index.html'));
    if (url.pathname === '/kebun' || url.pathname === '/kebun/') return VERCEL ? send(res, 200, KEBUN_HTML, MIME['.html'], { 'Cache-Control': 'no-cache' }) : serveFile(res, path.join(ROOT, 'public', 'kebun.html'));
    if (BELUM_ONLINE && url.pathname.startsWith('/api/')) return send(res, 503, { error: 'Penyimpanan online belum disambungkan. Admin perlu mengatur penyimpanan GitHub atau database online pada proyek Vercel.' });
    if (url.pathname.startsWith('/api/')) {
      await apiRequest(req, res, url);
      // perubahan lewat aplikasi â†’ samakan file Excel
      const t = url.pathname.split('/')[3];
      if (req.method !== 'GET' && url.pathname.startsWith('/api/t/') && res.statusCode < 300 && EXCEL_TABLES.has(t)) scheduleExcelWrite();
      return;
    }
    const rel = /^\/peta\/?$/.test(url.pathname) ? 'peta.html' : url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const f = safeJoin(path.join(ROOT, 'public'), rel);
    return f ? serveFile(res, f) : send(res, 403, 'Forbidden', 'text/plain');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  }
}

if (!VERCEL) http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log('\n  Monitoring Kebun berjalan:');
  console.log(`   Komputer ini : http://localhost:${PORT}`);
  for (const ifs of Object.values(os.networkInterfaces())) for (const i of ifs || [])
    if (i.family === 'IPv4' && !i.internal) console.log(`   Jaringan/HP  : http://${i.address}:${PORT}`);
  console.log(`   Database     : ${cloud ? 'ONLINE ('+(GITHUB_DATA?'GitHub':'Turso')+') â€” data sama dengan versi internet' : DB_FILE}\n   Excel input  : ${EXCEL_FILE}\n   Tutup jendela ini untuk menghentikan server.\n`);
});

// Saat lokal tidak ada Vercel Cron; bersihkan saat start dan setiap 24 jam.
if (!VERCEL) {
  cleanupDailyPhotos().catch((e) => console.warn('Pembersihan foto gagal:', e.message));
  setInterval(() => cleanupDailyPhotos().catch((e) => console.warn('Pembersihan foto gagal:', e.message)), 60 * 60e3).unref();
}

return handler;
}
let application;
export default async function serve(req,res){
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(process.env.VERCEL&&['/','/index.html','/daily','/daily/'].includes(pathname)){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
    return res.end(fs.readFileSync(new URL('./public/index.html',import.meta.url)));
  }
  if(process.env.VERCEL&&/^\/peta\/?$/.test(pathname)&&process.env.GIS_EDITOR_URL){res.writeHead(302,{Location:process.env.GIS_EDITOR_URL});return res.end();}
  if(process.env.VERCEL&&/^\/peta\/?$/.test(pathname)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(new URL('./public/peta.html',import.meta.url)));}
  if(process.env.VERCEL&&(pathname==='/kebun'||pathname==='/kebun/')){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
    return res.end(fs.readFileSync(new URL('./public/kebun.html',import.meta.url)));
  }
  try{
    application ||= createApplication().catch(error=>{application=null;throw error;});
    return (await application)(req,res);
  }catch(error){
    console.error('Inisialisasi aplikasi gagal:',error.message);
    if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'Koneksi data belum siap. Silakan muat ulang. '+error.message}));}
  }
}
if(!process.env.VERCEL)application=createApplication();
