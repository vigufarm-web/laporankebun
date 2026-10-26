import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoExpiresAt, photoExpired } from '../lib/photo-retention.js';

test('foto mencakup empat belas tanggal laporan WIB, bukan sejak unggah', () => {
  const photo = { expires_at: photoExpiresAt('2026-10-18') };
  assert.equal(photo.expires_at, '2026-10-31T17:00:00.000Z');
  assert.equal(photoExpired(photo, Date.parse('2026-10-31T23:59:59+07:00')), false);
  assert.equal(photoExpired(photo, Date.parse('2026-11-01T00:00:00+07:00')), true);
  assert.equal(photoExpired({ expires_at: photoExpiresAt('2026-10-17') }, Date.parse('2026-10-31T12:00:00+07:00')), true);
  assert.equal(photoExpiresAt('2026-12-29'), '2027-01-11T17:00:00.000Z');
});
