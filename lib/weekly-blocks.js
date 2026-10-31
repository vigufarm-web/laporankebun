export function weeklyBlockBreakdown(rows,{activity,from,to,names}){
 const grouped=new Map();
 for(const row of rows){
  if(!row.tanggal||row.diganti_aktual||row.aktivitas!==activity||row.tanggal<from||row.tanggal>to||!names.has(String(row.blok).toLowerCase()))continue;
  const ha=Number(row.hasil_ha)||0;if(ha<=0)continue;
  const key=String(row.blok).toLowerCase(),entry=grouped.get(key)||{name:row.blok,ha:0};entry.ha+=ha;grouped.set(key,entry);
 }
 return [...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name,'id',{numeric:true}));
}
