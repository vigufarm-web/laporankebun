const $=id=>document.getElementById(id),say=text=>$('message').textContent=text;
let payload,preview;
async function request(url,options={}){const response=await fetch(url,options);const data=await response.json();if(!response.ok)throw new Error(data.error||'Permintaan gagal');return data;}
const post=body=>request('/api/padi/import-harvest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
$('file').onchange=async()=>{
  $('apply').disabled=true;
  try{say('Memeriksa rincian panen…');payload=JSON.parse(await $('file').files[0].text());preview=await post({payload});$('preview').replaceChildren();
    if(preview.already_applied){say('Paket panen sudah tersimpan.');return;}
    for(const row of preview.preview){const p=document.createElement('p');p.textContent=`${row.tanggal} · ${row.petak} · ${row.jenis} · ${row.kg.toLocaleString('id-ID',{minimumFractionDigits:2})} kg · ${row.action}`;$('preview').append(p);}
    say(`GKP ${preview.totals.gkpKg.toLocaleString('id-ID')} kg; GKG ke PH ${preview.totals.gkgKg.toLocaleString('id-ID')} kg.`);$('apply').disabled=preview.preview.some(row=>row.action==='Konflik');
  }catch(error){say(error.message);}
};
$('apply').onclick=async()=>{$('apply').disabled=true;try{say('Menyimpan panen…');const result=await post({mode:'apply',token:preview.token,payload});say(`${result.added} catatan ditambahkan; ${result.skipped} sudah ada. GKP ${result.totals.gkpKg.toLocaleString('id-ID')} kg; GKG ${result.totals.gkgKg.toLocaleString('id-ID')} kg.`);}catch(error){say(error.message);}};
try{const me=await request('/api/me');if(me.user?.peran?.includes('admin')){$('file').disabled=false;say('Pilih paket panen untuk diperiksa.');}else say('Login sebagai admin aplikasi terlebih dahulu.');}catch(error){say(error.message);}
