// Repeated maintenance covers the same land; it does not create new hectares.
export const isPadiCoverage=(division,activity,unit)=>division==='Padi'&&String(unit||'').trim().toLowerCase()==='ha'&&/irigasi|pengairan|(?:usir|pengusiran).*burung/i.test(String(activity||''));
export function cappedCoverage(value,area){if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(Number(area))&&Number(area)>0?Math.min(n,Number(area)):n;}
