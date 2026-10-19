import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import { one, q } from '../db.ts';
import { fail, S } from '../http.ts';
import { accessTokenFor, normalizePhone } from '../auth.ts';
import { coarse } from '../geo.ts';
import { getSettings } from '../settings.ts';
import { userStats } from './users.ts';

const tgSchema = S.obj(
  { id: S.int(), username: S.nstr({ maxLength: 64 }), first_name: S.nstr({ maxLength: 128 }), last_name: S.nstr({ maxLength: 128 }), language_code: S.nstr({ maxLength: 16 }) },
  ['id'],
  { additionalProperties: true },
);
const body = (props: Record<string, any> = {}, required: string[] = []) => S.obj({ tg: tgSchema, ...props }, ['tg', ...required]);

function checkSecret(req: FastifyRequest) {
  const got = Buffer.from(String(req.headers['x-bot-secret'] ?? ''));
  const want = Buffer.from(config.botSecret);
  if (!config.botSecret || got.length !== want.length || !crypto.timingSafeEqual(got, want)) fail(401, 'bad_bot_secret');
}

const langOf = (code?: string | null) => (code?.startsWith('ru') ? 'ru' : code?.startsWith('en') ? 'en' : 'uz');

async function userByTg(tgId: number) {
  return one('select id, name, role, language, gender, phone, onboarded from users where telegram_id = $1 and deleted_at is null and not blocked', [tgId]);
}

export default async function botRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => checkSecret(req));

  /** Calls a public API route as the given user so bot actions follow the same rules as the app. */
  async function asUser(user: { id: string; role: string }, method: 'GET' | 'POST', url: string, payload?: unknown) {
    const token = await accessTokenFor(user.id, user.role);
    const res = await app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, payload: payload as any });
    const json = res.json();
    if (res.statusCode >= 400) fail(res.statusCode, json.error ?? 'error', json.message);
    return json;
  }

  async function need(tg: { id: number }) {
    const u = await userByTg(tg.id);
    if (!u) fail(404, 'not_linked');
    return u!;
  }

  app.post('/internal/bot/user', { schema: { body: body() } }, async (req) => {
    const { tg } = req.body as any;
    const u = await userByTg(tg.id);
    if (!u) return { linked: false, language: langOf(tg.language_code) };
    const partner = await one('select p.id, p.name from partner_users pu join partners p on p.id = pu.partner_id where pu.user_id = $1 limit 1', [u.id]);
    return { linked: true, user: u, partner, language: u.language };
  });

  app.post('/internal/bot/lang', { schema: { body: body({ lang: S.enum(['uz', 'ru', 'en']) }, ['lang']) } }, async (req) => {
    const { tg, lang } = req.body as any;
    await q('update users set language = $2 where telegram_id = $1', [tg.id, lang]);
    return { ok: true };
  });

  app.post('/internal/bot/login', { schema: { body: body({ token: S.str({ maxLength: 64 }) }, ['token']) } }, async (req) => {
    const { tg, token } = req.body as any;
    const t = await one(`select token from telegram_tokens where token = $1 and purpose = 'login' and status = 'pending' and created_at > now() - interval '15 minutes'`, [token]);
    if (!t) fail(410, 'token_expired');
    let u = await userByTg(tg.id);
    let isNew = false;
    if (!u) {
      const blocked = await one('select 1 from users where telegram_id = $1', [tg.id]);
      if (blocked) fail(403, 'blocked');
      const name = [tg.first_name, tg.last_name].filter(Boolean).join(' ').slice(0, 60) || null;
      u = await one(`insert into users (telegram_id, telegram_username, name, language) values ($1, $2, $3, $4) returning id, name, role, language, onboarded`, [
        tg.id, tg.username ?? null, name, langOf(tg.language_code),
      ]);
      isNew = true;
    }
    await q(`update telegram_tokens set status = 'confirmed', user_id = $2, telegram_id = $3 where token = $1`, [token, u!.id, tg.id]);
    return { ok: true, isNew, language: u!.language };
  });

  /**
   * Telegram login completed with the phone number shared through Telegram's
   * own contact button. The bot checks contact.user_id before calling this
   * route, so the phone number is verified by Telegram rather than user input.
   */
  app.post('/internal/bot/login-phone', { schema: { body: body({ token: S.str({ maxLength: 64 }), phone: S.str({ maxLength: 32 }) }, ['token', 'phone']) } }, async (req) => {
    const { tg, token, phone: rawPhone } = req.body as any;
    const tokenRow = await one(
      `select token from telegram_tokens
       where token = $1 and purpose = 'login' and status = 'pending' and created_at > now() - interval '15 minutes'`,
      [token],
    );
    if (!tokenRow) fail(410, 'token_expired');

    const phone = normalizePhone(rawPhone);
    const byPhone = await one<any>(
      `select id, name, role, language, onboarded, blocked, deleted_at, telegram_id
       from users where phone = $1`,
      [phone],
    );
    if (byPhone?.blocked || byPhone?.deleted_at) fail(403, 'blocked');

    let user = byPhone;
    const byTg = await userByTg(tg.id);
    if (user && byTg && byTg.id !== user.id) {
      const used = await one(
        'select 1 from activities where user_id = $1 union all select 1 from participations where user_id = $1 limit 1',
        [byTg.id],
      );
      if (byTg.onboarded || byTg.phone || used) fail(409, 'telegram_in_use');
      await q('update users set telegram_id = null, deleted_at = now() where id = $1', [byTg.id]);
    }
    if (user && user.telegram_id && Number(user.telegram_id) !== Number(tg.id)) {
      fail(409, 'phone_in_use');
    }

    if (!user && byTg) {
      // Telegram-only accounts already have a verified Telegram identity. Add
      // the verified shared phone to that same account, even after onboarding.
      // Creating a second row would violate the unique telegram_id constraint.
      if (byTg.phone && normalizePhone(byTg.phone) !== phone) fail(409, 'phone_in_use');
      await q('update users set phone = $2, telegram_username = $3 where id = $1', [byTg.id, phone, tg.username ?? null]);
      user = await one<any>('select id, name, role, language, onboarded from users where id = $1', [byTg.id]);
    } else if (!user) {
      const name = [tg.first_name, tg.last_name].filter(Boolean).join(' ').slice(0, 60) || null;
      user = await one<any>(
        `insert into users (phone, telegram_id, telegram_username, name, language)
         values ($1, $2, $3, $4, $5)
         returning id, name, role, language, onboarded`,
        [phone, tg.id, tg.username ?? null, name, langOf(tg.language_code)],
      );
    } else {
      await q(
        `update users set telegram_id = $2, telegram_username = $3
         where id = $1 and deleted_at is null and not blocked`,
        [user.id, tg.id, tg.username ?? null],
      );
      user = await one<any>('select id, name, role, language, onboarded from users where id = $1', [user.id]);
    }

    await q(
      `update telegram_tokens set status = 'confirmed', user_id = $2, telegram_id = $3
       where token = $1 and purpose = 'login' and status = 'pending'`,
      [token, user!.id, tg.id],
    );
    return { ok: true, isNew: !byPhone && !byTg, language: user!.language };
  });

  app.post('/internal/bot/link', { schema: { body: body({ token: S.str({ maxLength: 64 }) }, ['token']) } }, async (req) => {
    const { tg, token } = req.body as any;
    const t = await one(`select user_id from telegram_tokens where token = $1 and purpose = 'link' and status = 'pending' and created_at > now() - interval '15 minutes'`, [token]);
    if (!t) fail(410, 'token_expired');
    const other = await one('select id, onboarded, phone from users where telegram_id = $1 and id <> $2', [tg.id, t!.user_id]);
    if (other) {
      // An empty account created by an earlier Telegram login is merged away; a real one blocks linking.
      const used = await one('select 1 from activities where user_id = $1 union all select 1 from participations where user_id = $1 limit 1', [other.id]);
      if (other.onboarded || other.phone || used) fail(409, 'telegram_in_use');
      await q(`update users set telegram_id = null, deleted_at = now() where id = $1`, [other.id]);
    }
    await q('update users set telegram_id = $2, telegram_username = $3 where id = $1', [t!.user_id, tg.id, tg.username ?? null]);
    await q(`update telegram_tokens set status = 'used', telegram_id = $2 where token = $1`, [token, tg.id]);
    const u = await one('select language, name from users where id = $1', [t!.user_id]);
    return { ok: true, language: u?.language, name: u?.name };
  });

  /** Contact shared via Telegram's own button (bot checks contact.user_id === from.id), so the phone is verified. */
  app.post('/internal/bot/contact', { schema: { body: body({ phone: S.str({ maxLength: 32 }) }, ['phone']) } }, async (req) => {
    const { tg, phone: raw } = req.body as any;
    const phone = normalizePhone(raw);
    const byPhone = await one('select id, telegram_id from users where phone = $1 and deleted_at is null', [phone]);
    const byTg = await userByTg(tg.id);
    if (byPhone && byTg && byPhone.id === byTg.id) return { ok: true, status: 'already' };
    if (byPhone && byPhone.telegram_id && byPhone.telegram_id !== tg.id) fail(409, 'phone_in_use');
    if (byPhone && !byTg) {
      await q('update users set telegram_id = $2, telegram_username = $3 where id = $1', [byPhone.id, tg.id, tg.username ?? null]);
      return { ok: true, status: 'linked_existing' };
    }
    if (byPhone && byTg) {
      const used = await one('select 1 from activities where user_id = $1 union all select 1 from participations where user_id = $1 limit 1', [byTg.id]);
      if (byTg.onboarded || used) fail(409, 'phone_in_use');
      await q('update users set telegram_id = null, deleted_at = now() where id = $1', [byTg.id]);
      await q('update users set telegram_id = $2, telegram_username = $3 where id = $1', [byPhone.id, tg.id, tg.username ?? null]);
      return { ok: true, status: 'merged' };
    }
    if (byTg) {
      await q('update users set phone = $2 where id = $1', [byTg.id, phone]);
      return { ok: true, status: 'phone_added' };
    }
    const u = await one(`insert into users (telegram_id, telegram_username, phone, name, language) values ($1,$2,$3,$4,$5) returning id`, [
      tg.id, tg.username ?? null, phone, tg.first_name ?? null, langOf(tg.language_code),
    ]);
    return { ok: true, status: 'created', id: u!.id };
  });

  app.post('/internal/bot/nearby', { schema: { body: body({ lat: S.num(), lng: S.num() }, ['lat', 'lng']) } }, async (req) => {
    const { tg, lat, lng } = req.body as any;
    const u = await userByTg(tg.id);
    if (u) await q('update users set last_lat = $2, last_lng = $3 where id = $1', [u.id, coarse(lat), coarse(lng)]);
    const to = new Date(Date.now() + 7 * 86400_000).toISOString();
    const url = `/runs?lat=${lat}&lng=${lng}&radius_km=15&to=${encodeURIComponent(to)}&limit=50`;
    const runs = u ? await asUser(u, 'GET', url) : (await app.inject({ method: 'GET', url: `/api/v1${url}` })).json();
    return (runs as any[]).sort((a, b) => a.distance_m - b.distance_m).slice(0, 6);
  });

  app.post('/internal/bot/join', { schema: { body: body({ runId: S.uuid() }, ['runId']) } }, async (req) => {
    const { tg, runId } = req.body as any;
    return asUser(await need(tg), 'POST', `/runs/${runId}/join`);
  });

  app.post('/internal/bot/myruns', { schema: { body: body() } }, async (req) => {
    const { tg } = req.body as any;
    const r = await asUser(await need(tg), 'GET', '/runs/mine');
    return r.upcoming.slice(0, 8);
  });

  app.post('/internal/bot/checkin', { schema: { body: body({ lat: S.num(), lng: S.num() }, ['lat', 'lng']) } }, async (req) => {
    const { tg, lat, lng } = req.body as any;
    const u = await need(tg);
    const s = await getSettings();
    const candidates = await q(
      `select r.id, r.title, earth_distance(ll_to_earth($2, $3), ll_to_earth(r.meeting_lat, r.meeting_lng)) as d
       from participations p join runs r on r.id = p.run_id
       where p.user_id = $1 and p.status = 'joined' and r.status = 'scheduled'
         and now() between r.start_at - make_interval(mins => $4) and r.start_at + make_interval(mins => $5)
       order by d limit 3`,
      [u.id, lat, lng, s.checkin.window_before_min, s.checkin.window_after_min],
    );
    if (!candidates.length) return { status: 'no_run' };
    const best = candidates[0];
    if (best.d > s.checkin.radius_m) return { status: 'too_far', title: best.title, distance: Math.round(best.d), radius: s.checkin.radius_m };
    const res = await asUser(u, 'POST', `/runs/${best.id}/checkin`, { lat, lng, accuracy: 0 });
    return { status: res.already ? 'already' : 'ok', title: best.title, points: res.points };
  });

  app.post('/internal/bot/points', { schema: { body: body() } }, async (req) => {
    const { tg } = req.body as any;
    const u = await need(tg);
    const p = await asUser(u, 'GET', '/me/points');
    const st = await userStats(u.id);
    return { balance: p.balance, pending: p.pending, level: p.level, next: p.next, earned: p.earned, stats: st };
  });

  app.post('/internal/bot/redeem', { schema: { body: body({ code: S.str({ maxLength: 32 }), confirm: S.bool(), branch: S.nstr({ maxLength: 120 }) }, ['code']) } }, async (req) => {
    const { tg, code, confirm, branch } = req.body as any;
    const u = await need(tg);
    if (!['partner', 'admin'].includes(u.role)) fail(403, 'not_partner');
    return confirm ? asUser(u, 'POST', '/partner/redeem', { code, branch: branch ?? 'Telegram' }) : asUser(u, 'POST', '/partner/redeem/check', { code });
  });

  app.post('/internal/bot/eco-review', { schema: { body: body({ id: S.uuid(), approve: S.bool() }, ['id', 'approve']) } }, async (req) => {
    const { tg, id, approve } = req.body as any;
    const u = await need(tg);
    return asUser(u, 'POST', `/eco/actions/${id}/review`, { approve, reason: approve ? null : 'Rejected by organizer (Telegram)' });
  });
}
