import {dailyHKCheck} from '../public/js/daily-hk.js';
export function dailyHKSummary(db,from,to){
 const reports=db.prepare("SELECT id,tanggal,divisi,apel_hadir,updated_at FROM daily_report WHERE status IN ('Selesai','Dikirim') AND tanggal BETWEEN ? AND ? ORDER BY tanggal,divisi,id").all(from,to),items=db.prepare('SELECT i.report_id,i.aktivitas,i.hk_realisasi FROM daily_item i JOIN daily_report r ON r.id=i.report_id WHERE r.tanggal BETWEEN ? AND ?').all(from,to),byReport=new Map();
 for(const x of items){if(!byReport.has(x.report_id))byReport.set(x.report_id,[]);byReport.get(x.report_id).push(x);}
 return {from,to,reports:reports.map(r=>({tanggal:r.tanggal,divisi:r.divisi,updatedAt:r.updated_at,...dailyHKCheck({...r,items:byReport.get(r.id)||[]})}))};
}
