import {statusRencana,targetPeriode} from '../public/js/schema.js';
export function weeklyLand(db,ctx,date){
 const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()||7)+1);const from=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+6);const to=d.toISOString().slice(0,10);
 let plans;try{const saved=db.prepare('SELECT rows_json FROM _land_week_plan_snapshots WHERE week_start=?').get(from);if(saved)plans=JSON.parse(saved.rows_json);}catch{}
 const baseline={rows:t=>{const rows=t==='lahan_rencana'&&plans?plans:ctx.rows(t);return rows.filter(r=>t==='lahan_harian'?!r.diganti_aktual&&r.tanggal<from:t==='pisang_blok'?(!r.tanggal_tanam||r.tanggal_tanam<from):true);}};
 const targets=targetPeriode(baseline,statusRencana(baseline),from,to,from);
 const actual=ctx.rows('lahan_harian').filter(r=>!r.diganti_aktual&&r.tanggal>=from&&r.tanggal<=date&&r.tanggal<=to);
 return {from,to,targets:targets.map(x=>({...x,selesai:actual.filter(r=>r.aktivitas===x.a).reduce((s,r)=>s+Number(r.hasil_ha||0),0)}))};
}
