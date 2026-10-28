// Pilih cepat blok untuk pekerjaan seluruh area: Semua blok · Semua <tanaman> · Kosongkan.
// Tombol tanaman dibuat dari kolom divisi lokasi GIS, jadi tanaman/blok baru otomatis ikut muncul tanpa ubah kode.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const cropGroups=locations=>[...new Set((locations||[]).map(l=>String(l?.divisi||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));
// Status centang yang diinginkan: '*' = semua, '' = kosongkan, nama tanaman = tambah blok tanaman itu (pilihan lain tetap).
export const quickPickWant=(pick,checked,crop)=>pick==='*'?true:pick===''?false:crop===pick?true:checked;
export function quickPickHTML(locations){
  return `<div class="block-quick" role="group" aria-label="Pilih cepat blok"><button type="button" class="btn sm" data-qp="*">Semua blok</button>${cropGroups(locations).map(c=>`<button type="button" class="btn sm" data-qp="${esc(c)}">Semua ${esc(c)}</button>`).join('')}<button type="button" class="btn sm" data-qp="">Kosongkan</button></div>`;
}
// checkboxes() = kotak centang blok; cropOf(checkbox) = tanaman blok tsb. Memakai click() agar penangan onchange yang sudah ada tetap berjalan.
export function bindQuickPick(root,checkboxes,cropOf){
  root.querySelectorAll('[data-qp]').forEach(b=>b.onclick=()=>{for(const cb of checkboxes())if(cb.checked!==quickPickWant(b.dataset.qp,cb.checked,cropOf(cb)))cb.click();});
}
