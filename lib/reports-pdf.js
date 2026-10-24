import {nurserySummary} from './nursery-summary.js';
import { PDFDocument } from 'pdfkit';

const text=v=>String(v??'-').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7E\n\r\t\u00A0-\u00FF]/g,'');
const number=v=>v==null||v===''?'-':Number(v).toLocaleString('id-ID',{maximumFractionDigits:2});
const money=v=>'Rp '+number(v);
const date=v=>v?new Date(v+'T00:00:00+07:00').toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}):'-';

export function buildReportPDF({name='PT VIGU FARM INDONESIA',from,to,reports,summary=null,sections=[],owner=false,createdBy=''}) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margins:{top:64,bottom:52,left:44,right:44},bufferPages:true,info:{Title:owner?'Laporan Operasional Kebun':'Daily Report Kebun',Author:name,Subject:`${from} - ${to}`}}),chunks=[];
    doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const width=doc.page.width-88,green='#24563D',muted='#6A786E';
    function header(){doc.font('Helvetica-Bold').fontSize(9).fillColor(green).text(text(name),44,29,{width,lineBreak:false});doc.font('Helvetica').fontSize(8).fillColor(muted).text('LAPORAN OPERASIONAL KEBUN',44,42,{width,lineBreak:false});doc.moveTo(44,56).lineTo(doc.page.width-44,56).strokeColor('#D7E2D8').stroke();doc.y=72;}
    doc.on('pageAdded',()=>{doc.y=72;});doc.y=72;
    function ensure(height){if(doc.y+height>doc.page.height-58)doc.addPage();}
    function heading(label){ensure(54);doc.moveDown(.7);doc.font('Helvetica-Bold').fontSize(13).fillColor(green).text(text(label),44,doc.y,{width});doc.moveDown(.5);}
    function paragraph(label,value){if(!value)return;ensure(38);doc.font('Helvetica-Bold').fontSize(9).fillColor(green).text(text(label),44,doc.y,{width});doc.moveDown(.2);doc.font('Helvetica').fontSize(9).fillColor('#37483D').text(text(value),44,doc.y,{width,lineGap:3});doc.moveDown(.6);}
    function table(headers,rows,weights){
      const total=weights.reduce((a,b)=>a+b,0),widths=weights.map(w=>w/total*width);let y=doc.y;
      const drawHeader=()=>{y=doc.y;doc.rect(44,y,width,27).fill('#EDF3EA');let x=44;headers.forEach((h,i)=>{doc.font('Helvetica-Bold').fontSize(8).fillColor(green).text(text(h),x+6,y+8,{width:widths[i]-12,lineBreak:false});x+=widths[i];});doc.y=y+27;};
      ensure(65);drawHeader();
      if(!rows.length)rows=[headers.map((_,i)=>i===0?'Tidak ada data pada periode ini.':'')];
      for(const row of rows){doc.font('Helvetica').fontSize(8);const height=Math.max(30,...row.map((v,i)=>doc.heightOfString(text(v),{width:widths[i]-12,lineGap:2})+14));if(doc.y+height>doc.page.height-58){doc.addPage();drawHeader();}y=doc.y;let x=44;row.forEach((v,i)=>{doc.font('Helvetica').fontSize(8).fillColor('#2D4032').text(text(v),x+6,y+7,{width:widths[i]-12,lineGap:2});x+=widths[i];});doc.moveTo(44,y+height).lineTo(44+width,y+height).strokeColor('#E3E9DF').lineWidth(.5).stroke();doc.y=y+height;}
      doc.y+=12;
    }
    doc.font('Helvetica-Bold').fontSize(27).fillColor(green).text(owner?'Laporan Kebun':'Daily Report',44,doc.y,{width});doc.moveDown(.3);doc.font('Helvetica').fontSize(11).fillColor(muted).text(`${date(from)} - ${date(to)}`,44,doc.y,{width});doc.moveDown(.7);
    if(owner&&summary){heading('01 / Ringkasan operasional');table(['Indikator','Nilai','Keterangan'],[
      ['Blok milik kebun',number(summary.blocks.owned),'Blok GIS aktif dan terverifikasi'],['Panen pisang',number(summary.pisang.harvest)+' tandan','Periode terpilih'],['Hasil packing pisang',number(summary.pisang.boxes)+' box',number(summary.pisang.kg)+' kg'],['Panen padi',number(summary.padi.harvestKg)+' kg','Gabah kering panen'],['Penjualan pisang',money(summary.pisang.sales.revenue),'Mutasi internal dan ongkir tidak dihitung'],['Penjualan padi',money(summary.padi.sales.revenue),'Periode terpilih'],['Saldo tagihan penjualan pisang',money(summary.pisang.sales.outstanding),'Transaksi pada periode; pembayaran sesuai data terbaru'],['Saldo tagihan penjualan padi',money(summary.padi.sales.outstanding),'Transaksi pada periode; pembayaran sesuai data terbaru'],['Stok bibit pisang saat dicetak',number(summary.pisang.stock)+' pokok','Saldo seluruh transaksi yang tercatat'],['Curah hujan tercatat',summary.climate.rain==null?'Belum tercatat':number(summary.climate.rain)+' mm',summary.climate.days.length+' hari pengamatan; hujan kosong tidak dianggap nol']
    ],[40,27,40]);paragraph('Perlu diperiksa',`${summary.quality.unverifiedBlocks} blok belum diverifikasi kepemilikannya. ${summary.quality.missingDates} data tanaman pisang perlu dilengkapi.${summary.quality.padiConflict.length?' Status padi berbeda dengan catatan pada '+summary.quality.padiConflict.join(', ')+'.':''}`);}
    if(owner&&summary)doc.addPage();
    heading(owner?'02 / Daily Report seluruh divisi':'Hasil kerja harian');
    if(!reports.length)paragraph('Status','Belum ada laporan pada periode terpilih.');
    for(const report of reports){ensure(90);doc.font('Helvetica-Bold').fontSize(11).fillColor(green).text(`${date(report.tanggal)} | ${text(report.divisi)} | ${text(report.status)}`,44,doc.y,{width});doc.moveDown(.4);doc.font('Helvetica').fontSize(8).fillColor(muted).text('Penginput: '+text(report.dibuat_oleh||'Arsip lama'),44,doc.y,{width});doc.moveDown(.6);table(['Blok','Kegiatan','HI','SDHI minggu','HK aktual','Rencana minggu'],report.items.map(x=>[x.blok,x.aktivitas,number(x.realisasi)+' '+(x.satuan||''),number(x.hasil_sdhi)+' '+(x.satuan||''),number(x.hk_realisasi),x.target!=null?number(x.target)+' '+(x.satuan||''):x.target_hk_minggu!=null?number(x.target_hk_minggu)+' HK (tenaga)':'Belum ditetapkan']),[65,135,83,83,49,83]);paragraph('Kendala',report.kendala);paragraph('Tindak lanjut',report.tindak_lanjut);paragraph('Dokumentasi',`${report.photos.filter(p=>!p.deleted_at).length} foto aktif tercatat. Foto dapat dilihat oleh pengguna yang berwenang melalui aplikasi.`);}
    for(const [i,section] of sections.entries()){heading(`${String(i+3).padStart(2,'0')} / ${section.title}`);table(section.headers,section.rows,section.weights);if(section.note)paragraph('Catatan',section.note);}
    ensure(80);paragraph('Dasar laporan','Hasil dan target mengikuti catatan transaksi. SDHI merupakan akumulasi dalam minggu yang sama. Angka dengan satuan berbeda tidak dijumlahkan. Nama blok memakai nama GIS terbaru; riwayat tetap terhubung ke ID tetap.');
    paragraph('Waktu cetak',new Date().toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+' WIB'+(createdBy?' | '+createdBy:''));
    const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.page.margins.bottom=0;header();doc.font('Helvetica').fontSize(8).fillColor(muted).text(`VIGU FARM | ${from} - ${to}`,44,doc.page.height-32,{width:width-65,lineBreak:false});doc.text(`${i+1} / ${range.count}`,doc.page.width-100,doc.page.height-32,{width:56,align:'right',lineBreak:false});}
    doc.end();
  });
}

export function ownerSections({db,from,to,climate}) {
  const period=t=>db.prepare(`SELECT * FROM "${t}" WHERE tanggal BETWEEN ? AND ? ORDER BY tanggal,id`).all(from,to).filter(r=>t!=='lahan_harian'||!r.diganti_aktual);
  const sections = [
    {title:'Panen pisang',headers:['Tanggal','Blok','Fase','Pokok panen'],weights:[22,30,20,28],rows:period('pisang_panen_pkk').map(r=>[date(r.tanggal),r.blok,r.fase,number(r.pkk_panen)])},
    {title:'Packing pisang',headers:['Tanggal','Blok','Kelas / bentuk','Box','Berat kg'],weights:[22,25,25,14,20],rows:period('pisang_box').map(r=>[date(r.tanggal),r.blok,[r.kelas,r.bentuk].filter(Boolean).join(' / '),number(r.jumlah_box),number(r.berat_kg)])},
    {title:'Panen padi',headers:['Tanggal','Petak','Gabah kg','Karung'],weights:[25,35,25,20],rows:period('padi_panen').map(r=>[date(r.tanggal),r.petak,number(r.gkp_kg),number(r.jumlah_karung)])},
    {title:'Penjualan pisang',headers:['Tanggal','Surat jalan / pembeli','Tipe','Nilai Rp','Dibayar Rp'],weights:[18,40,21,24,24],rows:period('pisang_penjualan').map(r=>[date(r.tanggal),[r.no_sj,r.pembeli].filter(Boolean).join('\n'),r.tipe,number(r.nominal??Number(r.harga||0)*(Number(r.jumlah_box)||Number(r.berat_kg)||0)),number(r.dibayar)])},
    {title:'Mutasi padi internal',headers:['Tanggal','Petak','Jenis','Tujuan','Berat kg'],weights:[25,25,20,30,25],rows:period('padi_penjualan').filter(r=>r.tipe==='Mutasi Internal').map(r=>[date(r.tanggal),r.petak,r.jenis,r.pembeli,number(r.berat_kg)])},
    {title:'Penjualan padi',headers:['Tanggal','Surat jalan / pembeli','Tipe','Nilai Rp','Dibayar Rp'],weights:[18,40,21,24,24],rows:period('padi_penjualan').filter(r=>r.tipe!=='Mutasi Internal'&&r.tipe!=='Ongkir').map(r=>[date(r.tanggal),[r.no_sj,r.pembeli].filter(Boolean).join('\n'),r.tipe,number(r.nominal??Number(r.berat_kg||0)*Number(r.harga_kg||0)),number(r.dibayar)])},
    {title:'Progres lahan',headers:['Tanggal','Blok','Kegiatan','Hasil ha'],weights:[24,26,45,20],rows:period('lahan_harian').map(r=>[String(r.source_key||'').startsWith('baseline:')?'Saldo s.d. Sep':date(r.tanggal),r.blok,r.aktivitas,number(r.hasil_ha)])},
    {title:'Iklim harian',headers:['Tanggal','Hujan mm','Suhu rata-rata C','Kelembapan %','Pengamatan'],weights:[24,24,29,25,23],rows:climate.days.map(r=>[date(r.tanggal),number(r.hujan),number(r.tavg),number(r.havg),number(r.n)]),note:'Hujan harian memakai nilai kumulatif maksimum sensor pada hari yang sama. Kolom kosong berarti tidak tercatat.'}
  ];
  const lc=period('lahan_harian').filter(r=>!String(r.source_key||'').startsWith('baseline:')&&/^(land\s*clearing|lc)$/i.test(r.aktivitas||''));
  sections.push({title:'Infrastruktur - Land Clearing',headers:['Tanggal','Blok','Realisasi ha'],weights:[30,40,30],rows:lc.map(r=>[date(r.tanggal),r.blok,number(r.hasil_ha)]),note:'Total LC periode: '+number(lc.reduce((s,r)=>s+Number(r.hasil_ha||0),0))+' ha. Saldo sebelum Oktober tidak dihitung sebagai hasil baru.'});
  const nursery=nurserySummary(db);sections.push({title:'Saldo bibit pisang saat dicetak',headers:['Klon','Batch','Saldo pokok'],weights:[40,20,30],rows:nursery.clones.map(x=>[x.name,number(x.batches),number(x.balance)]),note:'Total '+number(nursery.balance)+' pokok. Datang + splitting - ditanam - mortal - afkir; seluruh tanggal.'});
  const specs=[
    ['Stok bibit pisang saat dicetak','pisang_bibit',null,['tanggal_datang','klon','qty_datang','splitting','ditanam','afkir','mortal'],['Tanggal','Klon','Datang','Splitting','Ditanam','Afkir','Mortal']],
    ['Mutasi benih padi','padi_benih','tanggal',['tanggal','varietas','jenis','qty_kg'],['Tanggal','Varietas','Jenis','Jumlah kg']],
    ['Penggilingan padi','padi_giling','tanggal',['tanggal','gudang','gabah_kg','beras_kg'],['Tanggal','Gudang','Gabah kg','Beras kg']],
    ['Siklus tanam padi yang tercatat','padi_tanam',null,['petak','musim','tahun','tgl_tanam','varietas','luas_tanam_ha'],['Petak','Musim','Tahun','Tanggal tanam','Varietas','Luas ha']],
    ['Kegiatan budidaya padi','padi_kegiatan','tanggal',['tanggal','musim_tanam','kegiatan','hk','bahan','qty'],['Tanggal','Petak / musim','Kegiatan','HK','Bahan','Jumlah']],
    ['Pengamatan OPT padi','padi_opt','tanggal',['tanggal','musim_tanam','jenis_opt','tindakan'],['Tanggal','Petak / musim','OPT','Tindakan']],
    ['Detail hand class pisang','pisang_handclass','tanggal',['tanggal','blok','status','jumlah_sampel','rata_hand'],['Tanggal','Blok','Fase','Sampel','Rata-rata']],
    ['Tanaman pisang yang tercatat','pisang_blok',null,['nama_blok','tanggal_tanam','pokok_tanam','status','kehilangan','sulam'],['Blok','Tanggal tanam','Pokok tanam','Status','Kehilangan','Sulam']],
    ['Target tanam yang tercatat','lahan_target',null,['blok','bulan','prioritas'],['Blok','Bulan target','Prioritas']],
  ];
  for(const [title,table,dateField,fields,headers] of specs){const records=dateField?db.prepare('SELECT * FROM "'+table+'" WHERE "'+dateField+'" BETWEEN ? AND ? ORDER BY id').all(from,to):db.prepare('SELECT * FROM "'+table+'" ORDER BY id').all();sections.push({title,headers,weights:fields.map(()=>1),rows:records.map(r=>fields.map(k=>typeof r[k]==='number'?number(r[k]):r[k]??'-')),note:dateField?'Dalam periode terpilih.':'Kondisi data saat dicetak; bukan rekonstruksi saldo historis.'});}
  sections.push({title:'Arsip panen padi tanpa tanggal',headers:['Petak','Gabah kg','Karung'],weights:[40,30,30],rows:db.prepare("SELECT * FROM padi_panen WHERE tanggal IS NULL OR tanggal='' ORDER BY id").all().map(r=>[r.petak,number(r.gkp_kg),number(r.jumlah_karung)]),note:'Arsip lama dipertahankan. Angka ini tidak masuk hasil periode sampai tanggal panen diverifikasi.'});
  const plans=db.prepare('SELECT * FROM lahan_rencana WHERE mulai<=? AND selesai>=? ORDER BY mulai,id').all(to,from);
  sections.push({title:'Rencana kerja lahan',headers:['Blok','Kegiatan','Mulai','Selesai','Luas ha'],weights:[20,40,25,25,20],rows:plans.map(r=>[r.blok,r.aktivitas,date(r.mulai),date(r.selesai),number(r.luas_ha)]),note:'Jadwal yang bersinggungan dengan periode terpilih; luas rencana bukan tambahan realisasi.'});
  const dailyPlans=db.prepare("SELECT p.week_start,p.divisi,p.status,i.* FROM daily_week_plan p JOIN daily_week_item i ON i.plan_id=p.id WHERE p.week_start<=? AND date(p.week_start,'+6 days')>=? ORDER BY p.week_start,p.divisi,i.id").all(to,from);
  sections.push({title:'Rencana mingguan Daily',headers:['Minggu / divisi','Blok','Kegiatan','Target','HK rencana'],weights:[28,20,40,25,22],rows:dailyPlans.map(r=>[date(r.week_start)+' / '+r.divisi,r.blok,r.aktivitas,number(r.target)+' '+(r.satuan||''),number(r.hk_rencana)])});
  return sections;

}
