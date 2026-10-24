// Seven report dates, including the report day, in the farm's WIB timezone.
export function photoExpiresAt(reportDate) {
  const start = Date.parse(`${reportDate}T00:00:00+07:00`);
  if (!Number.isFinite(start)) throw new Error('Tanggal laporan tidak valid');
  return new Date(start + 7 * 86400000).toISOString();
}

export function photoExpired(photo, instant = Date.now()) {
  return !!photo.expires_at && Date.parse(photo.expires_at) <= instant;
}
