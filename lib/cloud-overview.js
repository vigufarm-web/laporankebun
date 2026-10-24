// Aggregate in Turso: overview requests never download transaction rows or GIS geometry.
export async function cloudOverview(cloud,{from,to,today,TABLES}){
 const banana="CASE WHEN nominal IS NOT NULL AND nominal<>'' THEN nominal ELSE coalesce(harga,0)*coalesce(nullif(jumlah_box,0),berat_kg,0) END",paddy='coalesce(nominal,coalesce(berat_kg,0)*coalesce(harga_kg,0))';
 const sales=(table,expression)=>({sql:`SELECT coalesce(sum(CASE WHEN tanggal BETWEEN ? AND ? THEN ${expression} ELSE 0 END),0) revenue,coalesce(sum(CASE WHEN tanggal BETWEEN ? AND ? THEN dibayar ELSE 0 END),0) paid,coalesce(sum(${expression}),0) allTimeRevenue FROM ${table} WHERE coalesce(tipe,'') NOT IN ('Mutasi Internal','Ongkir')`,args:[from,to,from,to]});
 const query=[sales('pisang_penjualan',banana),sales('padi_penjualan',paddy),{sql:'SELECT coalesce(sum(jumlah_box),0) boxes,coalesce(sum(berat_kg),0) kg FROM pisang_box WHERE tanggal BETWEEN ? AND ?',args:[from,to]},
 {sql:'SELECT coalesce(sum(gkp_kg),0) harvestKg FROM padi_panen WHERE tanggal BETWEEN ? AND ?',args:[from,to]},
 {sql:"SELECT coalesce(sum(gkp_kg),0) legacyHarvestKg FROM padi_panen WHERE tanggal IS NULL OR tanggal=''"},
 {sql:'SELECT coalesce(sum(beras_kg),0) milledKg FROM padi_giling WHERE tanggal BETWEEN ? AND ?',args:[from,to]},
 {sql:"SELECT coalesce(sum(berat_kg),0) gkgSentKg FROM padi_penjualan WHERE tipe='Mutasi Internal' AND jenis='GKG' AND tanggal BETWEEN ? AND ?",args:[from,to]},
 {sql:'SELECT coalesce(sum(pkk_panen),0) harvest FROM pisang_panen_pkk WHERE tanggal BETWEEN ? AND ?',args:[from,to]},
 {sql:'SELECT coalesce(sum(coalesce(qty_datang,0)-coalesce(afkir,0)+coalesce(splitting,0)-coalesce(mortal,0)-coalesce(ditanam,0)),0) stock FROM pisang_bibit'},
 {sql:"SELECT varietas,coalesce(sum(CASE WHEN jenis='Masuk' THEN coalesce(qty_kg,0) ELSE -coalesce(qty_kg,0) END),0) kg FROM padi_benih GROUP BY varietas"},
 {sql:'SELECT count(*) observations,sum(hujan_mm IS NULL) missingRain FROM iklim WHERE tanggal BETWEEN ? AND ?',args:[from,to]},
 {sql:'SELECT tanggal,count(*) n,min(suhu_luar) tmin,max(suhu_luar) tmax,avg(suhu_luar) tavg,avg(lembap_luar) havg,max(angin_ms) wmax,avg(angin_ms) wavg,max(hujan_mm) hujan FROM iklim WHERE tanggal BETWEEN ? AND ? GROUP BY tanggal ORDER BY tanggal',args:[from,to]}];
 return cloud.snapshot(async read=>{
  const values=await read(query),one=i=>values[i][0]||{},salesResult=i=>({...one(i),outstanding:Number(one(i).revenue)-Number(one(i).paid)});
  const days=values[11],climate={from,to,days,observations:Number(one(10).observations),missingRain:Number(one(10).missingRain||0),rainDays:days.filter(d=>d.hujan!=null&&d.hujan>=1).length,rain:days.some(d=>d.hujan!=null)?days.reduce((s,d)=>s+Number(d.hujan||0),0):null,missingDays:days.filter(d=>d.hujan==null).length};
  return {from,to,today,pisang:{...one(2),...one(7),...one(8),sales:salesResult(0)},padi:{...one(3),...one(4),...one(5),...one(6),stocks:values[9],sales:salesResult(1)},climate};
 });
}
