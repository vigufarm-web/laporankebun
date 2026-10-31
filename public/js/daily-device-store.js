// Files use structured-clone storage, never localStorage/base64. Keys include
// the signed-in user, date and division so devices shared by staff do not mix queues.
let opening;
function open(){
 if(!globalThis.indexedDB)return Promise.reject(new Error('Penyimpanan foto perangkat tidak tersedia. Jangan tutup halaman sebelum unggahan selesai.'));
 return opening??=new Promise((resolve,reject)=>{
  const request=indexedDB.open('kebun-daily-device',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('photos');
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
  request.onerror=()=>{opening=null;reject(request.error);};
 });
}
async function transaction(mode,operation){
 const db=await open();return new Promise((resolve,reject)=>{
  const tx=db.transaction('photos',mode),request=operation(tx.objectStore('photos'));
  tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Penyimpanan foto perangkat gagal.'));
 });
}
export const readDevicePhotos=key=>transaction('readonly',store=>store.get(key));
export const saveDevicePhotos=(key,queue)=>transaction('readwrite',store=>queue.length?store.put(queue.map(({file,caption,photoId,done})=>({file,caption,photoId,done})),key):store.delete(key));

// Reuse exactly the same key and payload after an uncertain network response.
export function submissionFor(previous,payload,create=()=>crypto.randomUUID()){
 const body=JSON.stringify(payload);return previous?.body===body?previous:{key:create(),body};
}
