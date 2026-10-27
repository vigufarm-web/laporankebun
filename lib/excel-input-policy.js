const masterName={pisang_blok:'nama_blok',padi_petak:'nama_petak',lahan_blok:'blok'};
export const referenceSheets=new Set(['lahan_rencana','padi_rencana']);
const systemFields=new Set(['hasil_input_ha','diganti_aktual','source_key','daily_report_id']);
export const isExcelSystemField=k=>systemFields.has(k);
export function isExcelReference(table,k){return k.startsWith('_')||referenceSheets.has(table)||k==='luas_ha'&&!!masterName[table]||table==='lahan_blok'&&['kepemilikan','peruntukan','target_tanam'].includes(k);}
export const sheetInputGuides={
 pisang_blok:'Isi tanggal tanam, pokok, varietas, kehilangan dan sulam. Pilih blok GIS; luas blok mengikuti GIS, bukan diketik ulang.',
 pisang_bibit:'Satu baris per kelompok kedatangan. Isi datang, tambahan splitting, total afkir/mati dan total ditanam per kelompok. Saldo dihitung aplikasi. Umur bibit membedakan kelompok pada tanggal yang sama.',
 pisang_panen_pkk:'Isi tanggal, blok dan jumlah pokok/tandan dipanen. Ini bukan box hasil packing.',
 pisang_box:'Isi hasil packing per tanggal, kelas dan bentuk. Box hasil packing berbeda dengan box yang terjual.',
 pisang_estimasi:'Isi estimasi total box per bulan. Rincian kelas A/B/C opsional; jangan mengisi ulang total jika rincian sudah lengkap.',
 pisang_handclass:'Isi hasil pengamatan sisir per tandan dan jumlah sampel, bukan jumlah panen.',
 pisang_penjualan:'Isi tanggal/SJ, pembeli, bentuk, kelas, kondisi, jumlah dan harga. Jenis Barang terbentuk otomatis; nominal dihitung jika kosong. Jangan mengisi ulang data packing sebagai penjualan.',
 padi_petak:'Pilih petak GIS; isi status, sumber air dan catatan perubahan. Luas petak mengikuti GIS.',
 padi_benih:'Isi tiap mutasi benih sekali: masuk, pakai atau afkir per varietas. Saldo bukan isian manual.',
 padi_panen:'Isi hasil timbang GKP dan GKG pada tahap masing-masing. Isi total GKG sekali per panen, jangan diulang setiap timbang. GKG berbeda dari beras.',
 padi_giling:'Isi beras yang benar-benar dihasilkan saat giling dan gabah yang digiling jika diketahui. Jangan menyalin berat GKG menjadi beras.',
 padi_penjualan:'Isi beras yang benar-benar dijual/retur dan harga/kg. Nominal dihitung jika kosong. Mutasi GKG ke PH bukan penjualan beras.',
 padi_rencana:'REFERENSI DATA LAMA. Rencana dan realisasi mingguan diisi melalui Daily Report, tidak diulang di Excel ini.',
 lahan_blok:'Pilih blok GIS dan isi catatan/saldo pekerjaan awal bila perlu. Luas, komoditas dan kepemilikan mengikuti GIS; target bulan cukup di Target Tanam.',
 lahan_harian:'Isi satu hasil pekerjaan harian per tanggal, blok dan aktivitas. Hasil ha = luas yang dikerjakan hari itu, bukan luas seluruh blok. Baris dari Daily tidak diinput ulang.',
 lahan_target:'Isi sekali per blok: bulan target tanam, mulai paling awal dan prioritas bila perlu. Tidak perlu mengisi luas di sini.',
 lahan_rencana:'REFERENSI OTOMATIS. Jadwal disusun aplikasi dari target, sisa pekerjaan, kecepatan dan alat; tidak diinput ulang.',
 lahan_aktivitas:'PENGATURAN, bukan isian harian. Ubah hanya jika urutan, kecepatan, tim atau alat berubah.',
 iklim:'Isi hasil sensor per tanggal dan jam sekali. Curah hujan harian memakai nilai kumulatif terbesar; tidak dijumlahkan antarjam.'
};
export function excelField(table,f){
 const hint=[f.hint,table==='lahan_harian'&&f.k==='hasil_ha'?'Ha pekerjaan pada tanggal ini; 1 ha = 10.000 m². Jangan isi luas blok berulang.':null,f.k==='luas_ha'&&masterName[table]?'REFERENSI GIS: luas seluruh blok, bukan isian admin.':null,isExcelReference(table,f.k)?'Referensi otomatis; perubahan sel ini tidak diterapkan melalui Excel.':null].filter(Boolean).join(' ');
 const labels={lahan_harian:{hasil_ha:'Hasil pekerjaan tanggal ini (ha)'},pisang_bibit:{ditanam:'Total ditanam dari batch (pokok)',mortal:'Total bibit mati (pokok)',afkir:'Total bibit afkir (pokok)'},lahan_blok:{target_tanam:'Target tanam (referensi)'}};
 const l=f.k==='luas_ha'&&masterName[table]?'Luas blok GIS (ha) — otomatis':labels[table]?.[f.k]||f.l;
 return {...f,l,aliases:[f.l],req:isExcelReference(table,f.k)?false:f.req,hint};
}
export function prepareExcelInput(table,input,old,{findBlock,targets=[]}={}){
 const row={...input};for(const k of Object.keys(row))if(isExcelSystemField(k))delete row[k];
 const field=masterName[table];
 if(field){const block=findBlock?.(input[field]);for(const k of ['luas_ha',...(table==='lahan_blok'?['kepemilikan','peruntukan','target_tanam']:[])]){
  if(old){delete row[k];continue;}
  if(k==='luas_ha')row[k]=block?.luas_ha;
  if(k==='kepemilikan')row[k]=block?.ownership;
  if(k==='peruntukan')row[k]=block?.divisi;
  if(k==='target_tanam')row[k]=targets.find(t=>t.blok===input[field])?.bulan||null;
 }if(!old&&(!block||!(Number(block.luas_ha)>0)))throw Error('Blok baru harus dipilih dari GIS yang memiliki luas. Perbarui GIS dahulu; luas tidak perlu diketik di Excel.');}
 // Omitted fields on an old row retain their value, including hidden source linkage.
 if(['pisang_penjualan','padi_penjualan'].includes(table)&&old){
  const amount=r=>table==='pisang_penjualan'?Number(r.jumlah_box||r.berat_kg||0)*Number(r.harga||0):Number(r.berat_kg||0)*Number(r.harga_kg||0);
  if(Number(input.nominal)===Number(old.nominal)&&Math.abs(Number(old.nominal)-amount(old))<0.005&&Math.abs(amount(input)-amount(old))>0.005)row.nominal=null;
 }
 return old?{...old,...row}:row;
}
export function capExcelLandChanges(ops,current,findBlock){
 const changed=new Set(ops.map(o=>o.id).filter(Boolean)),used=new Map(),key=r=>String(r.blok||'').trim().toLowerCase()+'|'+String(r.aktivitas||'').trim().toLowerCase(),warnings=[];
 for(const r of current)if(!changed.has(r.id)&&!r.diganti_aktual)used.set(key(r),(used.get(key(r))||0)+Math.max(0,Number(r.hasil_ha)||0));
 for(const op of [...ops].sort((a,b)=>String(a.row.tanggal).localeCompare(String(b.row.tanggal))||(a.id||0)-(b.id||0))){
  const r=op.row;if(r.diganti_aktual)continue;const b=findBlock(r.blok),area=Number(b?.luas_ha);if(!(area>0))throw Error('Luas GIS belum tersedia untuk blok '+r.blok+'. Perbarui GIS dahulu.');
  const input=Number(r.hasil_ha);if(!(input>=0))throw Error('Hasil ha tidak boleh negatif.');const k=key(r),recognized=Math.min(input,Math.max(0,area-(used.get(k)||0)));
  if(recognized<input-1e-8){r.hasil_input_ha=input;r.hasil_ha=recognized;warnings.push(r.blok+' · '+r.aktivitas+': hasil '+input+' ha disesuaikan menjadi '+recognized+' ha sesuai sisa luas GIS.');}
  used.set(k,(used.get(k)||0)+recognized);
 }return warnings;
}
