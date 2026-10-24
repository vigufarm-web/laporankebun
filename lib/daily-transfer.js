import crypto from 'node:crypto';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reportFields=['tanggal','divisi','mandor','siklus','status','apel_hadir','apel_catatan','kendala','tindak_lanjut','dibuat_oleh'];
const itemFields=['aktivitas','blok','target','realisasi','hasil_sdhi','satuan','hk_rencana','hk_realisasi','alat','meter_awal','meter_akhir','ritase','keterangan'];
const numeric=new Set(['apel_hadir','target','realisasi','hasil_sdhi','hk_rencana','hk_realisasi','meter_awal','meter_akhir','ritase']);
const clean=(fields,row)=>Object.fromEntries(fields.map(k=>{
  let value=row[k]??null;
  if(value!==null && numeric.has(k)){value=Number(value);if(!Number.isFinite(value)||value<0)throw new Error('Angka laporan tidak valid');}
  else if(value!==null)value=String(value).slice(0,k==='keterangan'?2000:2000);
  return [k,value];
}));

// Explicit admin-only migration of historical reports. It does not create GIS
// blocks or change ownership, and never replaces the full operational database.
export function transferDaily({db,tx,blocks,now,actor},body) {
  if(!Array.isArray(body.reports)||!body.reports.length||body.reports.length>100)throw new Error('Paket harus berisi 1–100 laporan');
  const seen=new Set();
  const reports=body.reports.map(input=>{
    const report=clean(reportFields,input),key=report.tanggal+'|'+report.divisi;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(report.tanggal)||!['Pisang','Padi','Infra'].includes(report.divisi)||seen.has(key))throw new Error('Tanggal/divisi laporan tidak valid atau berulang');
    seen.add(key);
    if(!['Draf','Rencana Dikirim','Selesai'].includes(report.status))throw new Error('Status laporan tidak valid');
    if(!Array.isArray(input.items)||input.items.length>200)throw new Error('Rincian laporan tidak valid');
    const items=input.items.map(x=>clean(itemFields,{...x,target:null}));
    if(items.some(x=>!x.aktivitas))throw new Error('Nama pekerjaan wajib diisi');
    return {key,report,items};
  });
  const before=reports.map(r=>{
    const report=db.prepare('SELECT * FROM daily_report WHERE tanggal=? AND divisi=?').get(r.report.tanggal,r.report.divisi)||null;
    return {report,items:report?db.prepare('SELECT * FROM daily_item WHERE report_id=? ORDER BY urutan,id').all(report.id):[]};
  });
  const fingerprint=digest(reports),token=digest({reports,before});
  db.exec('CREATE TABLE IF NOT EXISTS _daily_transfer_batches (fingerprint TEXT PRIMARY KEY,created_at TEXT,actor TEXT,result_json TEXT)');
  const applied=db.prepare('SELECT result_json FROM _daily_transfer_batches WHERE fingerprint=?').get(fingerprint);
  if(applied)return {...JSON.parse(applied.result_json),already_applied:true};
  const preview=reports.map((r,i)=>({key:r.key,action:before[i].report?'Perbarui':'Tambah',old_items:before[i].items.length,new_items:r.items.length,previous_updated_at:before[i].report?.updated_at||null}));
  if(body.mode!=='apply')return {token,preview};
  if(body.token!==token){const error=new Error('Data online berubah. Periksa ulang paket sebelum menerapkan.');error.status=409;throw error;}
  const result={reports:[]};
  tx(()=>{
    db.exec('CREATE TABLE IF NOT EXISTS _daily_revisions (id INTEGER PRIMARY KEY,report_id INTEGER,created_at TEXT,actor TEXT,before_json TEXT)');
    for(const [i,r] of reports.entries()) {
      const old=before[i],stamp=now();let id=old.report?.id;
      if(old.report){
        db.prepare('INSERT INTO _daily_revisions(report_id,created_at,actor,before_json) VALUES(?,?,?,?)').run(id,stamp,actor,JSON.stringify(old));
        for(const field of ['kendala','tindak_lanjut','apel_catatan'])if(!r.report[field])r.report[field]=old.report[field]||null;
        db.prepare('UPDATE daily_report SET updated_at=?,'+reportFields.map(k=>k+'=?').join(',')+' WHERE id=?').run(stamp,...reportFields.map(k=>r.report[k]),id);
        db.prepare('DELETE FROM daily_item WHERE report_id=?').run(id);
      }else id=Number(db.prepare('INSERT INTO daily_report(created_at,updated_at,'+reportFields.join(',')+') VALUES('+Array(reportFields.length+2).fill('?').join(',')+')').run(stamp,stamp,...reportFields.map(k=>r.report[k])).lastInsertRowid);
      for(const [order,input] of r.items.entries()) {
        const row=blocks.canonical('daily_item',input);
        const prior=old.items.find(x=>x.aktivitas===row.aktivitas&&x.blok===row.blok);
        if(!row.keterangan&&prior?.keterangan)row.keterangan=prior.keterangan;
        db.prepare('INSERT INTO daily_item(created_at,updated_at,report_id,urutan,'+itemFields.join(',')+',block_id,block_name_snapshot) VALUES('+Array(itemFields.length+6).fill('?').join(',')+')').run(stamp,stamp,id,order+1,...itemFields.map(k=>row[k]),row.block_id||null,prior?.block_name_snapshot||input.blok);
      }
      result.reports.push({key:r.key,id});
    }
    blocks.linkTable('daily_item');
    db.prepare('INSERT INTO _daily_transfer_batches VALUES(?,?,?,?)').run(fingerprint,now(),actor,JSON.stringify(result));
  });
  return result;
}
