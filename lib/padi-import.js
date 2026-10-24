import crypto from 'node:crypto';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents=value=>Math.round(Number(value)*100);
function invalid(message){const error=new Error(message);error.status=400;throw error;}

export function importPadi({db,tx,blocks,insertRow,now,actor},body) {
  const source=body.payload;
  if(!source||!Array.isArray(source.harvest)||!Array.isArray(source.transfers)||source.harvest.length+source.transfers.length>200)invalid('Paket panen tidak valid');
  const items=[],seen=new Set();
  for(const [kind,rows] of [['harvest',source.harvest],['transfers',source.transfers]])for(const input of rows) {
    const table=kind==='harvest'?'padi_panen':'padi_penjualan',field=kind==='harvest'?'gkp_kg':'berat_kg';
    const date=String(input.tanggal||''),weight=Number(input[field]);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)invalid('Tanggal tidak valid');
    if(!Number.isFinite(weight)||weight<=0||Math.abs(weight*100-cents(weight))>0.00001)invalid('Berat harus positif, dalam kg, maksimal dua desimal');
    const row=blocks.canonical(table,{tanggal:date,petak:String(input.petak||'').trim(),[field]:cents(weight)/100,detail_timbang:String(input.detail_timbang||'').trim().slice(0,4000),keterangan:String(input.keterangan||'').slice(0,2000)});
    if(!db.prepare('SELECT 1 FROM padi_petak WHERE nama_petak=?').get(row.petak))invalid('Petak belum dikenali: '+row.petak);
    if(row.detail_timbang){const weights=row.detail_timbang.split(';').map(x=>Number(x.trim().replace(',','.')));if(weights.some(x=>!Number.isFinite(x)||x<=0)||weights.reduce((sum,x)=>sum+cents(x),0)!==cents(weight))invalid('Rincian timbang berbeda dengan total '+row.petak+' '+date);}
    if(kind==='transfers')Object.assign(row,{tipe:'Mutasi Internal',jenis:'GKG',pembeli:'PH',harga_kg:null,nominal:null,dibayar:null});
    const key=kind+'|'+date+'|'+row.petak;if(seen.has(key))invalid('Tanggal/petak berulang dalam paket');seen.add(key);
    items.push({kind,table,field,key,row});
  }
  const existing={padi_panen:db.prepare('SELECT * FROM padi_panen ORDER BY id').all(),padi_penjualan:db.prepare('SELECT * FROM padi_penjualan ORDER BY id').all()};
  const fingerprint=hash(items),token=hash({items,existing});
  db.exec('CREATE TABLE IF NOT EXISTS _padi_import_batches(fingerprint TEXT PRIMARY KEY,created_at TEXT,actor TEXT,source_json TEXT,result_json TEXT)');
  const prior=db.prepare('SELECT result_json FROM _padi_import_batches WHERE fingerprint=?').get(fingerprint);
  if(prior)return {...JSON.parse(prior.result_json),already_applied:true};
  const preview=items.map(item=>{
    const matches=existing[item.table].filter(row=>row.tanggal===item.row.tanggal&&row.petak===item.row.petak&&(item.kind==='harvest'||row.tipe==='Mutasi Internal'&&row.jenis==='GKG'));
    const exact=matches.find(row=>cents(row[item.field])===cents(item.row[item.field])&&String(row.detail_timbang||'').trim()===item.row.detail_timbang);
    return {key:item.key,tanggal:item.row.tanggal,petak:item.row.petak,jenis:item.kind==='harvest'?'GKP':'GKG ke PH',kg:item.row[item.field],action:exact?'Sudah ada':matches.length?'Konflik':'Tambah'};
  });
  const totals={gkpKg:items.filter(x=>x.kind==='harvest').reduce((s,x)=>s+cents(x.row.gkp_kg),0)/100,gkgKg:items.filter(x=>x.kind==='transfers').reduce((s,x)=>s+cents(x.row.berat_kg),0)/100};
  if(body.mode!=='apply')return {token,preview,totals};
  if(body.token!==token){const error=new Error('Data panen berubah. Periksa ulang sebelum menerapkan.');error.status=409;throw error;}
  if(preview.some(x=>x.action==='Konflik'))invalid('Ada panen/mutasi dengan tanggal dan petak yang sama. Data lama dipertahankan; periksa konflik dahulu.');
  const result={added:0,skipped:0,totals};
  tx(()=>{
    for(const [i,item] of items.entries())if(preview[i].action==='Tambah'){insertRow(item.table,item.row,false);result.added++;}else result.skipped++;
    blocks.linkTable('padi_panen');blocks.linkTable('padi_penjualan');
    db.prepare('INSERT INTO _padi_import_batches VALUES(?,?,?,?,?)').run(fingerprint,now(),actor,JSON.stringify(source),JSON.stringify(result));
  });
  return result;
}
