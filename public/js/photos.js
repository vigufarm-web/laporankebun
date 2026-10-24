export async function compressPhoto(file,max=1280,budget=350000) {
  if(!file.type.startsWith('image/'))throw new Error('Pilih file foto JPG, PNG atau WebP.');
  const bitmap=await createImageBitmap(file),scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  let quality=.76,blob;do{blob=await new Promise(r=>canvas.toBlob(r,'image/webp',quality));quality-=.1;}while(blob?.size>budget&&quality>=.35);
  if(!blob||blob.size>2500000)throw new Error('Foto masih terlalu besar. Pilih ukuran lebih kecil.');return blob;
}
export async function uploadPhoto(file,reportId,progress=()=>{},existingId=null) {
  let id=existingId;
  const post=async(url,blob)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':blob.type},body:blob});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unggah foto gagal');return j;};
  try{
    if(!id){progress('Mengompres foto…');const photo=await compressPhoto(file);progress('Mengunggah foto…');const saved=await post('/api/daily/photo?'+new URLSearchParams({report:reportId,jenis:'Kegiatan',caption:file.name}),photo);id=saved.id;}
    progress('Menyiapkan thumbnail…');const thumb=await compressPhoto(file,420,50000);await post(`/api/daily/photo/${id}/thumbnail?report=${reportId}`,thumb);return id;
  }catch(e){e.photoId=id;throw e;}
}
