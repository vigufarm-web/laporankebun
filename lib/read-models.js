// Small, read-only responses for overview pages and server-side pagination.
export function createReadModels({db,TABLES,nominalJual,isJual,iklimHarian}) {
  const q=s=>'"'+s.replaceAll('"','')+'"';
  const rows=t=>db.prepare(`SELECT * FROM ${q(t)}`).all();
  const sum=(xs,k)=>xs.reduce((s,x)=>s+Number(typeof k==='function'?k(x):x[k]||0),0);
  function climate(from,to) {
    const raw=db.prepare('SELECT * FROM iklim WHERE tanggal BETWEEN ? AND ? ORDER BY tanggal,jam').all(from,to);
    const days=iklimHarian(raw);
    return {from,to,days,observations:raw.length,missingRain:raw.filter(x=>x.hujan_mm==null).length,rainDays:days.filter(x=>x.hujan!=null&&x.hujan>=1).length,rain:days.some(x=>x.hujan!=null)?sum(days,'hujan'):null,missingDays:days.filter(x=>x.hujan==null).length};
  }
  function overview({from,to,today,blocks}) {
    const period=t=>TABLES[t].date?db.prepare(`SELECT * FROM ${q(t)} WHERE ${q(TABLES[t].date)} BETWEEN ? AND ?`).all(from,to):rows(t);
    const owned=blocks.filter(x=>x.active&&x.layer_id&&x.ownership==='Sudah milik kebun');
    const sales=t=>{const rs=period(t), sold=rs.filter(isJual);return {revenue:sum(sold,r=>nominalJual(r)),paid:sum(sold,'dibayar'),outstanding:sum(sold,r=>nominalJual(r)-Number(r.dibayar||0)),rows:rs.length};};
    // Padi uses its own price/kg fields; preserve existing nominal when present.
    const padiSales=period('padi_penjualan').filter(isJual);
    const padiNom=r=>r.nominal!=null?Number(r.nominal):Number(r.berat_kg||0)*Number(r.harga_kg||0);
    const bibit=rows('pisang_bibit');const benih=rows('padi_benih'),varieties=[...new Set(benih.map(x=>x.varietas))];
    const daily=db.prepare('SELECT divisi,status,tanggal,kendala FROM daily_report WHERE tanggal=?').all(today);
    const weather=climate(from,to),recent=Object.keys(TABLES).filter(t=>!t.startsWith('daily_')&&t!=='gis_layer').map(t=>({table:t,title:TABLES[t].title,...db.prepare(`SELECT COUNT(*) count,MAX(updated_at) updated FROM ${q(t)}`).get()}));
    const missingDates=db.prepare("SELECT COUNT(*) n FROM pisang_blok WHERE (pokok_tanam>0 OR tanggal_tanam IS NOT NULL) AND (tanggal_tanam IS NULL OR pokok_tanam IS NULL)").get().n;
    const padiConflict=rows('padi_petak').filter(x=>x.status==='Sudah Tanam'&&/Sudah Panen/i.test(x.keterangan||'')).map(x=>x.nama_petak);
    return {from,to,today,blocks:{owned:owned.length,unverified:blocks.filter(x=>x.active&&x.ownership==='Belum diverifikasi').length,inactive:blocks.filter(x=>!x.active).length},daily,
      pisang:{harvest:sum(period('pisang_panen_pkk'),'pkk_panen'),boxes:sum(period('pisang_box'),'jumlah_box'),kg:sum(period('pisang_box'),'berat_kg'),stock:sum(bibit,r=>Number(r.qty_datang||0)-Number(r.afkir||0)+Number(r.splitting||0)-Number(r.mortal||0)-Number(r.ditanam||0)),sales:sales('pisang_penjualan')},
      padi:{gkgSentKg:sum(period('padi_penjualan').filter(r=>r.tipe==='Mutasi Internal'&&r.jenis==='GKG'),'berat_kg'),harvestKg:sum(period('padi_panen'),'gkp_kg'),legacyHarvestKg:sum(rows('padi_panen').filter(x=>!x.tanggal),'gkp_kg'),milledKg:sum(period('padi_giling'),'beras_kg'),sales:{revenue:sum(padiSales,padiNom),paid:sum(padiSales,'dibayar'),outstanding:sum(padiSales,r=>padiNom(r)-Number(r.dibayar||0))},stocks:varieties.map(varietas=>({varietas,kg:sum(benih.filter(x=>x.varietas===varietas),r=>(r.jenis==='Masuk'?1:-1)*Number(r.qty_kg||0))}))},
      infra:{activities:period('lahan_harian').length,blocks:new Set(period('lahan_harian').map(x=>x.block_id||x.blok)).size},
      climate:weather,quality:{missingDates,padiConflict,unverifiedBlocks:blocks.filter(x=>x.active&&x.ownership==='Belum diverifikasi').length},recent};
  }
  function records(table,params) {
    const T=TABLES[table];if(!T)throw new Error('Tabel tidak dikenal');
    const limit=Math.min(100,Math.max(1,Number(params.get('limit'))||50)),offset=Math.max(0,Number(params.get('offset'))||0);
    const fields=T.f.filter(f=>f.t!=='calc').map(f=>f.k),conditions=[],args=[];
    if(T.date&&params.get('from')){conditions.push(`${q(T.date)}>=?`);args.push(params.get('from'));}
    if(T.date&&params.get('to')){conditions.push(`${q(T.date)}<=?`);args.push(params.get('to'));}
    if(params.get('q')){conditions.push('('+fields.map(f=>`CAST(${q(f)} AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ')+')');const search=params.get('q').replace(/[\\%_]/g,'\\$&');args.push(...fields.map(()=>'%'+search+'%'));}
    const where=conditions.length?' WHERE '+conditions.join(' AND '):'',sort=params.get('sort')||T.sort||'-id',sortKey=sort.replace(/^-/,'');
    const validSort=fields.includes(sortKey)||sortKey==='id'?sortKey:'id',direction=sort.startsWith('-')?'DESC':'ASC';
    const total=db.prepare(`SELECT COUNT(*) n FROM ${q(table)}${where}`).get(...args).n;
    const data=db.prepare(`SELECT * FROM ${q(table)}${where} ORDER BY ${q(validSort)} ${direction},id LIMIT ? OFFSET ?`).all(...args,limit,offset);
    const cache=new Map(),ctx={rows:t=>{if(!cache.has(t))cache.set(t,rows(t));return cache.get(t);}};
    for(const r of data)for(const f of T.f.filter(f=>f.t==='calc'))try{r[f.k]=f.fn(r,ctx);}catch{r[f.k]=null;}
    return {rows:data,total,limit,offset};
  }
  return {overview,climate,records};
}
