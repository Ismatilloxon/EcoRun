import crypto from 'node:crypto';
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { one, q } from './db.ts';
import { fail } from './http.ts';

const key = new TextEncoder().encode(config.jwtSecret);
const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;

export type Role = 'runner' | 'club_organizer' | 'partner' | 'event_organizer' | 'moderator' | 'admin';
export type AuthUser = {
  id: string;
  role: Role;
  name: string | null;
  gender: string | null;
  language: 'uz' | 'ru' | 'en';
  telegram_id: number | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export async function issueTokens(userId: string, role: string, opts: { mfa?: boolean } = {}) {
  const accessToken = await new SignJWT({ role, mfa: Boolean(opts.mfa) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(key);
  const refreshToken = randomToken(48);
  await q(
    `insert into refresh_tokens (user_id, token_hash, mfa, expires_at) values ($1, $2, $3, now() + interval '${REFRESH_DAYS} days')`,
    [userId, sha256(refreshToken), Boolean(opts.mfa)],
  );
  return { accessToken, refreshToken };
}

/** Short-lived access token without a refresh token, for internal calls on a user's behalf. */
export async function accessTokenFor(userId: string, role: string) {
  return new SignJWT({ role, mfa: false }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime('2m').sign(key);
}

export async function rotateRefresh(refreshToken: string) {
  const row = await one(
    `update refresh_tokens set revoked_at = now()
     where token_hash = $1 and revoked_at is null and expires_at > now()
     returning user_id, mfa`,
    [sha256(refreshToken)],
  );
  if (!row) fail(401, 'invalid_refresh');
  const user = await one('select id, role, blocked, deleted_at from users where id = $1', [row!.user_id]);
  if (!user || user.blocked || user.deleted_at) fail(401, 'account_unavailable');
  return issueTokens(user!.id, user!.role, { mfa: row!.mfa });
}

export async function revokeAll(userId: string) {
  await q('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
}

async function verifyAccess(token: string) {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return payload as { sub: string; role: string; mfa?: boolean };
  } catch {
    return null;
  }
}

const seenToday = new Set<string>();
function trackDay(userId: string) {
  const day = new Date().toISOString().slice(0, 10);
  const k = `${userId}:${day}`;
  if (seenToday.has(k)) return;
  if (seenToday.size > 50000) seenToday.clear();
  seenToday.add(k);
  q('insert into user_days (user_id, day) values ($1, $2) on conflict do nothing', [userId, day]).catch(() => {});
}

export async function userFromToken(token: string | undefined): Promise<(AuthUser & { mfa: boolean }) | null> {
  if (!token) return null;
  const payload = await verifyAccess(token);
  if (!payload?.sub) return null;
  const u = await one<AuthUser & { blocked: boolean; deleted_at: string | null }>(
    'select id, role, name, gender, language, telegram_id, blocked, deleted_at from users where id = $1',
    [payload.sub],
  );
  if (!u || u.blocked || u.deleted_at) return null;
  trackDay(u.id);
  return { id: u.id, role: u.role, name: u.name, gender: u.gender, language: u.language, telegram_id: u.telegram_id, mfa: Boolean(payload.mfa) };
}

export async function optionalAuth(req: FastifyRequest) {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  const u = await userFromToken(token);
  req.user = u;
  (req as any).mfa = u?.mfa ?? false;
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  await optionalAuth(req);
  if (!req.user) fail(401, 'unauthorized');
}

export const STAFF: Role[] = ['moderator', 'admin'];

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (!roles.includes(req.user!.role)) fail(403, 'forbidden');
    // Staff accounts with 2FA enabled must present an MFA-verified token for staff endpoints.
    if (STAFF.includes(req.user!.role) && roles.every((r) => STAFF.includes(r))) {
      const u = await one('select totp_enabled from users where id = $1', [req.user!.id]);
      if (u?.totp_enabled && !(req as any).mfa) fail(403, 'mfa_required');
    }
  };
}

// ---------- Phone OTP ----------
export function normalizePhone(input: string) {
  let d = String(input).replace(/\D/g, '');
  if (d.length === 9) d = `998${d}`;
  if (d.length < 10 || d.length > 15) fail(400, 'invalid_phone');
  return `+${d}`;
}

const otpHash = (phone: string, code: string) => sha256(`${phone}:${code}:${config.jwtSecret}`);

export async function createOtp(phone: string) {
  const recent = await one(
    `select count(*) filter (where created_at > now() - interval '60 seconds') as last_min,
            count(*) filter (where created_at > now() - interval '1 hour') as last_hour
     from otp_codes where phone = $1`,
    [phone],
  );
  if (Number(recent?.last_min) > 0) fail(429, 'otp_too_soon');
  if (Number(recent?.last_hour) >= 5) fail(429, 'otp_too_many');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await q(`insert into otp_codes (phone, code_hash, expires_at) values ($1, $2, now() + interval '5 minutes')`, [phone, otpHash(phone, code)]);
  return code;
}

export async function verifyOtp(phone: string, code: string) {
  const row = await one(
    `select id, code_hash, attempts from otp_codes
     where phone = $1 and used_at is null and expires_at > now()
     order by created_at desc limit 1`,
    [phone],
  );
  if (!row) fail(400, 'otp_expired');
  if (row!.attempts >= 5) fail(429, 'otp_locked');
  const ok = crypto.timingSafeEqual(Buffer.from(row!.code_hash), Buffer.from(otpHash(phone, String(code))));
  if (!ok) {
    await q('update otp_codes set attempts = attempts + 1 where id = $1', [row!.id]);
    fail(400, 'otp_invalid');
  }
  await q('update otp_codes set used_at = now() where id = $1', [row!.id]);
}

// ---------- TOTP (RFC 6238) for staff 2FA ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string) {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totpCode(secret: string, counter: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
export function verifyTotp(secret: string, code: string) {
  const step = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((w) => totpCode(secret, step + w) === String(code).trim());
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

// ---------- Google / Apple ID tokens ----------
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export async function verifyGoogleIdToken(idToken: string) {
  if (!config.google.clientId) fail(501, 'google_not_configured');
  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.google.clientId,
  }).catch(() => fail(401, 'invalid_google_token'));
  return { sub: String(payload.sub), name: (payload as any).name as string | undefined, picture: (payload as any).picture as string | undefined };
}

export async function verifyAppleIdToken(idToken: string) {
  if (!config.apple.clientId) fail(501, 'apple_not_configured');
  const { payload } = await jwtVerify(idToken, appleJwks, {
    issuer: 'https://appleid.apple.com',
    audience: config.apple.clientId,
  }).catch(() => fail(401, 'invalid_apple_token'));
  return { sub: String(payload.sub) };
}
