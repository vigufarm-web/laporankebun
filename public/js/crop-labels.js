const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cropLabel(value){return esc(value).replace(/\b(pisang|padi)\b/gi,word=>`<span class="crop-name crop-${word.toLowerCase()}">${word}</span>`);}
