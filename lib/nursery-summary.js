export function nurserySummary(db){
 const batches=db.prepare('SELECT * FROM pisang_bibit ORDER BY tanggal_datang,id').all();
 const totals={incoming:0,splitting:0,planted:0,rejected:0,mortality:0,balance:0,batches:batches.length,negativeBatches:0},clones=new Map();
 for(const r of batches){const balance=Number(r.qty_datang||0)+Number(r.splitting||0)-Number(r.ditanam||0)-Number(r.afkir||0)-Number(r.mortal||0);for(const [key,field] of Object.entries({incoming:'qty_datang',splitting:'splitting',planted:'ditanam',rejected:'afkir',mortality:'mortal'}))totals[key]+=Number(r[field]||0);totals.balance+=balance;if(balance<0)totals.negativeBatches++;const name=r.klon||'Belum diisi',c=clones.get(name)||{name,balance:0,batches:0};c.balance+=balance;c.batches++;clones.set(name,c);}
 return {...totals,clones:[...clones.values()]};
}
