import {reportWeek} from './report-week.js';
export function harvestPlanQueries(from){
 return [
  {sql:"SELECT count(*) entries,sum(box) planBoxes FROM pisang_estimasi WHERE substr(bulan,1,7)=?",args:[from.slice(0,7)]},
  {sql:"SELECT count(*) entries,sum(i.target) planBoxes FROM daily_week_item i JOIN daily_week_plan p ON p.id=i.plan_id WHERE p.divisi='Pisang' AND p.status='Dikirim' AND p.week_start=? AND lower(trim(i.satuan))='box' AND (lower(i.aktivitas) LIKE '%panen%' OR lower(i.aktivitas) LIKE '%packing%')",args:[reportWeek(from).from]},
 ];
}
export function harvestPlanValues(values){return {planBoxes:values[0]?.entries?Number(values[0].planBoxes||0):null,weeklyPlanBoxes:values[1]?.entries?Number(values[1].planBoxes||0):null};}
