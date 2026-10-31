// Share in-flight asset loads; retry only failed assets after a network error.
export function createResourceLoader(getDocument=()=>document){
 const jobs=new Map();
 return function load(src){if(jobs.has(src))return jobs.get(src);const doc=getDocument();let element;
 const task=new Promise((resolve,reject)=>{element=src.endsWith('.css')?Object.assign(doc.createElement('link'),{rel:'stylesheet',href:src}):Object.assign(doc.createElement('script'),{src});element.onload=()=>resolve();element.onerror=()=>{jobs.delete(src);element.remove();reject(Error('Gagal memuat '+src));};doc.head.appendChild(element);});
 jobs.set(src,task);return task;
 };
}
