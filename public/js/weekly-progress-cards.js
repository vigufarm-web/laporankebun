import {hiddenActivity} from './activity-visibility.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>Number(value||0).toLocaleString('id-ID',{maximumFractionDigits:2});
export function weeklyProgressCards(weekly){
 return weekly.filter(x=>!hiddenActivity(x.name)&&!['Cabut Ajir','Cabut Mulsa','Gulung Drip'].includes(x.name)).map(x=>`<article><b>${esc(x.name)} · Pisang</b><strong>${num(x.done)} <small>/ ${num(x.target)} ha</small></strong><div class="sum-meter"><i style="width:${Math.min(100,x.target?x.done/x.target*100:0)}%"></i></div><span>${num(x.target?x.done/x.target*100:0)}% tercapai</span><div class="weekly-worked-blocks"><small>Blok dikerjakan</small>${x.blocks?.length?`<ul>${x.blocks.map(b=>`<li><b>${esc(b.name)}</b><span>${num(b.ha)} ha</span></li>`).join('')}</ul>`:'<p>Belum ada realisasi minggu ini.</p>'}</div></article>`).join('')||'<p>Belum ada target minggu ini.</p>';
}
