import fs from 'node:fs';
import vm from 'node:vm';
import { TABLES, EXCEL_SHEETS } from '../public/js/schema.js';
import { parseWorkbook } from '../lib/excel.js';

const [excelPath, shapeZipPath] = process.argv.slice(2);
if (!excelPath || !shapeZipPath) throw new Error('Pakai: node scripts/build-import-seed.mjs <xlsx> <zip>');

const parsed = await parseWorkbook(fs.readFileSync(excelPath), { TABLES, SHEETS: EXCEL_SHEETS });
const errors = parsed.flatMap((p) => p.errors.map((e) => `${p.cfg.sheet} baris ${e.row}: ${e.msg}`));
if (errors.length) throw new Error(`Data Excel tidak valid:\n${errors.slice(0, 20).join('\n')}`);
const data = Object.fromEntries(parsed.filter((p) => p.found).map((p) => [p.cfg.table, p.rows]));
fs.writeFileSync(new URL('../seed/input-data-2026-10-23.json', import.meta.url), JSON.stringify(data));

const context = { console, Buffer, Promise, setTimeout, clearTimeout, URL, TextDecoder, TextEncoder };
context.global = context;
context.self = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../public/vendor/shp.min.js', import.meta.url), 'utf8'), context);
const geojson = await context.shp(fs.readFileSync(shapeZipPath));
if (geojson?.type !== 'FeatureCollection' || !geojson.features?.length) throw new Error('ZIP persil tidak menghasilkan FeatureCollection');
fs.writeFileSync(new URL('../seed/persil-lahan-2026-10-21.geojson', import.meta.url), JSON.stringify(geojson));

console.log(JSON.stringify({
  sheets: parsed.length,
  rows: Object.fromEntries(parsed.map((p) => [p.cfg.table, p.rows.length])),
  persil: geojson.features.length,
  properties: Object.keys(geojson.features[0]?.properties || {}),
}, null, 2));
