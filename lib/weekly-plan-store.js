import {activityKey} from '../public/js/daily-work.js';

// Keep item identities used by daily reports. Removed items remain as history,
// but are excluded from the current plan and harvest targets.
export function saveWeeklyItems(db,planId,items,stamp){
 const previous=db.prepare('SELECT * FROM daily_week_item WHERE plan_id=?').all(planId);
 const key=r=>activityKey(r.aktivitas,r.satuan)+'|'+String(r.blok).trim().toLowerCase();
 const byKey=new Map(previous.map(r=>[key(r),r])),used=new Set();
 db.prepare('UPDATE daily_week_item SET retired=1 WHERE plan_id=?').run(planId);
 const columns=['urutan','blok','aktivitas','target','satuan','hk_rencana','keterangan'];
 for(const [i,x] of items.entries()){
  const prior=previous.find(r=>Number(r.id)===Number(x.id)&&key(r)===key(x))||byKey.get(key(x));
  const values=[i+1,String(x.blok).trim(),String(x.aktivitas).trim(),x.target==null||x.target===''?null:Number(x.target),x.satuan||null,x.hk_rencana==null||x.hk_rencana===''?null:Number(x.hk_rencana),x.keterangan||null];
  if(prior&&!used.has(prior.id)){
   used.add(prior.id);
   db.prepare('UPDATE daily_week_item SET updated_at=?,retired=0,'+columns.map(k=>k+'=?').join(',')+' WHERE id=?').run(stamp,...values,prior.id);
  }else db.prepare('INSERT INTO daily_week_item(created_at,updated_at,plan_id,retired,'+columns.join(',')+') VALUES (?,?,?,0,?,?,?,?,?,?,?)').run(stamp,stamp,planId,...values);
 }
}
