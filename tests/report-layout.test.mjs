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
 const db=new DatabaseSync(':memory:');for(const t of ['pisang_estimasi','daily_week_plan','daily_week_item','pisang_box'])db.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY,${TABLES[t].f.filter(f=>f.t!=='calc').map(f=>f.k+' TEXT').join(',')})`);
 db.exec('ALTER TABLE daily_week_item ADD COLUMN retired INTEGER DEFAULT 0');
 db.exec("INSERT INTO pisang_estimasi(id,bulan,box) VALUES(1,'2026-10-31',1000),(2,'2026-11-01',2000);INSERT INTO daily_week_plan(id,week_start,divisi,status) VALUES(1,'2026-10-26','Pisang','Dikirim'),(2,'2026-10-26','Pisang','Draf');INSERT INTO daily_week_item(id,plan_id,aktivitas,target,satuan) VALUES(1,1,'Panen',100,'box'),(2,1,'Panen',900,'tandan'),(3,2,'Panen',800,'box')");
 const get=date=>harvestPlanValues(harvestPlanQueries(date).map(q=>db.prepare(q.sql).get(...q.args)));
 assert.deepEqual(get('2026-10-26'),{planBoxes:1000,weeklyPlanBoxes:100,previousWeekBoxes:0});
 assert.deepEqual(get('2026-12-01'),{planBoxes:null,weeklyPlanBoxes:null,previousWeekBoxes:0});db.exec("INSERT INTO pisang_box(tanggal,jumlah_box) VALUES('2026-10-19',25),('2026-10-25',30),('2026-10-26',900)");assert.equal(get('2026-10-26').previousWeekBoxes,55);db.close();
});
test('climate graph distinguishes missing days from measured zero and combines temperature with a separate scale',()=>{
 const html=climateChartMarkup({from:'2026-10-01',to:'2026-10-03',climate:{days:[{tanggal:'2026-10-01',hujan:0,tavg:28},{tanggal:'2026-10-03',hujan:10,tavg:30}]}});
 assert.match(html,/2026-10-01: 0 mm/);assert.match(html,/2026-10-02: belum tercatat/);
 assert.match(html,/Suhu rata-rata harian/);assert.equal((html.match(/<svg /g)||[]).length,1);assert.match(html,/Hujan \(mm\)/);assert.match(html,/Suhu \(°C\)/);assert.equal((html.match(/<polyline /g)||[]).length,0,'missing middle day must break the temperature line');assert.ok(!html.includes('NaN'));
});

test('combined climate graph handles no data, rain-only and temperature-only without invented readings',()=>{
 const make=days=>climateChartMarkup({from:'2026-10-01',to:'2026-10-02',climate:{days}});
 assert.match(make([]),/Belum ada pengamatan/);
 for(const days of [[{tanggal:'2026-10-01',hujan:0}],[{tanggal:'2026-10-01',tavg:0}],[{tanggal:'2026-10-01',hujan:'invalid',tavg:28}]]){
  const html=make(days);assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));assert.equal((html.match(/<svg /g)||[]).length,1);assert.match(html,/Belum tercatat/);
 }
});

test('weekly banana cards compare actual boxes while monthly keeps its own plan, including zero baseline',()=>{
 const make=(now,previous)=>harvestSummaryMarkup({periods:[{key:'week',from:'2026-10-26',to:'2026-10-26',pisang:{boxes:now,previousWeekBoxes:previous}},{key:'month',from:'2026-10-01',to:'2026-10-26',pisang:{planBoxes:1050,boxes:719}}]});
 assert.match(make(10,5),/↑/);assert.match(make(5,10),/↓/);assert.match(make(0,0),/→/);assert.match(make(10,0),/Naik 10 box/);assert.ok(!make(10,0).includes('Infinity'));assert.match(make(10,5),/1.050/);assert.match(make(10,5),/331/);assert.match(make(10,5),/68,48%/);assert.match(make(10,5),/2026-10-19 – 2026-10-25/);
});

 test('half month periods partition current month without including future dates',()=>{
 for(const today of ['2026-10-01','2026-10-15','2026-10-16','2026-10-31','2028-02-29']){
 const ps=summaryPeriods(today),first=ps.find(p=>p.key==='monthFirst'),second=ps.find(p=>p.key==='monthSecond');
 assert.equal(first.from,today.slice(0,7)+'-01');assert.equal(first.to,today.slice(8)<='15'?today:today.slice(0,7)+'-15');assert.equal(second.from,today.slice(0,7)+'-16');assert.equal(second.to,today);
 const dates=Array.from({length:Number(today.slice(8))},(_,i)=>today.slice(0,7)+'-'+String(i+1).padStart(2,'0'));
 assert.equal(dates.filter(d=>d>=first.from&&d<=first.to).length+dates.filter(d=>d>=second.from&&d<=second.to).length,dates.length);
 }
 });
