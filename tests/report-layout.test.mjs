import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {TABLES} from '../public/js/schema.js';import {summaryPeriods} from '../lib/summary-periods.js';
import {harvestPlanQueries,harvestPlanValues} from '../lib/harvest-plan.js';
import {periodSummaryMarkup,harvestSummaryMarkup} from '../public/js/period-summary.js';
import {climateChartMarkup} from '../public/js/climate-chart.js';
test('last year is a full distinct calendar year across year/week boundaries',()=>{
 const ps=summaryPeriods('2026-01-02');assert.equal(ps.find(p=>p.key==='week').from,'2025-12-29');
 assert.deepEqual([ps[3].from,ps[3].to],['2025-01-01','2025-12-31']);
});
test('harvest plan uses full monthly estimate and submitted weekly box plans, excluding drafts and tandan',()=>{
 const db=new DatabaseSync(':memory:');for(const t of ['pisang_estimasi','daily_week_plan','daily_week_item'])db.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY,${TABLES[t].f.filter(f=>f.t!=='calc').map(f=>f.k+' TEXT').join(',')})`);
 db.exec("INSERT INTO pisang_estimasi(id,bulan,box) VALUES(1,'2026-10-31',1000),(2,'2026-11-01',2000);INSERT INTO daily_week_plan(id,week_start,divisi,status) VALUES(1,'2026-10-26','Pisang','Dikirim'),(2,'2026-10-26','Pisang','Draf');INSERT INTO daily_week_item(id,plan_id,aktivitas,target,satuan) VALUES(1,1,'Panen',100,'box'),(2,1,'Panen',900,'tandan'),(3,2,'Panen',800,'box')");
 const get=date=>harvestPlanValues(harvestPlanQueries(date).map(q=>db.prepare(q.sql).get(...q.args)));
 assert.deepEqual(get('2026-10-26'),{planBoxes:1000,weeklyPlanBoxes:100});
 assert.deepEqual(get('2026-12-01'),{planBoxes:null,weeklyPlanBoxes:null});db.close();
});
test('climate graph distinguishes missing days from measured zero and combines temperature with a separate scale',()=>{
 const html=climateChartMarkup({from:'2026-10-01',to:'2026-10-03',climate:{days:[{tanggal:'2026-10-01',hujan:0,tavg:28},{tanggal:'2026-10-03',hujan:10,tavg:30}]}});
 assert.match(html,/2026-10-01: 0 mm/);assert.match(html,/2026-10-02: belum tercatat/);
 assert.match(html,/Suhu rata-rata harian/);assert.equal((html.match(/<svg /g)||[]).length,1);assert.match(html,/Hujan \(mm\)/);assert.match(html,/Suhu \(°C\)/);assert.equal((html.match(/<polyline /g)||[]).length,0,'missing middle day must break the temperature line');assert.ok(!html.includes('NaN'));
});
