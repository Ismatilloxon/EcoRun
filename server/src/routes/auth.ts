import type { FastifyInstance } from 'fastify';
import { config, smsConfigured } from '../config.ts';
import { one, q } from '../db.ts';
import { fail, S } from '../http.ts';
import {
  createOtp, issueTokens, normalizePhone, randomToken, requireAuth, revokeAll, rotateRefresh,
  verifyAppleIdToken, verifyGoogleIdToken, verifyOtp, verifyTotp,
} from '../auth.ts';
import { t } from '../i18n.ts';
import { sendSms } from '../sms.ts';
import { esc, tgSend, telegramEnabled } from '../telegram.ts';

async function finishLogin(user: { id: string; role: string; totp_enabled: boolean }) {
  if (user.totp_enabled) {
    // Staff with 2FA: short-lived ticket that only /auth/totp accepts.
    const ticket = randomToken(24);
    await q(`insert into telegram_tokens (token, purpose, user_id, status) values ($1, 'login', $2, 'confirmed')`, [`mfa_${ticket}`, user.id]);
    return { mfaRequired: true, ticket };
  }
  return issueTokens(user.id, user.role);
}

async function upsertByInvite(invite: string | undefined) {
  if (!invite) return null;
  const r = await one('select id from users where invite_code = $1', [invite]);
  return r?.id ?? null;
}

export default async function authRoutes(app: FastifyInstance) {
  app.get('/auth/providers', { schema: { tags: ['auth'] } }, async () => ({
    phone: true,
    sms: smsConfigured(),
    telegram: telegramEnabled() && Boolean(config.telegram.username),
    telegramBot: config.telegram.username || null,
    google: config.google.clientId || null,
    apple: config.apple.clientId || null,
  }));

  app.post(
    '/auth/otp/request',
    {
      config: { rateLimit: { max: config.isProd ? 30 : 500, timeWindow: '10 minutes' } },
      schema: { tags: ['auth'], body: S.obj({ phone: S.str({ maxLength: 32 }) }, ['phone']) },
    },
    async (req) => {
      const { phone: raw } = req.body as { phone: string };
      const phone = normalizePhone(raw);
      const code = await createOtp(phone);
      const user = await one('select telegram_id, language from users where phone = $1', [phone]);
      let delivered: string[] = [];
      if (smsConfigured()) {
        const ok = await sendSms(phone, t(user?.language ?? 'uz', 'otp', { code }));
        if (ok) delivered.push('sms');
      }
      if (user?.telegram_id && telegramEnabled()) {
        await tgSend(user.telegram_id, esc(t(user.language, 'otp', { code })));
        delivered.push('telegram');
      }
      if (!config.isProd && !smsConfigured()) {
        req.log.info(`[dev] OTP for ${phone}: ${code}`);
        // Only reveal the code to requests from this machine, never to other devices on the network.
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
        return local ? { sent: true, delivered, devCode: code } : { sent: true, delivered: ['server-log'] };
      }
      if (!delivered.length) fail(503, 'sms_unavailable');
      return { sent: true, delivered };
    },
  );

  app.post(
    '/auth/otp/verify',
    {
      config: { rateLimit: { max: config.isProd ? 60 : 500, timeWindow: '10 minutes' } },
      schema: {
        tags: ['auth'],
        body: S.obj({ phone: S.str({ maxLength: 32 }), code: S.str({ pattern: '^\\d{6}$' }), invite: S.str({ maxLength: 16 }) }, ['phone', 'code']),
      },
    },
    async (req) => {
      const { phone: raw, code, invite } = req.body as { phone: string; code: string; invite?: string };
      const phone = normalizePhone(raw);
      await verifyOtp(phone, code);
      let user = await one('select id, role, blocked, deleted_at, totp_enabled, onboarded from users where phone = $1', [phone]);
      if (user?.deleted_at) {
        await q('update users set phone = null where id = $1', [user.id]);
        user = null;
      }
      if (!user) {
        const invitedBy = await upsertByInvite(invite);
        user = await one(
          `insert into users (phone, invited_by) values ($1, $2) returning id, role, blocked, totp_enabled, onboarded`,
          [phone, invitedBy],
        );
      }
      if (user!.blocked) fail(403, 'blocked');
      return { ...(await finishLogin(user! as any)), onboarded: user!.onboarded };
    },
  );

  app.post(
    '/auth/totp',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } }, schema: { tags: ['auth'], body: S.obj({ ticket: S.str({ maxLength: 64 }), code: S.str({ pattern: '^\\d{6}$' }) }, ['ticket', 'code']) } },
    async (req) => {
      const { ticket, code } = req.body as { ticket: string; code: string };
      const row = await one(
        `select user_id from telegram_tokens where token = $1 and status = 'confirmed' and created_at > now() - interval '10 minutes'`,
        [`mfa_${ticket}`],
      );
      if (!row) fail(400, 'mfa_ticket_expired');
      const user = await one('select id, role, totp_secret, onboarded from users where id = $1', [row!.user_id]);
      if (!user?.totp_secret || !verifyTotp(user.totp_secret, code)) fail(400, 'totp_invalid');
      await q(`update telegram_tokens set status = 'used' where token = $1`, [`mfa_${ticket}`]);
      return { ...(await issueTokens(user!.id, user!.role, { mfa: true })), onboarded: user!.onboarded };
    },
  );

  app.post('/auth/refresh', { schema: { tags: ['auth'], body: S.obj({ refreshToken: S.str({ maxLength: 200 }) }, ['refreshToken']) } }, async (req) => {
    return rotateRefresh((req.body as any).refreshToken);
  });

  app.post('/auth/logout', { preHandler: requireAuth, schema: { tags: ['auth'] } }, async (req) => {
    await revokeAll(req.user!.id);
    return { ok: true };
  });

  // ---- Telegram login: app gets a token, user confirms it in the bot, app polls. ----
  app.post('/auth/telegram/start', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } }, schema: { tags: ['auth'] } }, async () => {
    if (!telegramEnabled() || !config.telegram.username) fail(501, 'telegram_not_configured');
    const token = randomToken(18);
    await q(`insert into telegram_tokens (token, purpose) values ($1, 'login')`, [token]);
    return { token, url: `https://t.me/${config.telegram.username}?start=login_${token}` };
  });

  app.get('/auth/telegram/poll', { schema: { tags: ['auth'], querystring: S.obj({ token: S.str({ maxLength: 64 }) }, ['token']) } }, async (req) => {
    const { token } = req.query as { token: string };
    if (token.startsWith('mfa_')) fail(400, 'invalid_token');
    const row = await one(
      `update telegram_tokens set status = 'used'
       where token = $1 and purpose = 'login' and status = 'confirmed' and created_at > now() - interval '15 minutes'
       returning user_id`,
      [token],
    );
    if (!row) return { status: 'pending' };
    const user = await one('select id, role, totp_enabled, onboarded, blocked from users where id = $1', [row.user_id]);
    if (!user || user.blocked) fail(403, 'blocked');
    return { status: 'ok', ...(await finishLogin(user as any)), onboarded: user!.onboarded };
  });

  // ---- Link Telegram to an existing account (from profile settings). ----
  app.post('/auth/telegram/link', { preHandler: requireAuth, schema: { tags: ['auth'] } }, async (req) => {
    if (!telegramEnabled() || !config.telegram.username) fail(501, 'telegram_not_configured');
    const token = randomToken(18);
    await q(`insert into telegram_tokens (token, purpose, user_id) values ($1, 'link', $2)`, [token, req.user!.id]);
    return { url: `https://t.me/${config.telegram.username}?start=link_${token}` };
  });

  app.post('/auth/telegram/unlink', { preHandler: requireAuth, schema: { tags: ['auth'] } }, async (req) => {
    await q('update users set telegram_id = null, telegram_username = null where id = $1', [req.user!.id]);
    return { ok: true };
  });

  // ---- Google / Apple ----
  for (const provider of ['google', 'apple'] as const) {
    app.post(
      `/auth/${provider}`,
      { schema: { tags: ['auth'], body: S.obj({ idToken: S.str({ maxLength: 4096 }), invite: S.str({ maxLength: 16 }) }, ['idToken']) } },
      async (req) => {
        const { idToken, invite } = req.body as { idToken: string; invite?: string };
        const info = provider === 'google' ? await verifyGoogleIdToken(idToken) : await verifyAppleIdToken(idToken);
        const col = provider === 'google' ? 'google_sub' : 'apple_sub';
        let user = await one(`select id, role, blocked, totp_enabled, onboarded from users where ${col} = $1 and deleted_at is null`, [info.sub]);
        if (!user) {
          user = await one(
            `insert into users (${col}, name, invited_by) values ($1, $2, $3) returning id, role, blocked, totp_enabled, onboarded`,
            [info.sub, (info as any).name ?? null, await upsertByInvite(invite)],
          );
        }
        if (user!.blocked) fail(403, 'blocked');
        return { ...(await finishLogin(user as any)), onboarded: user!.onboarded };
      },
    );
  }
}
