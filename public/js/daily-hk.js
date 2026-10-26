export const hkNumber=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
export function dailyHKCheck(report){
 const items=(report.items||[]).filter(x=>String(x.aktivitas||'').trim()),known=items.filter(x=>hkNumber(x.hk_realisasi)!==null),declared=hkNumber(report.apel_hadir),activity=known.length?known.reduce((s,x)=>s+hkNumber(x.hk_realisasi),0):null,partial=known.length<items.length;
 return {declaredHK:declared,activityHK:activity,missingItems:items.length-known.length,partial,difference:declared!==null&&activity!==null&&!partial?activity-declared:null};
}
export function dailyHKMarkup(report){
 const x=dailyHKCheck(report),n=v=>v===null?'Belum diisi':Number(v).toLocaleString('id-ID',{maximumFractionDigits:2}),message=x.difference===null?'Lengkapi total HK dan alokasi HK kegiatan untuk pengecekan.':Math.abs(x.difference)<.0001?'HK kegiatan sesuai pernyataan mandor.':`Selisih HK kegiatan − mandor: ${n(x.difference)} HK. Periksa alokasi; jangan menghitung HK orang yang sama dua kali.`;
 return `<div class="dr-hk-check" role="status"><b>Total HK mandor: ${n(x.declaredHK)}</b><span>Alokasi HK kegiatan: ${n(x.activityHK)}${x.partial?' (belum lengkap)':''}</span><small>${message}</small></div>`;
}
