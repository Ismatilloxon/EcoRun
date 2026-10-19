import { mkdir, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.ts';
import { readExif, type PhotoMeta } from './exif.ts';
import { fail } from './http.ts';

const MAX_BYTES = 8 * 1024 * 1024;

function sniff(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 4, 12).match(/^ftyp(heic|heix|mif1)/)) return 'heic';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'gif';
  return null;
}

/** Stores an image (validated by magic bytes, never by client-declared type). S3 adapter plugs in here. */
export async function saveImage(buf: Buffer): Promise<{ url: string; meta: PhotoMeta }> {
  if (buf.length > MAX_BYTES) fail(413, 'file_too_large');
  const ext = sniff(buf);
  if (!ext) fail(415, 'unsupported_image');
  const now = new Date();
  const rel = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  const dir = path.join(config.uploadsDir, rel);
  await mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  await writeFile(path.join(dir, name), buf);
  return { url: `/uploads/${rel}/${name}`.replace(/\\/g, '/'), meta: ext === 'jpg' ? readExif(buf) : {} };
}

export const isUploadUrl = (u: unknown) => typeof u === 'string' && /^\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|gif)$/.test(u);
