import { PDFDocument } from 'pdfkit';

const text=v=>String(v??'-').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7E\n\r\t\u00A0-\u00FF]/g,'');
const number=v=>v==null||v===''?'-':Number(v).toLocaleString('id-ID',{maximumFractionDigits:2});
const money=v=>'Rp '+number(v);
const date=v=>v?new Date(v+'T00:00:00+07:00').toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}):'-';

export function buildReportPDF({name='PT VIGU FARM INDONESIA',from,to,reports,summary=null,sections=[],notes=[],owner=false,createdBy=''}) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margins:{top:64,bottom:52,left:44,right:44},bufferPages:true,info:{Title:owner?'WEEKLY KEBUN VIGU':'Daily Report Kebun',Author:name,Subject:`${from} - ${to}`}}),chunks=[];
    doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const width=doc.page.width-88,green='#24563D',muted='#6A786E';
    function header(){doc.font('Helvetica-Bold').fontSize(9).fillColor(green).text(text(name),44,29,{width,lineBreak:false});doc.font('Helvetica').fontSize(8).fillColor(muted).text(owner?'WEEKLY KEBUN VIGU':'DAILY REPORT KEBUN',44,42,{width,lineBreak:false});doc.moveTo(44,56).lineTo(doc.page.width-44,56).strokeColor('#D7E2D8').stroke();doc.y=72;}
    doc.on('pageAdded',()=>{doc.y=72;});doc.y=72;
    function ensure(height){if(doc.y+height>doc.page.height-58)doc.addPage();}
    function heading(label){ensure(110);doc.moveDown(.7);doc.font('Helvetica-Bold').fontSize(13);const clean=text(label),crop=/pisang|padi/i.exec(clean);if(crop){const x=44+doc.widthOfString(clean.slice(0,crop.index));doc.rect(x-2,doc.y-1,doc.widthOfString(crop[0])+4,18).fill(crop[0].toLowerCase()==='pisang'?'#FFF2A8':'#E1F1DB');}doc.fillColor(green).text(clean,44,doc.y,{width});doc.moveDown(.5);}
    function paragraph(label,value){if(!value)return;ensure(38);doc.font('Helvetica-Bold').fontSize(9).fillColor(green).text(text(label),44,doc.y,{width});doc.moveDown(.2);doc.font('Helvetica').fontSize(9).fillColor('#37483D').text(text(value),44,doc.y,{width,lineGap:3});doc.moveDown(.6);}
    function table(headers,rows,weights){
      const total=weights.reduce((a,b)=>a+b,0),widths=weights.map(w=>w/total*width);let y=doc.y;
      const drawHeader=()=>{y=doc.y;doc.rect(44,y,width,27).fill('#EDF3EA');let x=44;headers.forEach((h,i)=>{doc.font('Helvetica-Bold').fontSize(8).fillColor(green).text(text(h),x+6,y+8,{width:widths[i]-12,lineBreak:false});x+=widths[i];});doc.y=y+27;};
      ensure(65);drawHeader();
      if(!rows.length)rows=[headers.map((_,i)=>i===0?'Tidak ada data pada periode ini.':'')];
      for(const row of rows){doc.font('Helvetica').fontSize(8);const height=Math.max(30,...row.map((v,i)=>doc.heightOfString(text(v),{width:widths[i]-12,lineGap:2})+14));if(doc.y+height>doc.page.height-58){doc.addPage();drawHeader();}y=doc.y;let x=44;row.forEach((v,i)=>{if(i===0&&/pisang|padi/i.test(text(v)))doc.rect(x,y+1,widths[i],height-1).fill(/pisang/i.test(text(v))?'#FFF8CC':'#EAF5E5');doc.font('Helvetica').fontSize(8).fillColor('#2D4032').text(text(v),x+6,y+7,{width:widths[i]-12,lineGap:2});x+=widths[i];});doc.moveTo(44,y+height).lineTo(44+width,y+height).strokeColor('#E3E9DF').lineWidth(.5).stroke();doc.y=y+height;}
      doc.y+=12;
    }
    doc.font('Helvetica-Bold').fontSize(27).fillColor(green).text(owner?'WEEKLY KEBUN VIGU':'Daily Report',44,doc.y,{width});doc.moveDown(.3);doc.font('Helvetica').fontSize(11).fillColor(muted).text(`${date(from)} - ${date(to)}`,44,doc.y,{width});doc.moveDown(.7);
    if(owner&&summary){
      const indicators=[['Luas milik kebun',number(summary.blocks.ownedAreaHa)+' ha','Luas GIS aktif dan terverifikasi']];
      const add=(yes,label,value,note)=>{if(yes)indicators.push([label,value,note]);};
      for(const lc of summary.lcByCrop||[])add(lc.ha>0,lc.label,number(lc.ha)+' ha','Hasil minggu ini');
      add(summary.pisang.harvest>0,'Panen pisang',number(summary.pisang.harvest)+' tandan','Minggu terpilih');
      add(summary.pisang.boxes>0,'Packing pisang',number(summary.pisang.boxes)+' box','Minggu terpilih');
      add(summary.padi.harvestGkgKg>0,'Panen padi GKG',number(summary.padi.harvestGkgKg)+' kg',summary.padi.gkgEstimatedKg>0?'Termasuk estimasi '+number(summary.padi.gkgEstimatedKg)+' kg':'Minggu terpilih');
      add(summary.padi.milledKg>0||summary.padi.harvestGkgKg>0,'Beras hasil giling',summary.padi.milledKg>0?number(summary.padi.milledKg)+' kg':'Belum giling','Minggu terpilih');
      add(summary.pisang.sales.revenue!==0,'Penjualan pisang',money(summary.pisang.sales.revenue),'Di luar ongkir dan mutasi internal');
      add(summary.padi.sales.revenue!==0,'Penjualan padi',money(summary.padi.sales.revenue),'Minggu terpilih');
      add(summary.pisang.stock>0,'Saldo bibit saat dicetak',number(summary.pisang.stock)+' pokok','Seluruh batch yang tercatat');
      add(summary.climate.days.length>0,'Curah hujan',number(summary.climate.rain)+' mm',summary.climate.days.length+' hari pengamatan');
      heading('01 / Ringkasan mingguan');table(['Indikator','Nilai','Keterangan'],indicators,[40,27,40]);
    }
    let sectionNumber=2;
    for(const section of sections.filter(s=>s.rows.length)){heading(`${String(sectionNumber++).padStart(2,'0')} / ${section.title}`);table(section.headers,section.rows,section.weights);if(section.note)paragraph('Catatan',section.note);}
    const dailyReports=owner?[]:reports.filter(r=>r.items?.length||r.kendala||r.tindak_lanjut||r.photos?.some(p=>!p.deleted_at));
    if(dailyReports.length){if(owner)doc.addPage();heading(owner?'Lampiran / Daily Report satu minggu':'Hasil kerja harian');}
    function photos(report){
      const images=report.photoImages||[];if(!images.length)return;
      heading(owner?'Foto kegiatan - '+date(report.tanggal):'Foto kegiatan - '+date(report.tanggal)+' / '+report.divisi);
      const gap=14,box=(width-gap)/2,imageHeight=owner?150:180,cellHeight=owner?185:220;
      for(let i=0;i<images.length;i+=2){ensure(cellHeight);const y=doc.y;
        for(const [column,photo] of images.slice(i,i+2).entries()){const x=44+column*(box+gap);doc.rect(x,y,box,imageHeight).fill('#F2F5EF');if(photo.buffer){try{doc.image(photo.buffer,x+4,y+4,{fit:[box-8,imageHeight-8],align:'center',valign:'center'});}catch{doc.fontSize(9).fillColor(muted).text('Foto tidak dapat ditampilkan',x+10,y+70,{width:box-20});}}else doc.fontSize(9).fillColor(muted).text('Foto belum dapat dimuat',x+10,y+70,{width:box-20});doc.font('Helvetica').fontSize(8).fillColor('#37483D').text(text(photo.caption||'Foto kegiatan'),x,y+imageHeight+6,{width:box,height:30,ellipsis:true});}
        doc.y=y+cellHeight;
      }
    }
    for(const report of dailyReports){ensure(90);doc.font('Helvetica-Bold').fontSize(11).fillColor(green).text(`${date(report.tanggal)} | ${text(report.divisi)}`,44,doc.y,{width});doc.moveDown(.4);
      if(report.items.length)table(['Blok','Kegiatan','HI','SDHI minggu','HK aktual','Target minggu'],report.items.map(x=>[x.blok,[x.aktivitas,x.alat,x.meter_awal!=null&&x.meter_akhir!=null?'Meter '+number(x.meter_awal)+' - '+number(x.meter_akhir):null].filter(Boolean).join('\n'),x.realisasi==null?'-':number(x.realisasi)+' '+(x.satuan||''),x.hasil_sdhi==null?'-':number(x.hasil_sdhi)+' '+(x.satuan||''),number(x.hk_realisasi),x.target!=null?number(x.target)+' '+(x.satuan||''):x.target_hk_minggu!=null?number(x.target_hk_minggu)+' HK':'-']),[65,135,83,83,49,83]);
      paragraph('Kendala',report.kendala);paragraph('Tindak lanjut',report.tindak_lanjut);photos(report);
      const expired=(report.photos||[]).filter(p=>p.deleted_at).length;if(expired)paragraph('Foto',expired+' foto tidak lagi tersedia sesuai masa simpan 14 hari. Data laporan tetap tersimpan.');
    }
    if(owner){
      if(notes.length){heading('Kendala dan tindak lanjut minggu ini');for(const note of notes)paragraph(note.division+' / '+note.label,note.text);}
      const byDate=new Map();for(const r of reports){const images=byDate.get(r.tanggal)||[];for(const p of r.photoImages||[])if(images.length<3)images.push({...p,caption:r.divisi+' / '+(p.caption||'Foto kegiatan')});byDate.set(r.tanggal,images);}
      let started=false;for(const [tanggal,images] of [...byDate].sort(([a],[b])=>a.localeCompare(b))){if(!images.length)continue;doc.addPage();started=true;photos({tanggal,photoImages:images});}
      if(started)paragraph('Dokumentasi','Maksimal 3 foto per tanggal, dipilih dari laporan selesai untuk mewakili kegiatan. Hanya foto yang masih tersedia dalam masa simpan.');
    }
    ensure(80);paragraph('Dasar laporan',owner?'Rekap satu minggu, Senin sampai Minggu. Hasil pekerjaan berasal dari laporan selesai; target mingguan tiap blok dihitung satu kali. SDHI tidak dijumlahkan kembali. Hasil lahan memakai transaksi efektif setelah penyesuaian luas. Satuan berbeda dipisahkan.':'Hasil dan target mengikuti catatan transaksi. SDHI merupakan akumulasi dalam minggu yang sama. Angka dengan satuan berbeda tidak dijumlahkan. Nama blok memakai nama GIS terbaru; riwayat tetap terhubung ke ID tetap.');
    paragraph('Waktu cetak',new Date().toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+' WIB'+(createdBy?' | '+createdBy:''));
    const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.page.margins.bottom=0;header();doc.font('Helvetica').fontSize(8).fillColor(muted).text(`VIGU FARM | ${from} - ${to}`,44,doc.page.height-32,{width:width-65,lineBreak:false});doc.text(`${i+1} / ${range.count}`,doc.page.width-100,doc.page.height-32,{width:56,align:'right',lineBreak:false});}
    doc.end();
  });
}

export {ownerSections} from './owner-sections.js';
