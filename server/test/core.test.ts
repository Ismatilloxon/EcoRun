import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrack, distanceM, trimPrivacyZone, type Pt } from '../src/geo.ts';
import { readExif } from '../src/exif.ts';
import { toCsv } from '../src/http.ts';
import { levelFor } from '../src/settings.ts';

process.env.JWT_SECRET ??= 'x'.repeat(48);
const { base32Encode, totpCode, verifyTotp, normalizePhone } = await import('../src/auth.ts');

function line(km: number, paceSec: number, jumpAt?: number): Pt[] {
  const pts: Pt[] = [];
  const stepM = 20;
  const dLat = stepM / 111_320;
  for (let i = 0; i <= (km * 1000) / stepM; i++) {
    let lat = 41.3 + i * dLat;
    if (jumpAt && i >= jumpAt) lat += 0.01; // ~1.1 km teleport
    pts.push({ lat, lng: 69.25, t: i * (stepM / 1000) * paceSec * 1000 });
  }
  return pts;
}

test('distance between two points in Tashkent', () => {
  const d = distanceM({ lat: 41.3111, lng: 69.2797 }, { lat: 41.3211, lng: 69.2797 });
  assert.ok(Math.abs(d - 1112) < 5, `got ${d}`);
});

test('track analysis computes splits and best efforts', () => {
  const r = analyzeTrack(line(5.2, 300), { maxAvgKmh: 25, maxSegmentKmh: 45 });
  assert.ok(Math.abs(r.distanceM - 5200) < 30);
  assert.equal(r.splits.length, 5);
  assert.ok(Math.abs(r.splits[0].sec - 300) <= 2);
  assert.ok(Math.abs(r.bestEfforts['5k'] - 1500) <= 10);
  assert.deepEqual(r.flags, []);
});

test('GPS jumps are flagged by anti-cheat', () => {
  const r = analyzeTrack(line(3, 300, 50), { maxAvgKmh: 25, maxSegmentKmh: 45 });
  assert.ok(r.flags.some((f) => f.startsWith('gps_jump')));
});

test('privacy zone hides the start and end of a route', () => {
  const pts = line(2, 300);
  const visible = trimPrivacyZone(pts, 200);
  assert.ok(visible.length < pts.length);
  assert.ok(distanceM(visible[0], pts[0]) > 200);
  assert.ok(distanceM(visible.at(-1)!, pts.at(-1)!) > 200);
});

test('TOTP matches RFC 6238 test vector', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totpCode(secret, Math.floor(59 / 30)), '287082');
  assert.equal(verifyTotp(secret, totpCode(secret, Math.floor(Date.now() / 30000))), true);
  assert.equal(verifyTotp(secret, 'abcdef'), false);
});

test('phone normalization defaults to Uzbekistan', () => {
  assert.equal(normalizePhone('90 123 45 67'), '+998901234567');
  assert.equal(normalizePhone('+998 (90) 123-45-67'), '+998901234567');
  assert.throws(() => normalizePhone('12'));
});

test('CSV export escapes quotes and blocks formula injection', () => {
  const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'He said "hi", ok' }], ['a', 'b']);
  assert.equal(csv.split('\n')[1], `"'=HYPERLINK(""x"")","He said ""hi"", ok"`);
});

test('levels from points thresholds', () => {
  assert.deepEqual(levelFor(0, [0, 100, 300]), { level: 1, current: 0, next: 100 });
  assert.deepEqual(levelFor(350, [0, 100, 300]), { level: 3, current: 300, next: null });
});

test('EXIF reader ignores non-JPEG and corrupt data', () => {
  assert.deepEqual(readExif(Buffer.from('not an image')), {});
  assert.deepEqual(readExif(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00])), {});
});
