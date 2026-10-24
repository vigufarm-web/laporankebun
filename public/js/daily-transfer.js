const $=id=>document.getElementById(id);
const message=text=>$('message').textContent=text;
let bundle,preview,result;
const request=async(url,options={})=>{
  const response=await fetch(url,options),data=await response.json();
  if(!response.ok)throw new Error(data.error||'Permintaan gagal');return data;
};
const post=body=>request('/api/daily/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const me=await request('/api/me');
if(!me.user?.peran?.includes('admin')) {
  message('Login sebagai admin di aplikasi dahulu.');$('bundle').disabled=true;$('photos').disabled=true;
}
$('bundle').onchange=async()=>{
  $('apply').disabled=true;$('upload').disabled=true;result=null;
  try {
    bundle=JSON.parse(await $('bundle').files[0].text());message('Memeriksa laporan…');
    preview=await post({reports:bundle.reports});
    $('preview').replaceChildren();
    for(const row of preview.preview||[]){const p=document.createElement('p');p.textContent=`${row.key} · ${row.action} · ${row.old_items} → ${row.new_items} kegiatan`;$('preview').append(p);}
    if(preview.already_applied){result=preview;$('upload').disabled=false;message('Paket laporan sudah tersimpan. Foto dapat dilanjutkan.');}
    else{$('apply').disabled=false;message('Paket siap diterapkan.');}
  }catch(error){message(error.message);}
};
$('apply').onclick=async()=>{
  $('apply').disabled=true;
  try{message('Menyimpan laporan…');result=await post({mode:'apply',token:preview.token,reports:bundle.reports});$('upload').disabled=false;message(`${result.reports.length} laporan tersimpan. Foto siap diunggah.`);}
  catch(error){message(error.message);$('apply').disabled=false;}
};
$('upload').onclick=async()=>{
  if(!result)return;const files=new Map([...$('photos').files].map(f=>[f.name,f]));
  $('upload').disabled=true;let done=0;const failures=[];
  try{
    for(const photo of bundle.photos||[]) {
      const id=result.reports.find(r=>r.key===photo.key)?.id,file=files.get(photo.file),thumb=files.get(photo.thumbnail);
      if(!id||!file){failures.push(photo.file+': berkas/laporan belum dipilih');continue;}
      message(`Mengunggah foto ${done+1}/${bundle.photos.length}…`);
      try{
        const query=new URLSearchParams({report:id,jenis:photo.jenis||'Kegiatan',caption:photo.caption||'Foto kegiatan'});
        const saved=await request('/api/daily/photo?'+query,{method:'POST',headers:{'Content-Type':file.type||'image/webp'},body:file});
        if(thumb)await request(`/api/daily/photo/${saved.id}/thumbnail?report=${id}`,{method:'POST',headers:{'Content-Type':thumb.type||'image/webp'},body:thumb});
        done++;
      }catch(error){failures.push(photo.file+': '+error.message);}
    }
    message(`${done} foto selesai. ${failures.length} perlu dilanjutkan.`+(failures.length?'\n'+failures.join('\n'):''));
  }finally{$('upload').disabled=false;}
};
