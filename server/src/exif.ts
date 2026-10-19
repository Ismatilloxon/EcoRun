/** Minimal JPEG EXIF reader: GPS position and capture time, used to verify eco-action photos. */
export type PhotoMeta = { lat?: number; lng?: number; takenAt?: string };

export function readExif(buf: Buffer): PhotoMeta {
  try {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return {};
    let off = 2;
    while (off + 4 < buf.length) {
      if (buf[off] !== 0xff) return {};
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker === 0xe1 && buf.toString('ascii', off + 4, off + 10) === 'Exif\0\0') {
        return parseTiff(buf.subarray(off + 10, off + 2 + len));
      }
      if (marker === 0xda) return {};
      off += 2 + len;
    }
  } catch {
    /* corrupt or truncated EXIF: treat as missing */
  }
  return {};
}

function parseTiff(t: Buffer): PhotoMeta {
  const le = t.toString('ascii', 0, 2) === 'II';
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const readIfd = (o: number) => {
    const tags = new Map<number, { type: number; count: number; valueOff: number }>();
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), valueOff: e + 8 });
    }
    return tags;
  };
  const rational = (o: number) => u32(o) / (u32(o + 4) || 1);
  const ascii = (tag: { count: number; valueOff: number }) => {
    const o = tag.count > 4 ? u32(tag.valueOff) : tag.valueOff;
    return t.toString('ascii', o, o + tag.count).replace(/\0+$/, '');
  };

  const ifd0 = readIfd(u32(4));
  const out: PhotoMeta = {};
  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) {
    const exif = readIfd(u32(exifPtr.valueOff));
    const dto = exif.get(0x9003) ?? ifd0.get(0x0132);
    if (dto) {
      const m = ascii(dto).match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      // EXIF time has no zone; phones record local time, Tashkent is UTC+5.
      if (m) out.takenAt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:00`).toISOString();
    }
  }
  const gpsPtr = ifd0.get(0x8825);
  if (gpsPtr) {
    const gps = readIfd(u32(gpsPtr.valueOff));
    const coord = (tagId: number, refId: number) => {
      const tag = gps.get(tagId);
      const ref = gps.get(refId);
      if (!tag || !ref) return undefined;
      const o = u32(tag.valueOff);
      const v = rational(o) + rational(o + 8) / 60 + rational(o + 16) / 3600;
      const r = String.fromCharCode(t[ref.valueOff]);
      return r === 'S' || r === 'W' ? -v : v;
    };
    out.lat = coord(2, 1);
    out.lng = coord(4, 3);
  }
  return out;
}
