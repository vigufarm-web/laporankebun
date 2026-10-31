// Lokasi umum hanya untuk Daily; tidak menambah luas atau blok GIS.
const catalog=[['Nursery','Pisang'],['Packing House','Pisang'],['Umum Pisang','Pisang'],['Umum Padi','Padi'],['Umum Infra','Infra'],['Main Road 2','Infra'],['Access Road','Infra'],['Jembatan','Infra'],['Jalan','Infra'],['Parit','Infra'],['Bengkel','Infra'],['Sumur Bor','Infra'],['Rumah Solar','Infra'],['Operasional Kendaraan','Infra']];
export const GENERAL_DAILY_LOCATIONS=catalog.map(([nama,divisi])=>({id:'daily-general:'+nama,nama,divisi,luas_ha:null,jenis:'Umum',general:true}));
export const isGeneralDailyLocation=name=>GENERAL_DAILY_LOCATIONS.some(l=>l.nama===name);
export const withGeneralDailyLocations=locations=>[...locations,...GENERAL_DAILY_LOCATIONS.filter(g=>!locations.some(l=>l.nama===g.nama))];
