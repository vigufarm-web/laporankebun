import {renderYearPlan} from './year-plan.js';
document.body.classList.add('public-summary-mode');
const api={get:async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(60000)}),d=await r.json();if(!r.ok)throw new Error(d.error||'Data belum dapat dimuat');return d;}};
renderYearPlan(document.getElementById('kb'),api);
document.getElementById('rf').onclick=()=>location.reload();
