const norm=v=>String(v??'').trim().replace(/\s+/g,' ').toUpperCase();
const num=v=>Number(v)||0;
export function sortSalesRows(table,rows){
 if(!['pisang_penjualan','padi_penjualan'].includes(table))return rows;
 return [...rows].sort((a,b)=>String(a.tanggal||'9999').localeCompare(String(b.tanggal||'9999'))||norm(a.no_sj).localeCompare(norm(b.no_sj),'id',{numeric:true})||num(a.id)-num(b.id));
}
export function salesImportDecision(table,row,current,pending=[]){
 if(!['pisang_penjualan','padi_penjualan'].includes(table)||!norm(row.no_sj))return {kind:'allow'};
 const fields=['tanggal','no_sj','pembeli','tipe',...(table==='pisang_penjualan'?['jenis_barang','bentuk','kelas','kondisi']:['jenis'])];
 const key=r=>fields.map(k=>norm(k==='tipe'?(r[k]||'Penjualan'):r[k])).join('|');
 const amount=r=>r.nominal!=null&&r.nominal!==''?num(r.nominal):table==='pisang_penjualan'?num(r.harga)*(num(r.jumlah_box)||num(r.berat_kg)):num(r.harga_kg)*num(r.berat_kg);
 const metrics=r=>[num(r.jumlah_box),num(r.berat_kg),num(r.harga??r.harga_kg),amount(r),num(r.dibayar)];
 const hits=[...current,...pending].filter(r=>key(r)===key(row));
 if(!hits.length)return {kind:'allow'};
 if(hits.some(r=>metrics(r).every((v,i)=>Math.abs(v-metrics(row)[i])<.005)))return {kind:'skip'};
 return {kind:'conflict',ids:hits.map(r=>r.id).filter(Boolean)};
}
