const key=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const hiddenActivity=value=>key(value)==='ecerpupuk';
export const visibleActivityRows=rows=>rows.filter(row=>!hiddenActivity(row.aktivitas??row.activity??row.name));
