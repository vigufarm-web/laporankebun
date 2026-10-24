import {nurserySummary} from './nursery-summary.js';
import {weeklyWorkSections} from './owner-weekly.js';
const n=v=>v==null?'Belum tercatat':Number(v).toLocaleString('id-ID',{maximumFractionDigits:2});
function grouped(records,keys,values){
 const rows=new Map();for(const record of records){const labels=keys.map(k=>String(record[k]??'-').trim()),key=JSON.stringify(labels.map(x=>x.toLowerCase()));let r=rows.get(key);if(!r){r={labels,values:values.map(()=>null)};rows.set(key,r);}for(const [i,field] of values.entries())if(record[field]!=null&&record[field]!=='')r.values[i]=(r.values[i]??0)+Number(record[field]);}
 return [...rows.values()].map(r=>[...r.labels,...r.values.map(n)]);
}
export function ownerSections({db,from,to,climate,work=[]}){
 const period=t=>db.prepare(`SELECT * FROM "${t}" WHERE tanggal BETWEEN ? AND ? ORDER BY tanggal,id`).all(from,to),sections=weeklyWorkSections(work);
 const add=(title,headers,rows,note='')=>{if(rows.length)sections.push({title,headers,weights:headers.map((_,i)=>i===0?2:1),rows,note});};
 add('Panen pisang - total minggu',['Blok','Tandan'],grouped(period('pisang_panen_pkk'),['blok'],['pkk_panen']));
 add('Packing pisang - total minggu',['Blok','Box'],grouped(period('pisang_box'),['blok'],['jumlah_box']));
 add('Panen padi - total minggu',['Petak','GKP kg','Karung'],grouped(period('padi_panen'),['petak'],['gkp_kg','jumlah_karung']));
 for(const [table,label] of [['pisang_penjualan','pisang'],['padi_penjualan','padi']]){
  const records=period(table).filter(r=>!['Mutasi Internal','Ongkir'].includes(r.tipe)).map(r=>({...r,tipe:r.tipe||'Penjualan',nilai:table==='pisang_penjualan'?(r.nominal!=null&&r.nominal!==''?Number(r.nominal):Number(r.harga||0)*(Number(r.jumlah_box)||Number(r.berat_kg)||0)):Number(r.nominal??Number(r.berat_kg||0)*Number(r.harga_kg||0)),dibayar:Number(r.dibayar||0)}));
  add('Penjualan '+label+' - total minggu',['Tipe','Nilai Rp'],grouped(records,['tipe'],['nilai']));
 }
 // Preserve the standalone exported helper's historical use without requiring
 // Daily payloads; callers with a weekly model already have this section.
 if(!sections.some(s=>s.title==='Progres lahan'))add('Progres lahan',['Kegiatan','Hasil minggu ha'],grouped(period('lahan_harian').filter(r=>!r.diganti_aktual&&Number(r.hasil_ha)>0&&!String(r.source_key||'').startsWith('baseline:')&&!['Cabut Ajir','Cabut Mulsa','Gulung Drip'].includes(r.aktivitas)),['aktivitas'],['hasil_ha']));
 add('Mutasi benih padi - total minggu',['Varietas','Jenis','Jumlah kg'],grouped(period('padi_benih'),['varietas','jenis'],['qty_kg']));
 add('Budidaya padi - total minggu',['Kegiatan','Bahan','HK'],grouped(period('padi_kegiatan'),['kegiatan','bahan'],['hk']),'HK ini dari catatan budidaya dan tidak ditambahkan lagi ke HK Daily. Jumlah bahan tanpa satuan yang jelas tidak dijumlahkan.');
 const opt=period('padi_opt'),observations=grouped(opt.map(r=>({...r,n:1})),['jenis_opt','tindakan'],['n']);add('Pengamatan OPT padi',['OPT','Tindakan','Catatan'],observations);
 if(climate?.days?.length)add('Iklim - rekap minggu',['Hujan mm','Hari tercatat','Pengamatan'],[[n(climate.rain),n(climate.days.length),n(climate.observations)]],'Hujan dijumlahkan dari nilai kumulatif maksimum setiap hari. Data kosong tidak dianggap nol.');
 const nursery=nurserySummary(db);add('Saldo bibit saat dicetak',['Klon','Batch','Saldo pokok'],nursery.clones.map(x=>[x.name,n(x.batches),n(x.balance)]),'Saldo seluruh tanggal, bukan penambahan minggu ini.');
 return sections;
}
