// Presentation aliases only: the original Daily entries remain unchanged.
const aliases = new Map([
  ['aplikasi dolomite', 'Aplikasi kapur dolomite'],
  ['aplikasi dolomit', 'Aplikasi kapur dolomite'],
  ['aplikasi kapur dolomit', 'Aplikasi kapur dolomite'],
  ['aplikasi kapur dolomite', 'Aplikasi kapur dolomite'],
  ['kapur dolomit', 'Aplikasi kapur dolomite'],
  ['kapur dolomite', 'Aplikasi kapur dolomite'],
  ['boster lob', 'Booster LOB'],
  ['booster lob', 'Booster LOB'],
  ['boster lob bibit', 'Booster LOB'],
  ['booster lob bibit', 'Booster LOB'],
  ['regular prunning', 'Regular pruning'],
  ['regular pruning', 'Regular pruning'],
  ['master prunning', 'Master pruning'],
  ['master pruning', 'Master pruning'],
  ['dnd / marking', 'DnD / marking'],
  ['dnd/ marking', 'DnD / marking'],
  ['dnd/marking', 'DnD / marking'],
  ['box farming', 'Box forming'],
  ['box forming', 'Box forming'],
  ['pemupukan kcl (tugal)', 'Pemupukan KCl tugal'],
  ['pemupukan kcl tugal', 'Pemupukan KCl tugal'],
  ['pemupukan urea (tugal)', 'Pemupukan urea tugal'],
  ['pemupukan urea(tugal)', 'Pemupukan urea tugal'],
  ['pemupukan urea tugal', 'Pemupukan urea tugal'],
  ['pengawasan aktifitas', 'Pengawasan aktivitas'],
  ['pengawasan aktivitas', 'Pengawasan aktivitas'],
  ['perontok padi', 'Perontokan padi'],
  ['perontokan padi', 'Perontokan padi'],
  ['vacuum pack', 'Vacuum packing'],
  ['vacum pack', 'Vacuum packing'],
  ['vacum packing', 'Vacuum packing'],
  ['vacuum packing', 'Vacuum packing'],
]);
export function reportActivity(name) {
  const original = String(name || '').trim();
  return aliases.get(original.toLocaleLowerCase('id-ID').replace(/\s+/g, ' ')) || original;
}
