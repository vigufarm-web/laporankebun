// Klien kecil database online Turso (libSQL) lewat HTTP — tanpa paket tambahan.
// Dipakai bila aplikasi berjalan online (mis. Vercel) atau saat komputer lokal disambungkan ke database online.
const enc = (v) => {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'bigint') return { type: 'integer', value: String(v) };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  if (v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
  return { type: 'text', value: String(v) };
};
const dec = (c) => (c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.type === 'blob' ? Buffer.from(c.base64, 'base64') : c.value);
const stmt = (s) => (typeof s === 'string' ? { sql: s } : { sql: s.sql, args: (s.args || []).map(enc) });

// Alamat & token database dari variabel lingkungan. Integrasi Vercel bisa memberi awalan (prefix) apa saja,
// mis. STORAGE_URL + STORAGE_AUTH_TOKEN — jadi cari variabel berisi alamat libsql:// lalu token dengan awalan yang sama.
export function onlineConfig(env) {
  if (env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN) return { url: env.TURSO_DATABASE_URL, token: env.TURSO_AUTH_TOKEN };
  const isDb = (v) => /^libsql:\/\//.test(v || '') || /^https:\/\/[^/]+\.turso\.io/.test(v || '');
  for (const k of Object.keys(env).filter((k) => isDb(env[k])).sort()) {
    const pre = k.replace(/(_DATABASE)?_URL$/i, '');
    const tk = Object.keys(env).filter((x) => x !== k && x.startsWith(pre) && /TOKEN/i.test(x) && env[x]).sort((a, b) => /AUTH/i.test(b) - /AUTH/i.test(a))[0];
    if (tk) return { url: env[k], token: env[tk] };
  }
  return null;
}

export function turso(url, token) {
  const base = String(url).trim().replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
  async function pipeline(requests) {
    const r = await fetch(base + '/v2/pipeline', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baton: null, requests: [...requests, { type: 'close' }] }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(`Database online menolak (${r.status}): ${j?.message || j?.error || r.statusText}`);
    return j.results.slice(0, requests.length).map((x) => {
      if (x.type === 'error') throw new Error('Database online: ' + (x.error?.message || 'kesalahan'));
      return x.response.result;
    });
  }
  // beberapa perintah baca → baris sebagai objek
  async function query(list) {
    const res = await pipeline(list.map((s) => ({ type: 'execute', stmt: stmt(s) })));
    return res.map((x) => x.rows.map((row) => Object.fromEntries(x.cols.map((c, i) => [c.name, dec(row[i])]))));
  }
  // banyak perintah tulis sebagai satu transaksi: semua berhasil atau tidak sama sekali
  async function batch(list) {
    const steps = [{ stmt: { sql: 'BEGIN' } }];
    for (const s of list) steps.push({ stmt: stmt(s), condition: { type: 'ok', step: steps.length - 1 } });
    const commit = steps.length;
    steps.push({ stmt: { sql: 'COMMIT' }, condition: { type: 'ok', step: commit - 1 } });
    steps.push({ stmt: { sql: 'ROLLBACK' }, condition: { type: 'not', cond: { type: 'ok', step: commit } } });
    const [res] = await pipeline([{ type: 'batch', batch: { steps } }]);
    if (!res.step_results[commit]) {
      const e = res.step_errors.find(Boolean);
      const err = new Error('Database online: ' + (e?.message || 'transaksi gagal'));
      err.conflict = /UNIQUE constraint failed: _ver/.test(e?.message || '');
      throw err;
    }
    return res.step_results.slice(1, commit);
  }
  return { query, batch };
}
