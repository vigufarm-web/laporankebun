const base = process.env.TEST_BASE || 'http://127.0.0.1:3188';
if (process.env.TEST_STANDALONE === '1') {
  await import('../server.js');
  await new Promise((resolve) => setTimeout(resolve, 600));
}

async function request(path, options = {}, cookie = '') {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(data)}`);
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}

const setup = await request('/api/setup', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin-test', nama: 'Admin Test', password: 'test1234' }),
});
const cookie = setup.cookie;

const { data: plan } = await request('/api/daily/plans', {
  method: 'POST',
  body: JSON.stringify({
    week_start: '2026-10-28', // server harus menormalkan ke Senin
    divisi: 'Pisang', status: 'Dikirim',
    items: [
      { blok: 'A01', aktivitas: 'Uji target mingguan', target: 10, satuan: 'ha', hk_rencana: 4 },
      { blok: 'A01', aktivitas: 'Pemupukan urea', target: 500, satuan: 'pokok', hk_rencana: 3 },
    ],
  }),
}, cookie);
if (plan.week_start !== '2026-10-26' || plan.week_end !== '2026-11-01' || plan.items.length !== 2) {
  throw new Error(`Normalisasi rencana gagal: ${JSON.stringify(plan)}`);
}

for (const [tanggal, realisasi, extra] of [
  ['2026-10-26', 2, false],
  ['2026-10-27', 3, false],
]) {
  await request('/api/daily', {
    method: 'POST',
    body: JSON.stringify({
      tanggal,
      divisi: 'Pisang',
      status: 'Selesai',
      items: [
        { plan_item_id: plan.items[0].id, di_luar_rencana: extra ? 1 : 0, aktivitas: 'Uji target mingguan', blok: 'A01', realisasi, satuan: 'ha' },
        ...(tanggal === '2026-10-27' ? [{ di_luar_rencana: 1, aktivitas: 'Pekerjaan mendadak', blok: 'A02', realisasi: 1, satuan: 'ha' }] : []),
      ],
    }),
  }, cookie);
}

const { data: reports } = await request('/api/daily?from=2026-10-26&to=2026-10-27&divisi=Pisang', {}, cookie);
const proof = reports
  .sort((a, b) => a.tanggal.localeCompare(b.tanggal))
  .map((report) => ({
    tanggal: report.tanggal,
    penginput: report.dibuat_oleh,
    mandor: report.mandor,
    target: report.items[0]?.target,
    hi: report.items[0]?.realisasi,
    sdhi: report.items[0]?.hasil_sdhi,
    tambahan: report.items[0]?.di_luar_rencana,
  }));

const expected = [
  { tanggal: '2026-10-26', penginput: 'Admin Test', mandor: null, target: 10, hi: 2, sdhi: 2, tambahan: 0 },
  { tanggal: '2026-10-27', penginput: 'Admin Test', mandor: null, target: 10, hi: 3, sdhi: 5, tambahan: 0 },
];
if (JSON.stringify(proof) !== JSON.stringify(expected)) {
  throw new Error(`Hasil tidak sesuai: ${JSON.stringify(proof)}`);
}
const extraItem = reports.find((r) => r.tanggal === '2026-10-27')?.items.find((x) => x.aktivitas === 'Pekerjaan mendadak');
if (!extraItem || extraItem.di_luar_rencana !== 1 || extraItem.target != null) throw new Error(`Pekerjaan tambahan gagal: ${JSON.stringify(extraItem)}`);
console.log(JSON.stringify({ ok: true, proof }, null, 2));
if (process.env.TEST_STANDALONE === '1') process.exit(0);
