// Halaman GIS & Peta: layer dari shapefile/GeoJSON, pewarnaan per kolom atau per data divisi,
// klik blok -> lihat/ubah data divisi & atribut peta, titik lokasi.
import { TABLES, util, displayOf, padiFase, lahanProgress } from './schema.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const n = util.n;
const HIDE_PROPS = /^(Handle|LyrOn|LyrHandle|LyrColor|Style|Height|TxtWidth|OBJECTID|Id|Shape_Leng|Shape_Area|ORIG_FID|BUFF_DIST)$/i;

// tabel induk yang bisa dihubungkan ke poligon berdasarkan nama
const MASTER = [
  { t: 'pisang_blok', k: 'nama_blok', label: 'Blok Pisang', luas: 'luas_ha' },
  { t: 'padi_petak', k: 'nama_petak', label: 'Petak Padi', luas: 'luas_ha' },
  { t: 'lahan_blok', k: 'blok', label: 'Blok Pembukaan Lahan', luas: 'luas_ha' },
];

const FIXED_COLORS = {
  'Sudah Tanam': '#16a34a', 'Sudah Panen': '#ca8a04', Perawatan: '#86efac', 'Olah Lahan': '#a16207', 'On Progress (Des)': '#f97316', 'Next Progress': '#93c5fd',
  Pisang: '#facc15', Padi: '#4ade80', Mangga: '#fb923c',
  'Sudah Bayar': '#16a34a', 'Lahan Lain': '#d1d5db', 'Bukan Lahan': '#9ca3af', 'Lahan Terpisah': '#a78bfa', 'Lahan Target1': '#f97316', 'Lahan Target2': '#fde047', 'Lahan Berubah': '#f472b6', 'Belum ST': '#ef4444',
  'Sudah dikerjakan': '#57534e', 'Belum dikerjakan': '#ef4444',
};
const PAL = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569', '#14b8a6', '#a855f7', '#84cc16', '#e11d48', '#0ea5e9', '#d97706'];
const NODATA = '#e5e7eb';

// pewarnaan berdasarkan data divisi
const DATA_THEMES = {
  serah_terima: { label: 'Serah terima lahan', persil: true, colors: { 'Sudah serah terima': '#16a34a', 'Belum serah terima': '#facc15' },
    value: (name, A, f) => serahTerima(f) },
  pisang_status: { label: 'Status blok pisang (data)', colors: { 'Belum Tanam': '#fde68a', TBM: '#a3e635', PC: '#22c55e', R1: '#16a34a', R2: '#15803d', R3: '#166534', R4: '#14532d', Bongkar: '#ef4444' },
    value: (name, A) => findRec(A, 'pisang_blok', name)?.status },
  pisang_umur: { label: 'Umur tanam pisang (data)', colors: { '< 3 bln': '#fef9c3', '3–6 bln': '#fde047', '6–9 bln': '#a3e635', '9–12 bln': '#22c55e', '12–18 bln': '#15803d', '> 18 bln': '#14532d' },
    value: (name, A) => { const r = findRec(A, 'pisang_blok', name); if (!r?.tanggal_tanam) return null; const m = util.daysSince(r.tanggal_tanam) / 30.44; return m < 3 ? '< 3 bln' : m < 6 ? '3–6 bln' : m < 9 ? '6–9 bln' : m < 12 ? '9–12 bln' : m < 18 ? '12–18 bln' : '> 18 bln'; } },
  padi_fase: { label: 'Fase padi (data)', colors: { 'Belum Tanam': '#cbd5e1', Persemaian: '#a16207', Vegetatif: '#4ade80', Generatif: '#facc15', Pemasakan: '#f59e0b', 'Siap Panen': '#dc2626', 'Sudah Panen': '#94a3b8' },
    value: (name, A) => { const r = latestTanam(A, name); return r ? padiFase(r, A.ctx) : null; } },
  lahan_progres: { label: 'Progres pembukaan lahan (data)', colors: null,
    value: (name, A) => { const r = findRec(A, 'lahan_blok', name); return r ? lahanProgress(r, A.ctx).last : null; } },
};
function findRec(A, t, name) { const k = util.key(name); const m = MASTER.find((x) => x.t === t); return k ? A.ctx.rows(t).find((r) => util.key(r[m.k]) === k) : null; }
function latestTanam(A, name) {
  const k = util.key(name);
  return A.ctx.rows('padi_tanam').filter((r) => util.key(r.petak) === k).sort((a, b) => String(b.tgl_tanam || b.tahun).localeCompare(String(a.tgl_tanam || a.tahun)))[0];
}
function lahanColors(A) {
  const acts = [...A.ctx.rows('lahan_aktivitas')].sort((a, b) => n(a.urutan) - n(b.urutan)).map((a) => a.aktivitas);
  const c = { '-': '#fecaca' };
  acts.forEach((a, i) => { const t = acts.length > 1 ? i / (acts.length - 1) : 1; c[a] = `hsl(${30 + t * 95}, 70%, ${55 - t * 18}%)`; });
  return c;
}

// luas geodesik (ha)
function ringArea(c) {
  const R = 6378137, rad = Math.PI / 180; let a = 0;
  for (let i = 0; i < c.length; i++) { const [x1, y1] = c[i], [x2, y2] = c[(i + 1) % c.length]; a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad)); }
  return Math.abs((a * R * R) / 2);
}
function areaHa(g) {
  if (!g) return 0;
  const poly = (p) => ringArea(p[0]) - p.slice(1).reduce((s, h) => s + ringArea(h), 0);
  if (g.type === 'Polygon') return poly(g.coordinates) / 1e4;
  if (g.type === 'MultiPolygon') return g.coordinates.reduce((s, p) => s + poly(p), 0) / 1e4;
  return 0;
}

// luas poligon (ha): Area_New (luas persil terbaru) > Shape_Area (luas dari ArcGIS) > hitung dari geometri.
// Kolom "Area" TIDAK dipakai: pada persil yang dipecah, nilainya masih luas persil induk (dobel hitung).
function luasHa(f) {
  const p = f.properties || {};
  if (Number(p.Area_New) > 0) return Number(p.Area_New) / 1e4;
  if (Number(p.Shape_Area) > 0) return Number(p.Shape_Area) / 1e4;
  return areaHa(f.geometry);
}
const sumberLuas = (L0) => (L0.props.Area_New ? 'Area_New' : L0.props.Shape_Area ? 'Shape_Area' : 'geometri');
const stripTahap = (v) => String(v).replace(/\s*\d+[A-Za-z]?$/, '').trim() || String(v);
// persil: hanya "sudah / belum serah terima" (status bayar tidak ditampilkan). Persil lama yang sudah dipecah tidak dihitung.
const ST_FIELD = 'Serah terima';
// sudah dibeli = Sudah Bayar / Lahan Terpisah (sudah serah terima) + Belum ST (sudah dibeli, belum serah terima). Lainnya = belum dibeli.
const ST_SUDAH = ['Sudah Bayar', 'Lahan Terpisah'];
const serahTerima = (f) => { const s = f.properties?.Status; return s === 'Lahan Berubah' ? null : ST_SUDAH.includes(s) ? 'Sudah serah terima' : s === 'Belum ST' ? 'Belum serah terima' : 'Belum dibeli'; };
const isPersil = (L0) => /persil/i.test(`${L0.rec.nama} ${L0.rec.jenis}`) && !!L0.props?.Status;
const PERSIL_HIDE = /^(Status|Status2|Area|Area_New|Layer|No)$/; // kolom status bayar & kolom teknis CAD tidak ditampilkan di popup persil
const gval = (f, k, merge) => { if (k === ST_FIELD) return serahTerima(f) || 'Tidak dihitung'; const v = String(f.properties?.[k] ?? '').trim(); return merge ? stripTahap(v) : v; };

export async function renderGIS(main, A) {
  await A.loadLib('leaflet');
  const { esc, fmtNum } = A;
  const RO = !A.can('gis_layer'); // tanpa izin GIS: tampilan saja, pengaturan tampilan tidak disimpan
  const putLayer = (id, body) => (RO ? Promise.resolve({}) : A.api.put(`/api/t/gis_layer/${id}`, body));
  main.innerHTML = `<div class="${RO ? 'ro-gis' : ''}">
    <div class="page-head">
      <div><div class="crumb">Divisi</div><h1>🗺️ GIS & Peta</h1><p class="desc">Klik poligon untuk melihat atribut peta, luas, dan data divisi yang terhubung (berdasarkan nama blok). Data divisi & atribut bisa diubah langsung dari sini.</p></div>
      <div class="actions">
        <input id="gSearch" list="gNames" placeholder="Cari blok / nama…" class="btn" style="width:190px;cursor:text"><datalist id="gNames"></datalist>
        <button class="btn ed" id="gPoint">📍 Tambah titik</button>
        <button class="btn primary ed" id="gAdd">＋ Tambah / perbarui layer</button>
      </div>
    </div>
    <div class="gis-wrap">
      <div class="gis-side">
        <h4>Peta dasar</h4>
        <select id="gBase" class="btn" style="width:100%"><option value="sat">Satelit (Esri)</option><option value="osm">Jalan (OpenStreetMap)</option><option value="none">Polos</option></select>
        <h4>Layer</h4><div id="gLayers"></div>
        <h4>Titik lokasi</h4><div id="gPoints"></div>
        <a class="small" href="#/t/gis_titik">Kelola tabel titik ↗</a>
      </div>
      <div style="position:relative"><div id="map"></div><div class="map-hint" id="gHint" hidden>Klik di peta untuk menaruh titik · Esc batal</div></div>
    </div>
    <div class="card" id="gSum" style="margin-top:14px"></div></div>`;

  const map = L.map('map', { zoomControl: true, maxZoom: 22 }).setView([-7.09, 109.08], 15);
  const bases = {
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 22, attribution: 'Esri World Imagery' }),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 22, attribution: '© OpenStreetMap' }),
    none: null,
  };
  let base = A.settings().basemap || 'sat';
  $('#gBase').value = base;
  const setBase = (b) => { Object.values(bases).forEach((l) => l && map.removeLayer(l)); bases[b]?.addTo(map); base = b; };
  setBase(base);
  $('#gBase').onchange = (e) => { setBase(e.target.value); A.saveSettings({ basemap: e.target.value }); };
  L.control.scale({ imperial: false }).addTo(map);
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => L.DomUtil.create('div', 'legend');
  legend.addTo(map);

  // ---------- data layer
  let layers = [];  // {rec, gj, gaya, lyr, labels, props}
  const pointsLyr = L.layerGroup().addTo(map);

  async function loadLayers() {
    const rows = await A.api.get('/api/t/gis_layer');
    layers.forEach((x) => { map.removeLayer(x.lyr); x.labels && map.removeLayer(x.labels); });
    layers = rows.sort((a, b) => n(a.urutan) - n(b.urutan)).map((rec) => {
      let gj = { type: 'FeatureCollection', features: [] };
      try { gj = JSON.parse(rec.geojson); } catch {}
      let gaya = {}; try { gaya = JSON.parse(rec.gaya || '{}'); } catch {}
      const props = {};
      for (const f of gj.features) for (const [k, v] of Object.entries(f.properties || {})) if (!HIDE_PROPS.test(k)) (props[k] ??= new Set()).add(v ?? '');
      return { rec, gj, gaya, props };
    });
    layers.forEach(build);
    drawSide(); drawLegend(); fillSearch(); renderSummary();
  }

  function catColors(L0) {
    const m = L0.gaya.mode || 'warna';
    if (m.startsWith('data:')) { const th = DATA_THEMES[m.slice(5)]; return th.colors || lahanColors(A); }
    if (m.startsWith('attr:')) {
      const vals = [...(L0.props[m.slice(5)] || [])].map(String).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
      const c = {}; let i = 0;
      for (const v of vals) c[v] = FIXED_COLORS[v] || (v === '' ? NODATA : PAL[i++ % PAL.length]);
      return c;
    }
    return null;
  }
  function featureValue(L0, f) {
    const m = L0.gaya.mode || 'warna';
    if (m.startsWith('attr:')) return String(f.properties?.[m.slice(5)] ?? '');
    if (m.startsWith('data:')) return DATA_THEMES[m.slice(5)].value(f.properties?.[L0.rec.field_nama], A, f);
    return null;
  }
  let hl = null; // sorotan dari ringkasan: { id, test(f) }
  function styleFn(L0) {
    const colors = catColors(L0);
    const col = L0.rec.warna || '#facc15';
    const baseStyle = (f) => {
      if (!colors) return { color: col, weight: 1.5, fillColor: col, fillOpacity: 0.35 };
      const v = featureValue(L0, f);
      if (v == null && L0.gaya.mode === 'data:serah_terima') return { opacity: 0, fillOpacity: 0 }; // persil lama yang sudah dipecah: disembunyikan
      if (v === 'Belum dibeli') return { color: '#9ca3af', weight: 0.8, fillOpacity: 0 }; // lahan belum dibeli: tanpa warna, garis tipis saja (tidak dihitung)
      const c = v == null ? NODATA : colors[v] || NODATA;
      return { color: v == null ? '#9ca3af' : '#1f2937', weight: 1, dashArray: v == null ? '3' : null, fillColor: c, fillOpacity: v == null ? 0.25 : 0.6 };
    };
    return (f) => {
      const st = baseStyle(f);
      if (!hl || hl.id !== L0.rec.id) return st;
      return hl.test(f) ? { ...st, color: '#e11d48', weight: 3, dashArray: null, fillOpacity: 0.8 } : { ...st, opacity: 0.25, fillOpacity: 0.05 };
    };
  }

  function build(L0) {
    L0.lyr = L.geoJSON(L0.gj, {
      style: styleFn(L0),
      onEachFeature: (f, lyr) => {
        lyr.on('click', () => lyr.bindPopup(() => popup(L0, f, lyr), { maxWidth: 360 }).openPopup());
        lyr.on('mouseover', () => lyr.setStyle({ weight: 3 }));
        lyr.on('mouseout', () => L0.lyr.resetStyle(lyr));
      },
    });
    L0.labels = L.layerGroup();
    const lf = L0.gaya.label;
    if (lf) L0.lyr.eachLayer((l) => {
      const t = l.feature.properties?.[lf];
      if (t != null && t !== '' && l.getBounds) L0.labels.addLayer(L.tooltip({ permanent: true, direction: 'center', className: 'blk-label' }).setLatLng(l.getBounds().getCenter()).setContent(esc(t)));
    });
    L0.notes = L.layerGroup();
    L0.lyr.eachLayer((l) => {
      const c = l.feature.properties?.Catatan;
      if (c && l.getBounds) L.marker(l.getBounds().getCenter(), { icon: L.divIcon({ className: 'note-ic', html: '📝', iconSize: [20, 20] }) })
        .bindTooltip(esc(c)).on('click', () => l.fire('click')).addTo(L0.notes);
    });
    L0.lyr.on('add', () => L0.notes.addTo(map));
    L0.lyr.on('remove', () => map.removeLayer(L0.notes));
    if (n(L0.rec.tampil ?? 1) !== 0 || L0.rec.tampil == null) { L0.lyr.addTo(map); updLabels(L0); }
  }
  function updLabels(L0) {
    const on = map.hasLayer(L0.lyr) && L0.gaya.label && map.getZoom() >= (L0.gaya.labelZoom || 16);
    if (on && !map.hasLayer(L0.labels)) L0.labels.addTo(map);
    if (!on && map.hasLayer(L0.labels)) map.removeLayer(L0.labels);
  }
  map.on('zoomend', () => layers.forEach(updLabels));
  function restyle() { layers.forEach((L0) => L0.lyr.setStyle(styleFn(L0))); drawLegend(); drawSide(); renderSummary(); }
  function rebuild(L0) { const vis = map.hasLayer(L0.lyr); map.removeLayer(L0.lyr); map.removeLayer(L0.labels); L0.rec.tampil = vis ? 1 : 0; build(L0); }

  // ---------- popup
  function popup(L0, f, lyr) {
    const p = f.properties || {};
    const name = p[L0.rec.field_nama];
    const ha = luasHa(f);
    const el = document.createElement('div');
    const persil = isPersil(L0);
    const attrs = Object.entries(p).filter(([k]) => !HIDE_PROPS.test(k) && k !== L0.rec.field_nama && k !== 'Catatan' && !(persil && PERSIL_HIDE.test(k)));
    if (persil) { const v = serahTerima(f); attrs.unshift(['Status lahan', v === 'Sudah serah terima' ? 'Sudah serah terima' : v === 'Belum serah terima' ? 'Sudah dibeli, belum serah terima' : v ? 'Belum dibeli — bukan lahan kebun' : 'Persil lama (sudah dipecah)']); }
    let h = `<div style="font-size:14px;font-weight:600;margin-bottom:4px">${esc(name ?? '(tanpa nama)')}</div>
      <div class="small muted" style="margin-bottom:6px">${esc(L0.rec.nama)}${ha ? ` · luas peta <b>${fmtNum(ha, 3)} ha</b>` : ''}</div>
      <table>${attrs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'number' ? fmtNum(v, Number.isInteger(v) ? 0 : 2) : v)}</td></tr>`).join('')}</table>
      ${p.Catatan ? `<div style="margin-top:6px;padding:6px 8px;background:#fffbea;border:1px solid #f3e2a6;border-radius:6px;white-space:pre-wrap">📝 ${esc(p.Catatan)}</div>` : ''}
      <div style="margin:6px 0;display:flex;gap:4px;flex-wrap:wrap"><button class="btn sm ed" data-a="note">📝 ${p.Catatan ? 'Ubah catatan' : 'Tambah catatan'}</button><button class="btn sm ed" data-a="edit-attr">✏️ Ubah atribut peta</button></div>`;
    const linked = [];
    if (name) for (const m of MASTER) {
      if (L0.rec.link_tabel && L0.rec.link_tabel !== 'auto' && L0.rec.link_tabel !== m.t) continue;
      const r = findRec(A, m.t, name);
      if (r) linked.push({ m, r });
    }
    if (linked.length) {
      for (const { m, r } of linked) {
        const T = TABLES[m.t];
        const show = T.f.filter((f) => !['keterangan', m.k].includes(f.k) && (A.val(m.t, f, r) ?? '') !== '').slice(0, 9);
        h += `<div style="margin-top:8px;padding-top:6px;border-top:2px solid #e2e8e3"><b>📋 ${esc(m.label)}</b>
          <table>${show.map((f) => `<tr><td>${esc(f.l)}</td><td>${esc(A.fmtField(f, A.val(m.t, f, r)))}</td></tr>`).join('')}</table>`;
        if (m.t === 'padi_petak') { const tn = latestTanam(A, name); if (tn) h += `<div class="small" style="margin-top:3px">Musim terakhir: <b>${esc(displayOf('padi_tanam', tn))}</b> · ${esc(tn.varietas || '')} · fase <b>${esc(padiFase(tn, A.ctx))}</b></div>`; }
        h += A.can(m.t) ? `<button class="btn sm" style="margin-top:4px" data-a="edit-rec" data-t="${m.t}" data-id="${r.id}">Ubah data</button></div>` : '</div>';
      }
    } else if (name && MASTER.some((m) => A.can(m.t))) {
      h += `<div style="margin-top:8px;padding-top:6px;border-top:2px solid #e2e8e3" class="small muted">Belum ada data divisi bernama "${esc(name)}". Buat:</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${MASTER.filter((m) => A.can(m.t)).map((m) => `<button class="btn sm" data-a="new-rec" data-t="${m.t}">＋ ${m.label}</button>`).join('')}</div>`;
    }
    el.innerHTML = h;
    el.onclick = (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const done = async () => { restyle(); map.closePopup(); };
      if (b.dataset.a === 'edit-rec') A.openForm(b.dataset.t, A.ctx.rows(b.dataset.t).find((r) => r.id === Number(b.dataset.id)), { onSaved: done });
      if (b.dataset.a === 'new-rec') {
        const m = MASTER.find((x) => x.t === b.dataset.t);
        A.openForm(m.t, null, { prefill: { [m.k]: name, [m.luas]: ha ? Math.round(ha * 10000) / 10000 : null }, onSaved: done });
      }
      if (b.dataset.a === 'edit-attr') editAttr(L0, f);
      if (b.dataset.a === 'note') editNote(L0, f);
    };
    return el;
  }

  function editNote(L0, f) {
    const p = f.properties || (f.properties = {});
    const md = A.openModal(`<div class="modal-head"><h2>📝 Catatan · ${esc(p[L0.rec.field_nama] ?? '(tanpa nama)')}</h2><button class="x">×</button></div>
      <div class="modal-body"><p class="small muted">Catatan tampil di peta (ikon 📝), di popup, dan di daftar catatan pada ringkasan. Kosongkan untuk menghapus.</p>
      <div class="fld"><textarea id="nT" rows="4" placeholder="mis. Sudah serah terima 12 Okt 2026, sertifikat di kantor">${esc(p.Catatan || '')}</textarea></div></div>
      <div class="modal-foot"><span class="sp"></span><button class="btn" id="nC">Batal</button><button class="btn primary" id="nS">Simpan</button></div>`);
    $('#nC', md).onclick = A.closeModal;
    setTimeout(() => $('#nT', md).focus(), 30);
    $('#nS', md).onclick = async () => {
      const v = $('#nT', md).value.trim();
      if (v) p.Catatan = v; else delete p.Catatan;
      await A.api.put(`/api/t/gis_layer/${L0.rec.id}`, { geojson: JSON.stringify(L0.gj) });
      A.closeModal(); A.toast(v ? 'Catatan tersimpan' : 'Catatan dihapus'); map.closePopup();
      rebuild(L0); renderSummary();
    };
  }

  function editAttr(L0, f) {
    const p = f.properties || (f.properties = {});
    const keys = Object.keys(p).filter((k) => !HIDE_PROPS.test(k));
    const md = A.openModal(`<div class="modal-head"><h2>Ubah atribut peta · ${esc(p[L0.rec.field_nama] ?? '')}</h2><button class="x">×</button></div>
      <div class="modal-body"><p class="small muted">Mengubah atribut poligon di layer <b>${esc(L0.rec.nama)}</b>. Pilihan diambil dari nilai yang sudah ada di layer ini (boleh diketik baru).</p>
      <div class="form-grid">${keys.map((k) => `<div class="fld"><label>${esc(k)}</label><input data-k="${esc(k)}" list="al_${esc(k)}" value="${esc(p[k] ?? '')}"><datalist id="al_${esc(k)}">${[...(L0.props[k] || [])].slice(0, 60).map((v) => `<option value="${esc(v)}">`).join('')}</datalist></div>`).join('')}</div></div>
      <div class="modal-foot"><span class="sp"></span><button class="btn" id="aC">Batal</button><button class="btn primary" id="aS">Simpan</button></div>`);
    $('#aC', md).onclick = A.closeModal;
    $('#aS', md).onclick = async () => {
      for (const i of $$('input[data-k]', md)) { const old = p[i.dataset.k]; p[i.dataset.k] = typeof old === 'number' && i.value !== '' && !isNaN(i.value) ? Number(i.value) : i.value; }
      await A.api.put(`/api/t/gis_layer/${L0.rec.id}`, { geojson: JSON.stringify(L0.gj) });
      A.closeModal(); A.toast('Atribut peta tersimpan'); map.closePopup();
      for (const [k, v] of Object.entries(p)) if (!HIDE_PROPS.test(k)) (L0.props[k] ??= new Set()).add(v ?? '');
      restyle();
    };
  }

  // ---------- panel samping
  function modeOptions(L0) {
    const cur = L0.gaya.mode || 'warna';
    const persil = isPersil(L0);
    const attrs = Object.entries(L0.props).filter(([k, s]) => s.size > 1 && s.size <= 60 && !(persil && PERSIL_HIDE.test(k))).map(([k]) => k);
    const themes = Object.entries(DATA_THEMES).filter(([, t]) => !!t.persil === persil);
    return `<option value="warna" ${cur === 'warna' ? 'selected' : ''}>Satu warna</option>
      <optgroup label="${persil ? 'Status lahan' : 'Data divisi'}">${themes.map(([k, t]) => `<option value="data:${k}" ${cur === 'data:' + k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>
      <optgroup label="Kolom peta">${attrs.map((k) => `<option value="attr:${esc(k)}" ${cur === 'attr:' + k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</optgroup>`;
  }
  function drawSide() {
    $('#gLayers').innerHTML = layers.length ? layers.map((L0, i) => `
      <div class="layer-item" data-i="${i}">
        <div class="top"><input type="checkbox" data-a="vis" ${map.hasLayer(L0.lyr) ? 'checked' : ''}><span class="swatch" style="background:${esc(L0.rec.warna || '#facc15')}"></span><b title="${esc(L0.rec.nama)}">${esc(L0.rec.nama)}</b><span class="small muted">${L0.gj.features.length}</span></div>
        <div class="meta">Warnai: <select data-a="mode" style="max-width:170px;font-size:12px">${modeOptions(L0)}</select></div>
        <div class="meta">Label: <select data-a="label" style="max-width:150px;font-size:12px"><option value="">—</option>${Object.keys(L0.props).filter((k) => !(isPersil(L0) && PERSIL_HIDE.test(k))).map((k) => `<option ${L0.gaya.label === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
        <div class="tools">
          <button class="btn sm" data-a="zoom" title="Perbesar ke layer">🔍</button>
          <button class="btn sm ed" data-a="set" title="Pengaturan">⚙️</button>
          <button class="btn sm ed" data-a="sync" title="Buat data divisi dari poligon">📋 Ke data</button>
          <button class="btn sm danger ed" data-a="del" title="Hapus layer">🗑</button>
        </div>
      </div>`).join('') : '<div class="small muted">Belum ada layer. Klik “Tambah / perbarui layer”.</div>';
    $$('#gLayers .layer-item').forEach((el) => {
      const L0 = layers[Number(el.dataset.i)];
      const saveGaya = () => putLayer(L0.rec.id, { gaya: JSON.stringify(L0.gaya) });
      el.onchange = async (e) => {
        const a = e.target.dataset.a;
        if (a === 'vis') {
          if (e.target.checked) L0.lyr.addTo(map); else map.removeLayer(L0.lyr);
          updLabels(L0); drawLegend();
          L0.rec.tampil = e.target.checked ? 1 : 0;
          putLayer(L0.rec.id, { tampil: L0.rec.tampil });
        }
        if (a === 'mode') { L0.gaya.mode = e.target.value; L0.lyr.setStyle(styleFn(L0)); drawLegend(); saveGaya(); }
        if (a === 'label') { L0.gaya.label = e.target.value; map.removeLayer(L0.labels); map.removeLayer(L0.lyr); build(L0); saveGaya(); }
      };
      el.onclick = async (e) => {
        const a = e.target.closest('button')?.dataset.a; if (!a) return;
        if (a === 'zoom') { const b = L0.lyr.getBounds(); b.isValid() && map.fitBounds(b); }
        if (a === 'set') layerSettings(L0);
        if (a === 'sync') syncToData(L0);
        if (a === 'del' && confirm(`Hapus layer "${L0.rec.nama}" dari peta?`)) { await A.api.del(`/api/t/gis_layer/${L0.rec.id}`); A.toast('Layer dihapus'); loadLayers(); }
      };
    });
  }

  function drawLegend() {
    const el = $('.legend', map.getContainer());
    let h = '';
    for (const L0 of layers) {
      if (!map.hasLayer(L0.lyr)) continue;
      const colors = catColors(L0);
      if (!colors) { h += `<div><i style="background:${esc(L0.rec.warna || '#facc15')}"></i>${esc(L0.rec.nama)}</div>`; continue; }
      const cnt = {};
      L0.gj.features.forEach((f) => { const v = featureValue(L0, f); const k = v == null ? '__none' : v; cnt[k] = (cnt[k] || 0) + 1; });
      const mode = L0.gaya.mode;
      h += `<b>${esc(L0.rec.nama)} · ${esc(mode.startsWith('attr:') ? mode.slice(5) : DATA_THEMES[mode.slice(5)].label)}</b>`;
      for (const [v, c] of Object.entries(colors)) if (cnt[v]) h += `<div><i style="background:${c}"></i>${esc(v || '(kosong)')} <span class="muted">(${cnt[v]})</span></div>`;
      if (cnt.__none && mode !== 'data:serah_terima') h += `<div><i style="background:${NODATA}"></i>Belum ada data <span class="muted">(${cnt.__none})</span></div>`;
    }
    el.innerHTML = h || '<span class="muted">Tidak ada layer tampil</span>';
    el.hidden = !h;
  }

  function fillSearch() {
    const names = new Set();
    layers.forEach((L0) => L0.gj.features.forEach((f) => { const v = f.properties?.[L0.rec.field_nama]; if (v) names.add(String(v)); }));
    A.ctx.rows('gis_titik').forEach((r) => r.nama && names.add(r.nama));
    $('#gNames').innerHTML = [...names].sort().map((v) => `<option value="${esc(v)}">`).join('');
  }
  $('#gSearch').onchange = (e) => {
    const k = util.key(e.target.value); if (!k) return;
    for (const L0 of layers) {
      let hit = null;
      L0.lyr.eachLayer((l) => { if (!hit && util.key(l.feature.properties?.[L0.rec.field_nama]) === k) hit = l; });
      if (hit) { if (!map.hasLayer(L0.lyr)) { L0.lyr.addTo(map); drawSide(); } map.fitBounds(hit.getBounds(), { maxZoom: 18 }); hit.fire('click'); return; }
    }
    const t = A.ctx.rows('gis_titik').find((r) => util.key(r.nama) === k);
    if (t?.lat) { map.setView([t.lat, t.lng], 18); return; }
    A.toast('Tidak ditemukan', true);
  };

  // ---------- ringkasan luas & catatan
  let sumId = null;
  function renderSummary() {
    const el = $('#gSum');
    if (!layers.length) { el.innerHTML = ''; return; }
    const L0 = layers.find((x) => x.rec.id === sumId) || layers.find((x) => /persil/i.test(x.rec.nama)) || layers[0];
    sumId = L0.rec.id;
    const cfg = (L0.gaya.sum ??= {});
    const persil = isPersil(L0);
    const fields = [...(persil ? [ST_FIELD] : []), ...Object.entries(L0.props).filter(([k, s]) => k !== 'Catatan' && s.size > 1 && s.size <= 80 && !(persil && PERSIL_HIDE.test(k))).map(([k]) => k)];
    const modeAttr = L0.gaya.mode?.startsWith('attr:') ? L0.gaya.mode.slice(5) : L0.gaya.mode === 'data:serah_terima' ? ST_FIELD : null;
    const f1 = fields.includes(cfg.f1) ? cfg.f1 : fields.includes(modeAttr) ? modeAttr : fields[0];
    const f2 = fields.includes(cfg.f2) && cfg.f2 !== f1 ? cfg.f2 : '';
    cfg.excl ??= L0.props.Status?.has('Lahan Berubah') ? [{ k: 'Status', v: 'Lahan Berubah' }] : [];
    const isEx = (f) => cfg.excl.some((e) => String(f.properties?.[e.k] ?? '').trim() === e.v);
    const groups = new Map();
    const tot = { n: 0, ha: 0 }, ex = { n: 0, ha: 0 };
    for (const f of L0.gj.features) {
      if (persil && !['Sudah serah terima', 'Belum serah terima'].includes(serahTerima(f))) continue; // lahan belum dibeli tidak dihitung / dibandingkan
      const ha = luasHa(f);
      if (isEx(f)) { ex.n++; ex.ha += ha; continue; }
      const g1 = gval(f, f1, cfg.m1);
      const G = groups.get(g1) || { n: 0, ha: 0, sub: new Map() };
      G.n++; G.ha += ha;
      if (f2) { const g2 = gval(f, f2, cfg.m2); const S = G.sub.get(g2) || { n: 0, ha: 0 }; S.n++; S.ha += ha; G.sub.set(g2, S); }
      groups.set(g1, G); tot.n++; tot.ha += ha;
    }
    const colors = modeAttr === f1 && !cfg.m1 ? catColors(L0) : null;
    const rows = [...groups.entries()].sort((a, b) => b[1].ha - a[1].ha);
    const subRows = (G) => [...G.sub.entries()].sort((a, b) => b[1].ha - a[1].ha);
    const pct = (v) => (tot.ha ? fmtNum((v / tot.ha) * 100, 1) + '%' : '');
    const barH = (v) => `<div class="bar"><i style="width:${tot.ha ? (v / tot.ha) * 100 : 0}%"></i></div>`;
    const notes = L0.gj.features.filter((f) => f.properties?.Catatan);
    const fOpt = (cur, none) => (none ? '<option value="">— tidak —</option>' : '') + fields.map((k) => `<option ${k === cur ? 'selected' : ''}>${esc(k)}</option>`).join('');
    el.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">📊 Ringkasan luas</h3>
        <select id="sL" class="btn">${layers.map((x) => `<option value="${x.rec.id}" ${x === L0 ? 'selected' : ''}>${esc(x.rec.nama)}</option>`).join('')}</select>
        <label class="small">Kelompok <select id="sF1" class="btn sm">${fOpt(f1)}</select></label>
        <label class="small"><input type="checkbox" id="sM1" ${cfg.m1 ? 'checked' : ''}> gabung tahap</label>
        <label class="small">Rinci per <select id="sF2" class="btn sm">${fOpt(f2, true)}</select></label>
        ${f2 ? `<label class="small"><input type="checkbox" id="sM2" ${cfg.m2 ? 'checked' : ''}> gabung tahap</label>` : ''}
        <span style="margin-left:auto;display:flex;gap:6px">${hl ? '<button class="btn sm" id="sClr">✖ Hapus sorotan</button>' : ''}<button class="btn sm" id="sExp">⬇ Export Excel</button></span>
      </div>
      <p class="sub">Luas dari kolom <b>${sumberLuas(L0)}</b>${L0.props.Area ? ' (kolom <i>Area</i> tidak dipakai — pada persil yang dipecah masih berisi luas persil induk)' : ''}${persil ? '' : '. “Gabung tahap” menyatukan angka di belakang (mis. Tahap 1…3 → Tahap)'}. Klik 🔍 untuk menyorot di peta, ⊘ untuk mengeluarkan dari total.</p>
      ${L0.gaya.catatan ? `<div style="margin-bottom:10px;padding:8px 10px;background:#fffbea;border:1px solid #f3e2a6;border-radius:8px;white-space:pre-wrap">📝 ${esc(L0.gaya.catatan)}</div>` : ''}
      <div class="cols-3">
        <div style="overflow:auto"><table class="mini">
          <tr><th>${esc(f1)}${f2 ? ' › ' + esc(f2) : ''}</th><th class="num">Jumlah</th><th class="num">Luas (ha)</th><th class="num">%</th><th style="width:22%"></th><th></th></tr>
          ${rows.map(([g, G]) => `<tr style="font-weight:600"><td>${colors ? `<span class="dot" style="background:${colors[g] || NODATA}"></span>` : ''}${esc(g || '(kosong)')}</td><td class="num">${G.n}</td><td class="num">${fmtNum(G.ha, 3)}</td><td class="num">${pct(G.ha)}</td><td>${barH(G.ha)}</td>
              <td class="nowrap"><button class="btn sm" data-hl="${esc(g)}" title="Sorot di peta">🔍</button> <button class="btn sm ed" data-ex="${esc(g)}" title="Keluarkan dari total">⊘</button></td></tr>
            ${f2 ? subRows(G).map(([s2, S]) => `<tr><td style="padding-left:24px" class="muted">${esc(s2 || '(kosong)')}</td><td class="num">${S.n}</td><td class="num">${fmtNum(S.ha, 3)}</td><td class="num muted">${pct(S.ha)}</td><td></td><td><button class="btn sm" data-hl="${esc(g)}" data-hl2="${esc(s2)}" title="Sorot di peta">🔍</button></td></tr>`).join('') : ''}`).join('')}
          <tr><td><b>Total dihitung</b></td><td class="num"><b>${tot.n}</b></td><td class="num"><b>${fmtNum(tot.ha, 3)}</b></td><td class="num">100%</td><td></td><td></td></tr>
          ${cfg.excl.length && ex.n ? `<tr><td colspan="6" class="small muted">Tidak dihitung (${ex.n} poligon, ${fmtNum(ex.ha, 3)} ha): ${cfg.excl.map((e, i) => `<span class="tag" style="margin:2px">${esc(e.k)} = ${esc(e.v || '(kosong)')} <a href="#" class="ed" data-unex="${i}" title="Hitung lagi">×</a></span>`).join(' ')}</td></tr>` : ''}
        </table></div>
        <div>
          <div class="fld ed"><label>Catatan layer (tampil di atas ringkasan)</label><textarea id="sN" rows="3" placeholder="mis. Data persil per 10 Okt 2026. ST = serah terima.">${esc(L0.gaya.catatan || '')}</textarea></div>
          <button class="btn sm ed" id="sNS" style="margin-top:6px">Simpan catatan</button>
          <h4 style="margin:14px 0 6px;font-size:12px;color:var(--muted);text-transform:uppercase">📝 Catatan per poligon (${notes.length})</h4>
          ${notes.length ? `<table class="mini">${notes.map((f, i) => `<tr data-note="${i}" style="cursor:pointer"><td><b>${esc(f.properties[L0.rec.field_nama] ?? '(tanpa nama)')}</b><div class="small" style="white-space:pre-wrap">${esc(f.properties.Catatan)}</div></td><td class="num nowrap">${fmtNum(luasHa(f), 3)} ha</td></tr>`).join('')}</table>` : '<div class="small muted">Belum ada. Klik poligon di peta → 📝 Tambah catatan.</div>'}
        </div>
      </div>`;
    const save = () => putLayer(L0.rec.id, { gaya: JSON.stringify(L0.gaya) });
    const setHl = (test) => {
      hl = test ? { id: L0.rec.id, test } : null;
      layers.forEach((x) => x.lyr.setStyle(styleFn(x)));
      if (test) {
        if (!map.hasLayer(L0.lyr)) { L0.lyr.addTo(map); updLabels(L0); drawSide(); drawLegend(); }
        const hit = []; L0.lyr.eachLayer((l) => test(l.feature) && hit.push(l));
        if (hit.length) map.fitBounds(L.featureGroup(hit).getBounds(), { maxZoom: 18, padding: [20, 20] });
        $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      renderSummary();
    };
    $('#sL', el).onchange = (e) => { sumId = Number(e.target.value); hl = null; layers.forEach((x) => x.lyr.setStyle(styleFn(x))); renderSummary(); };
    $('#sF1', el).onchange = (e) => { cfg.f1 = e.target.value; save(); renderSummary(); };
    $('#sF2', el).onchange = (e) => { cfg.f2 = e.target.value; save(); renderSummary(); };
    $('#sM1', el).onchange = (e) => { cfg.m1 = e.target.checked; save(); renderSummary(); };
    $('#sM2', el)?.addEventListener('change', (e) => { cfg.m2 = e.target.checked; save(); renderSummary(); });
    $('#sClr', el)?.addEventListener('click', () => setHl(null));
    $$('[data-hl]', el).forEach((b) => (b.onclick = () => {
      const g = b.dataset.hl, g2 = b.dataset.hl2;
      setHl((f) => !isEx(f) && gval(f, f1, cfg.m1) === g && (g2 === undefined || gval(f, f2, cfg.m2) === g2));
    }));
    $$('[data-ex]', el).forEach((b) => (b.onclick = () => {
      if (cfg.m1) return A.toast('Matikan "gabung tahap" untuk mengeluarkan kategori', true);
      cfg.excl.push({ k: f1, v: b.dataset.ex }); save(); renderSummary();
    }));
    $$('[data-unex]', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); cfg.excl.splice(Number(a.dataset.unex), 1); save(); renderSummary(); }));
    $('#sNS', el).onclick = async () => { L0.gaya.catatan = $('#sN', el).value.trim(); await save(); A.toast('Catatan layer tersimpan'); renderSummary(); };
    $$('[data-note]', el).forEach((tr) => (tr.onclick = () => {
      const f = notes[Number(tr.dataset.note)];
      if (!map.hasLayer(L0.lyr)) { L0.lyr.addTo(map); drawSide(); }
      L0.lyr.eachLayer((l) => { if (l.feature === f) { map.fitBounds(l.getBounds(), { maxZoom: 18 }); l.fire('click'); } });
      $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    $('#sExp', el).onclick = () => {
      const r1 = [];
      for (const [g, G] of rows) {
        r1.push({ [f1]: g || '(kosong)', ...(f2 ? { [f2]: '(semua)' } : {}), Jumlah: G.n, 'Luas (ha)': +G.ha.toFixed(4), '%': +((G.ha / tot.ha) * 100).toFixed(2) });
        if (f2) for (const [s2, S] of subRows(G)) r1.push({ [f1]: g || '(kosong)', [f2]: s2 || '(kosong)', Jumlah: S.n, 'Luas (ha)': +S.ha.toFixed(4), '%': +((S.ha / tot.ha) * 100).toFixed(2) });
      }
      r1.push({ [f1]: 'TOTAL DIHITUNG', Jumlah: tot.n, 'Luas (ha)': +tot.ha.toFixed(4), '%': 100 });
      if (ex.n) r1.push({ [f1]: 'Tidak dihitung: ' + cfg.excl.map((e) => `${e.k}=${e.v}`).join(', '), Jumlah: ex.n, 'Luas (ha)': +ex.ha.toFixed(4) });
      const keys = Object.keys(L0.props).filter((k) => !HIDE_PROPS.test(k));
      const r2 = L0.gj.features.map((f) => ({ ...Object.fromEntries(keys.map((k) => [k, f.properties?.[k] ?? ''])), 'Luas dipakai (ha)': +luasHa(f).toFixed(4), Dihitung: isEx(f) ? 'Tidak' : 'Ya' }));
      A.downloadXlsx(`Ringkasan Luas ${L0.rec.nama} ${util.iso(util.today())}.xlsx`, [{ name: 'Ringkasan', rows: r1 }, { name: 'Daftar Poligon', rows: r2 }, ...(L0.gaya.catatan ? [{ name: 'Catatan', rows: [{ 'Catatan layer': L0.gaya.catatan }] }] : [])]);
    };
  }

  // ---------- pengaturan layer
  function layerSettings(L0) {
    const r = L0.rec;
    const md = A.openModal(`<div class="modal-head"><h2>Pengaturan layer</h2><button class="x">×</button></div>
      <div class="modal-body"><div class="form-grid">
        <div class="fld"><label>Nama layer</label><input id="lN" value="${esc(r.nama)}"></div>
        <div class="fld"><label>Jenis</label><input id="lJ" value="${esc(r.jenis || '')}" list="lJl"><datalist id="lJl"><option>Blok Tanam</option><option>Persil Lahan</option><option>Jalan</option><option>Irigasi</option><option>Batas Kebun</option></datalist></div>
        <div class="fld"><label>Kolom nama blok (untuk menghubungkan data)</label><select id="lF">${Object.keys(L0.props).map((k) => `<option ${k === r.field_nama ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
        <div class="fld"><label>Hubungkan ke data</label><select id="lT"><option value="auto">Otomatis (semua tabel induk)</option><option value="none" ${r.link_tabel === 'none' ? 'selected' : ''}>Tidak dihubungkan</option>${MASTER.map((m) => `<option value="${m.t}" ${r.link_tabel === m.t ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
        <div class="fld"><label>Warna dasar</label><input id="lW" type="color" value="${esc(r.warna || '#facc15')}"></div>
        <div class="fld"><label>Urutan gambar (kecil = paling bawah)</label><input id="lU" type="number" value="${n(r.urutan)}"></div>
        <div class="fld"><label>Label tampil mulai zoom</label><input id="lZ" type="number" value="${L0.gaya.labelZoom || 16}"></div>
      </div></div>
      <div class="modal-foot"><span class="sp"></span><button class="btn" id="lC">Batal</button><button class="btn primary" id="lS">Simpan</button></div>`);
    $('#lC', md).onclick = A.closeModal;
    $('#lS', md).onclick = async () => {
      L0.gaya.labelZoom = Number($('#lZ', md).value) || 16;
      await A.api.put(`/api/t/gis_layer/${r.id}`, { nama: $('#lN', md).value, jenis: $('#lJ', md).value, field_nama: $('#lF', md).value, link_tabel: $('#lT', md).value, warna: $('#lW', md).value, urutan: $('#lU', md).value, gaya: JSON.stringify(L0.gaya) });
      A.closeModal(); A.toast('Layer tersimpan'); loadLayers();
    };
  }

  // ---------- buat data induk dari poligon
  function syncToData(L0) {
    const fn = L0.rec.field_nama;
    const filtAttrs = Object.entries(L0.props).filter(([k, s]) => k !== fn && s.size > 1 && s.size <= 20);
    const md = A.openModal(`<div class="modal-head"><h2>Buat data divisi dari poligon</h2><button class="x">×</button></div>
      <div class="modal-body">
        <p class="small muted">Membuat baris baru di tabel induk untuk setiap poligon yang <b>belum</b> punya data (nama dari kolom <b>${esc(fn)}</b>, luas dari peta). Data yang sudah ada tidak diubah. Sisanya (tanggal tanam, pokok, dll.) diisi sendiri setelahnya.</p>
        <div class="form-grid">
          <div class="fld"><label>Tabel tujuan</label><select id="sT">${MASTER.map((m) => `<option value="${m.t}">${m.label}</option>`).join('')}</select></div>
          <div class="fld"><label>Hanya poligon dengan</label><select id="sA"><option value="">(semua poligon)</option>${filtAttrs.map(([k, s]) => [...s].map((v) => `<option value="${esc(k)}=${esc(v)}">${esc(k)} = ${esc(v || '(kosong)')}</option>`).join('')).join('')}</select></div>
        </div>
        <div id="sPrev" class="small" style="margin-top:12px"></div>
      </div>
      <div class="modal-foot"><span class="sp"></span><button class="btn" id="sC">Batal</button><button class="btn primary" id="sS">Buat data</button></div>`);
    let todo = [];
    const prev = () => {
      const m = MASTER.find((x) => x.t === $('#sT', md).value);
      const [ak, av] = ($('#sA', md).value || '').split(/=(.*)/s);
      const seen = new Set(A.ctx.rows(m.t).map((r) => util.key(r[m.k])));
      const agg = new Map();
      for (const f of L0.gj.features) {
        const p = f.properties || {};
        if (ak && String(p[ak] ?? '') !== av) continue;
        const nm = p[fn]; if (!nm || seen.has(util.key(nm))) continue;
        const k = util.key(nm);
        const cur = agg.get(k) || { name: String(nm).trim(), ha: 0 };
        cur.ha += luasHa(f); agg.set(k, cur);
      }
      todo = [...agg.values()].sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }));
      $('#sPrev', md).innerHTML = todo.length ? `<b>${todo.length} data baru</b> akan dibuat di ${esc(m.label)}:<br>${todo.map((x) => `${esc(x.name)} <span class="muted">(${fmtNum(x.ha, 3)} ha)</span>`).join(', ')}` : 'Tidak ada poligon baru — semua sudah punya data.';
      $('#sS', md).disabled = !todo.length;
    };
    md.onchange = prev; prev();
    $('#sC', md).onclick = A.closeModal;
    $('#sS', md).onclick = async () => {
      const m = MASTER.find((x) => x.t === $('#sT', md).value);
      await A.api.post(`/api/t/${m.t}`, todo.map((x) => ({ [m.k]: x.name, [m.luas]: Math.round(x.ha * 10000) / 10000 })));
      await A.loadTable(m.t);
      A.closeModal(); A.toast(`${todo.length} data dibuat di ${m.label}`); restyle();
    };
  }

  // ---------- tambah / perbarui layer dari file
  $('#gAdd').onclick = () => {
    const md = A.openModal(`<div class="modal-head"><h2>Tambah / perbarui layer peta</h2><button class="x">×</button></div>
      <div class="modal-body">
        <p class="small muted">Pilih shapefile dalam <b>.zip</b> (berisi .shp, .dbf, .prj) atau file <b>.geojson</b>. Proyeksi (mis. UTM 49S) dikonversi otomatis. Untuk memperbarui peta yang sudah ada (mis. Blok Tanam versi baru), pilih layer yang diganti — pengaturan warna & label tetap.</p>
        <input type="file" id="uF" accept=".zip,.geojson,.json">
        <div id="uList" style="margin-top:12px"></div>
      </div>
      <div class="modal-foot"><span class="sp"></span><button class="btn" id="uC">Batal</button><button class="btn primary" id="uS" disabled>Simpan</button></div>`);
    $('#uC', md).onclick = A.closeModal;
    let parsed = [];
    $('#uF', md).onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      $('#uList', md).textContent = 'Membaca file…';
      try {
        const buf = await file.arrayBuffer();
        if (/\.zip$/i.test(file.name)) await A.loadLib('shp');
        const gj = /\.zip$/i.test(file.name) ? await shp(buf) : JSON.parse(new TextDecoder().decode(buf));
        parsed = [].concat(gj).map((fc) => ({ name: String(fc.fileName || file.name.replace(/\.\w+$/, '')).split('/').pop(), fc: { type: 'FeatureCollection', features: (fc.features || []).filter((f) => f.geometry) } }));
      } catch (err) { $('#uList', md).innerHTML = `<span style="color:var(--danger)">Gagal membaca: ${esc(err.message)}</span>`; return; }
      const guess = (fc) => { const ks = Object.keys(fc.features[0]?.properties || {}); return ks.find((k) => /blok|petak/i.test(k)) || ks.find((k) => /nama|name|refname/i.test(k)) || ks[0] || ''; };
      $('#uList', md).innerHTML = parsed.map((p, i) => {
        const same = layers.find((L0) => util.key(L0.rec.nama) === util.key(p.name.replace(/\(.*?\)/g, '').replace(/_/g, ' ')) || util.key(L0.rec.nama) === util.key(p.name));
        return `<div class="card" style="margin-bottom:8px;padding:10px"><b>${esc(p.name)}</b> <span class="muted small">· ${p.fc.features.length} fitur · kolom: ${esc(Object.keys(p.fc.features[0]?.properties || {}).join(', '))}</span>
        <div class="form-grid" style="margin-top:8px">
          <div class="fld"><label>Simpan sebagai</label><select data-i="${i}" data-k="target"><option value="new">Layer baru</option><option value="skip">Lewati</option>${layers.map((L0) => `<option value="${L0.rec.id}" ${same === L0 ? 'selected' : ''}>Ganti: ${esc(L0.rec.nama)}</option>`).join('')}</select></div>
          <div class="fld"><label>Nama layer (jika baru)</label><input data-i="${i}" data-k="nama" value="${esc(p.name.replace(/\(.*?\)/g, '').replace(/_/g, ' ').trim())}"></div>
          <div class="fld"><label>Kolom nama blok</label><select data-i="${i}" data-k="field">${Object.keys(p.fc.features[0]?.properties || {}).map((k) => `<option ${k === guess(p.fc) ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
          <div class="fld"><label>Warna</label><input type="color" data-i="${i}" data-k="warna" value="${PAL[i % PAL.length]}"></div>
        </div></div>`;
      }).join('');
      $('#uS', md).disabled = !parsed.length;
    };
    $('#uS', md).onclick = async () => {
      const get = (i, k) => $(`[data-i="${i}"][data-k="${k}"]`, md).value;
      $('#uS', md).disabled = true;
      for (const [i, p] of parsed.entries()) {
        const target = get(i, 'target');
        if (target === 'skip') continue;
        const body = { geojson: JSON.stringify(p.fc), field_nama: get(i, 'field') };
        if (target === 'new') await A.api.post('/api/t/gis_layer', { ...body, nama: get(i, 'nama'), warna: get(i, 'warna'), link_tabel: 'auto', tampil: 1, urutan: layers.length + i + 1, gaya: '{}' });
        else await A.api.put(`/api/t/gis_layer/${target}`, body);
      }
      A.closeModal(); A.toast('Layer tersimpan'); await loadLayers();
      const all = L.featureGroup(layers.filter((x) => map.hasLayer(x.lyr)).map((x) => x.lyr));
      all.getBounds().isValid() && map.fitBounds(all.getBounds());
    };
  };

  // ---------- titik lokasi
  const PCOL = { 'Sumur Bor': '#0284c7', Pompa: '#0891b2', Embung: '#1d4ed8', 'Packing House': '#ca8a04', Gudang: '#92400e', Kantor: '#7c3aed', 'Pos Jaga': '#dc2626', Workshop: '#475569', Nursery: '#16a34a' };
  function drawPoints() {
    pointsLyr.clearLayers();
    const rows = A.ctx.rows('gis_titik').filter((r) => r.lat && r.lng);
    for (const r of rows) {
      L.circleMarker([r.lat, r.lng], { radius: 7, color: '#fff', weight: 2, fillColor: PCOL[r.kategori] || '#e11d48', fillOpacity: 1 })
        .bindTooltip(esc(r.nama)).addTo(pointsLyr)
        .on('click', () => A.openForm('gis_titik', r, { onSaved: drawPoints }));
    }
    $('#gPoints').innerHTML = rows.length ? rows.map((r) => `<div class="small" style="padding:3px 0;cursor:pointer" data-id="${r.id}"><span class="dot" style="background:${PCOL[r.kategori] || '#e11d48'}"></span>${esc(r.nama)} <span class="muted">${esc(r.kategori || '')}</span></div>`).join('') : '<div class="small muted">Belum ada titik.</div>';
    $$('#gPoints [data-id]').forEach((el) => (el.onclick = () => { const r = rows.find((x) => x.id === Number(el.dataset.id)); map.setView([r.lat, r.lng], 18); }));
  }
  let picking = false;
  const stopPick = () => { picking = false; $('#gHint').hidden = true; map.getContainer().style.cursor = ''; };
  $('#gPoint').onclick = () => { picking = true; $('#gHint').hidden = false; map.getContainer().style.cursor = 'crosshair'; };
  document.addEventListener('keydown', (e) => e.key === 'Escape' && picking && stopPick());
  map.on('click', (e) => {
    if (!picking) return;
    stopPick();
    A.openForm('gis_titik', null, { prefill: { lat: +e.latlng.lat.toFixed(7), lng: +e.latlng.lng.toFixed(7) }, onSaved: drawPoints });
  });

  await loadLayers();
  drawPoints();
  const vis = layers.filter((x) => map.hasLayer(x.lyr) && x.lyr.getBounds().isValid());
  if (vis.length) map.fitBounds(L.featureGroup(vis.map((x) => x.lyr)).getBounds());
  setTimeout(() => map.invalidateSize(), 50);
}
