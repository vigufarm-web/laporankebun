export async function compressPhoto(file,max=1280,budget=350000) {
  if(!file.type.startsWith('image/'))throw new Error('Pilih file foto JPG, PNG atau WebP.');
  const bitmap=await createImageBitmap(file),scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  let quality=.76,blob;do{blob=await new Promise(r=>canvas.toBlob(r,'image/webp',quality));quality-=.1;}while(blob?.size>budget&&quality>=.35);
  if(!blob||blob.size>2500000)throw new Error('Foto masih terlalu besar. Pilih ukuran lebih kecil.');return blob;
}
// meta = { caption, jenis }: keterangan yang ditulis mandor. Nama file kamera tidak lagi dipakai sebagai keterangan.
export async function uploadPhoto(file,reportId,progress=()=>{},existingId=null,meta={}) {
  let id=existingId;
  const post=async(url,blob)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':blob.type},body:blob});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unggah foto gagal');return j;};
  try{
    if(!id){progress('Mengompres foto…');const photo=await compressPhoto(file);progress('Mengunggah foto…');const saved=await post('/api/daily/photo?'+new URLSearchParams({report:reportId,jenis:['Apel','Kegiatan','Kendala'].includes(meta.jenis)?meta.jenis:'Kegiatan',caption:String(meta.caption||'').trim().slice(0,200)}),photo);id=saved.id;}
    progress('Menyiapkan thumbnail…');const thumb=await compressPhoto(file,420,50000);await post(`/api/daily/photo/${id}/thumbnail?report=${reportId}`,thumb);return id;
  }catch(e){e.photoId=id;throw e;}
}
const escH=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Keterangan per foto sebelum diunggah: foto kecil + kolom keterangan dengan pilihan cepat dari kegiatan laporan (mis. "P12 · Panen padi").
// queue = [{file, caption}] — keterangan disimpan di item antrean sehingga tetap ada bila form digambar ulang.
export function photoCaptionInputs(host,queue,saran=[]){
  if(!host)return;
  const id='fotoKet'+Math.random().toString(36).slice(2,8);
  for(const p of queue)p.preview??=URL.createObjectURL(p.file);
  host.innerHTML=queue.length?`<datalist id="${id}">${[...new Set(saran.map(s=>String(s||'').trim()).filter(Boolean))].slice(0,80).map(s=>`<option value="${escH(s)}">`).join('')}</datalist><div class="photo-captions">${queue.map((p,i)=>`<label class="photo-caption"><img src="${p.preview}" alt=""><span>Keterangan foto ${i+1}<input data-cap="${i}" list="${id}" maxlength="200" value="${escH(p.caption||'')}" placeholder="pilih kegiatan atau ketik, mis. Panen P12"></span></label>`).join('')}</div>`:'';
  host.querySelectorAll('[data-cap]').forEach(el=>el.oninput=()=>{queue[el.dataset.cap].caption=el.value.trim();});
}
