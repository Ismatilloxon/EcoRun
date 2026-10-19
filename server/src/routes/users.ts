import type { FastifyInstance } from 'fastify';
import { one, q, tx } from '../db.ts';
import { fail, idParam, S } from '../http.ts';
import { newTotpSecret, optionalAuth, requireAuth, revokeAll, verifyTotp, STAFF } from '../auth.ts';
import { notify, webPushPublicKey } from '../notify.ts';
import { balance, BADGES } from '../points.ts';
import { getSettings } from '../settings.ts';
import { coarse, trimPrivacyZone } from '../geo.ts';
import { isUploadUrl, saveImage } from '../uploads.ts';
import { pickI18n } from '../i18n.ts';
import { emitToUser } from '../realtime.ts';

const DISTRICTS = [
  'Bektemir', 'Chilonzor', 'Mirobod', 'Mirzo Ulug‘bek', 'Olmazor', 'Sergeli', 'Shayxontohur',
  'Uchtepa', 'Yakkasaroy', 'Yangihayot', 'Yashnobod', 'Yunusobod',
];

export const PUBLIC_USER = `u.id, u.name, u.photo_url, u.level, u.district, u.pace_sec_per_km, (u.strava_id is not null) as strava_verified, u.role`;

export async function canView(viewerId: string | null, target: { id: string; visibility: string }) {
  if (viewerId === target.id) return true;
  if (target.visibility === 'all') return true;
  if (target.visibility === 'nobody' || !viewerId) return false;
  return Boolean(await one('select 1 from follows where follower_id = $2 and followee_id = $1', [target.id, viewerId]));
}

export async function isBlockedBetween(a: string, b: string) {
  return Boolean(await one('select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)', [a, b]));
}

export async function userStats(userId: string) {
  const s = await getSettings();
  const st = await one(
    `with a as (select * from activities where user_id = $1 and not flagged)
     select
       coalesce(sum(distance_m) filter (where started_at >= date_trunc('week', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'), 0) / 1000.0 as week_km,
       coalesce(sum(distance_m) filter (where started_at >= date_trunc('month', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'), 0) / 1000.0 as month_km,
       coalesce(sum(distance_m), 0) / 1000.0 as total_km,
       coalesce(sum(distance_m) filter (where is_commute), 0) / 1000.0 as commute_km,
       count(*) as runs,
       count(*) filter (where started_at >= date_trunc('month', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent') as month_runs,
       min((best_efforts->>'1k')::int) as pb_1k,
       min((best_efforts->>'5k')::int) as pb_5k,
       min((best_efforts->>'10k')::int) as pb_10k,
       min((best_efforts->>'21k')::int) as pb_21k
     from a`,
    [userId],
  );
  const eco = await one(
    `select coalesce(sum(bags_small), 0) as small, coalesce(sum(bags_large), 0) as large, count(*) as actions
     from eco_actions where user_id = $1 and status = 'approved'`,
    [userId],
  );
  const group = await one(`select count(*) as n from participations where user_id = $1 and status = 'checked_in'`, [userId]);
  // Weekly streak: consecutive ISO weeks (ending this or last week) with at least one run or check-in.
  const weeks = await q<{ w: string }>(
    `select distinct date_trunc('week', d at time zone 'Asia/Tashkent')::date::text as w from (
       select started_at as d from activities where user_id = $1 and not flagged
       union all select check_in_at from participations where user_id = $1 and status = 'checked_in'
     ) x order by w desc limit 104`,
    [userId],
  );
  let streak = 0;
  const weekStart = (d: Date) => {
    const x = new Date(d);
    const day = (x.getUTCDay() + 6) % 7;
    x.setUTCDate(x.getUTCDate() - day);
    return x.toISOString().slice(0, 10);
  };
  const set = new Set(weeks.map((w) => w.w));
  let cursor = new Date(Date.now() + 5 * 3600_000);
  if (!set.has(weekStart(cursor))) cursor = new Date(cursor.getTime() - 7 * 86400_000);
  while (set.has(weekStart(cursor))) {
    streak++;
    cursor = new Date(cursor.getTime() - 7 * 86400_000);
  }
  const kgWaste = eco!.small * s.impact.kg_per_small_bag + eco!.large * s.impact.kg_per_large_bag;
  const co2Kg = (st!.commute_km * s.impact.co2_g_per_km) / 1000;
  return {
    weekKm: round1(st!.week_km),
    monthKm: round1(st!.month_km),
    totalKm: round1(st!.total_km),
    runs: st!.runs,
    monthRuns: st!.month_runs,
    groupRuns: group!.n,
    streakWeeks: streak,
    pbs: { '1k': st!.pb_1k, '5k': st!.pb_5k, '10k': st!.pb_10k, '21k': st!.pb_21k },
    impact: {
      km: round1(st!.total_km),
      bags: eco!.small + eco!.large,
      ecoActions: eco!.actions,
      kgWaste: round1(kgWaste),
      commuteKm: round1(st!.commute_km),
      co2Kg: round1(co2Kg),
      trees: round1(co2Kg / s.impact.co2_kg_per_tree_year),
    },
  };
}
const round1 = (n: number) => Math.round(Number(n) * 10) / 10;

const profileBody = S.obj({
  name: S.str({ minLength: 1, maxLength: 60 }),
  photo_url: S.nstr({ maxLength: 200 }),
  gender: S.enum(['male', 'female', 'other']),
  birth_year: S.nint({ minimum: 1930, maximum: 2015 }),
  age_range: S.nenum(['18-24', '25-34', '35-44', '45-54', '55+']),
  district: S.nstr({ maxLength: 60 }),
  level: S.enum(['beginner', 'intermediate', 'advanced']),
  pace_sec_per_km: S.nint({ minimum: 150, maximum: 1200 }),
  preferred_distances: S.arr(S.int({ minimum: 1, maximum: 100 }), { maxItems: 8 }),
  preferred_time: S.nenum(['morning', 'day', 'evening']),
  language: S.enum(['uz', 'ru', 'en']),
  visibility: S.enum(['all', 'followers', 'nobody']),
  hide_location: S.bool(),
  notify_nearby: S.bool(),
  notify_radius_km: S.int({ minimum: 1, maximum: 30 }),
  onboarded: S.bool(),
});

export default async function userRoutes(app: FastifyInstance) {
  app.get('/meta', { schema: { tags: ['meta'] } }, async () => {
    const s = await getSettings();
    return { districts: DISTRICTS, impact: s.impact, points: s.points, caps: s.caps, checkin: s.checkin, levels: s.levels, vapidPublicKey: webPushPublicKey() };
  });

  app.post('/uploads', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } }, schema: { tags: ['uploads'] } }, async (req) => {
    const file = await (req as any).file();
    if (!file) fail(400, 'no_file');
    const buf = await file.toBuffer();
    const { url, meta } = await saveImage(buf);
    await q('insert into uploads (url, user_id, meta) values ($1, $2, $3)', [url, req.user!.id, JSON.stringify(meta)]);
    return { url, meta };
  });

  app.get('/me', { preHandler: requireAuth, schema: { tags: ['me'] } }, async (req) => {
    const u = await one(
      `select id, phone, name, photo_url, gender, birth_year, age_range, district, level, pace_sec_per_km, preferred_distances,
              preferred_time, language, role, visibility, hide_location, notify_nearby, notify_radius_km, (strava_id is not null) as strava_verified,
              telegram_id is not null as telegram_linked, telegram_username, invite_code, onboarded, totp_enabled, created_at
       from users where id = $1`,
      [req.user!.id],
    );
    const clubs = await q(
      `select c.id, c.name, c.logo_url, c.verified, cm.role from club_members cm join clubs c on c.id = cm.club_id where cm.user_id = $1 order by c.name`,
      [req.user!.id],
    );
    const partners = await q(`select p.id, p.name from partner_users pu join partners p on p.id = pu.partner_id where pu.user_id = $1`, [req.user!.id]);
    const counts = await one(
      `select (select count(*) from follows where followee_id = $1) as followers, (select count(*) from follows where follower_id = $1) as following,
              (select count(*) from notifications where user_id = $1 and read_at is null) as unread`,
      [req.user!.id],
    );
    return { ...u, clubs, partners, ...counts, points: await balance(req.user!.id) };
  });

  app.patch('/me', { preHandler: requireAuth, schema: { tags: ['me'], body: profileBody } }, async (req) => {
    const body = req.body as Record<string, unknown>;
    if (body.photo_url && !isUploadUrl(body.photo_url)) fail(400, 'invalid_photo');
    const keys = Object.keys(body);
    if (!keys.length) return { ok: true };
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await q(`update users set ${sets} where id = $1`, [req.user!.id, ...keys.map((k) => body[k])]);
    return { ok: true };
  });

  app.post('/me/location', { preHandler: requireAuth, schema: { tags: ['me'], body: S.obj({ lat: S.num({ minimum: -90, maximum: 90 }), lng: S.num({ minimum: -180, maximum: 180 }) }, ['lat', 'lng']) } }, async (req) => {
    const { lat, lng } = req.body as { lat: number; lng: number };
    await q('update users set last_lat = $2, last_lng = $3 where id = $1', [req.user!.id, coarse(lat), coarse(lng)]);
    return { ok: true };
  });

  app.get('/me/stats', { preHandler: requireAuth, schema: { tags: ['me'] } }, async (req) => {
    const badges = await q(
      `select b.code, b.title, b.description, b.icon, ub.awarded_at from user_badges ub join badges b on b.code = ub.badge_code where ub.user_id = $1 order by ub.awarded_at desc`,
      [req.user!.id],
    );
    return { ...(await userStats(req.user!.id)), badges, allBadges: BADGES.map((b) => b.code) };
  });

  app.get('/me/points', { preHandler: requireAuth, schema: { tags: ['me'], querystring: S.obj({ before: S.int() }) } }, async (req) => {
    const { before } = req.query as { before?: number };
    const items = await q(
      `select id, amount, reason, source_type, source_id, status, note, created_at from points_transactions
       where user_id = $1 and ($2::bigint is null or id < $2) order by id desc limit 50`,
      [req.user!.id, before ?? null],
    );
    return { ...(await balance(req.user!.id)), items };
  });

  app.get('/me/activities', { preHandler: requireAuth, schema: { tags: ['me'] } }, async (req) => {
    return q(
      `select a.id, a.run_id, a.started_at, a.distance_m, a.duration_s, a.avg_pace_s, a.source, a.is_commute, a.flagged, a.flag_reason, r.title as run_title
       from activities a left join runs r on r.id = a.run_id where a.user_id = $1 order by a.started_at desc limit 100`,
      [req.user!.id],
    );
  });

  app.get('/me/notifications', { preHandler: requireAuth, schema: { tags: ['me'] } }, async (req) => {
    return q('select id, type, title, body, data, read_at, created_at from notifications where user_id = $1 order by id desc limit 100', [req.user!.id]);
  });

  app.post('/me/notifications/read', { preHandler: requireAuth, schema: { tags: ['me'] } }, async (req) => {
    await q('update notifications set read_at = now() where user_id = $1 and read_at is null', [req.user!.id]);
    return { ok: true };
  });

  app.post(
    '/me/push',
    { preHandler: requireAuth, schema: { tags: ['me'], body: S.obj({ endpoint: S.str({ maxLength: 1000 }), keys: S.obj({ p256dh: S.str(), auth: S.str() }, ['p256dh', 'auth']) }, ['endpoint', 'keys']) } },
    async (req) => {
      const { endpoint, keys } = req.body as any;
      if (!/^https:\/\//.test(endpoint)) fail(400, 'invalid_endpoint');
      await q(
        `insert into push_subscriptions (user_id, endpoint, keys) values ($1, $2, $3)
         on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys`,
        [req.user!.id, endpoint, JSON.stringify(keys)],
      );
      return { ok: true };
    },
  );

  app.get('/me/export', { preHandler: requireAuth, schema: { tags: ['me'] } }, async (req, reply) => {
    const id = req.user!.id;
    const data = {
      exported_at: new Date().toISOString(),
      profile: await one(
        `select id, phone, name, photo_url, gender, birth_year, age_range, district, level, pace_sec_per_km, preferred_distances, preferred_time, language, visibility, created_at from users where id = $1`,
        [id],
      ),
      activities: await q('select * from activities where user_id = $1', [id]),
      participations: await q('select * from participations where user_id = $1', [id]),
      eco_actions: await q('select * from eco_actions where user_id = $1', [id]),
      dirty_spots: await q('select * from dirty_spots where reporter_id = $1', [id]),
      points: await q('select * from points_transactions where user_id = $1', [id]),
      redemptions: await q('select * from redemptions where user_id = $1', [id]),
      messages: await q('select run_id, body, created_at from messages where user_id = $1', [id]),
      follows: await q('select followee_id, created_at from follows where follower_id = $1', [id]),
    };
    reply.header('content-disposition', 'attachment; filename="ecorun-data.json"');
    return data;
  });

  app.delete('/me', { preHandler: requireAuth, schema: { tags: ['me'] } }, async (req) => {
    const id = req.user!.id;
    await tx(async (c) => {
      await c.query(
        `update users set deleted_at = now(), phone = null, name = 'Deleted user', photo_url = null, telegram_id = null, telegram_username = null,
           google_sub = null, apple_sub = null, strava_id = null, strava_tokens = null, birth_year = null, last_lat = null, last_lng = null,
           visibility = 'nobody' where id = $1`,
        [id],
      );
      await c.query('delete from follows where follower_id = $1 or followee_id = $1', [id]);
      await c.query('delete from push_subscriptions where user_id = $1', [id]);
      await c.query(`update activities set track = null where user_id = $1`, [id]);
      await c.query(`update participations set status = 'left' where user_id = $1 and status in ('joined','waitlist','pending')`, [id]);
    });
    await revokeAll(id);
    return { ok: true };
  });

  // ---- Staff 2FA setup ----
  app.post('/me/totp/setup', { preHandler: requireAuth, schema: { tags: ['me'] } }, async (req) => {
    if (!STAFF.includes(req.user!.role) && req.user!.role !== 'partner') fail(403, 'forbidden');
    const u = await one('select totp_enabled, phone from users where id = $1', [req.user!.id]);
    if (u?.totp_enabled) fail(409, 'already_enabled');
    const secret = newTotpSecret();
    await q('update users set totp_secret = $2 where id = $1', [req.user!.id, secret]);
    const label = encodeURIComponent(`EcoRun:${u?.phone ?? req.user!.id}`);
    return { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=EcoRun` };
  });

  app.post('/me/totp/enable', { preHandler: requireAuth, schema: { tags: ['me'], body: S.obj({ code: S.str({ pattern: '^\\d{6}$' }) }, ['code']) } }, async (req) => {
    const u = await one('select totp_secret from users where id = $1', [req.user!.id]);
    if (!u?.totp_secret || !verifyTotp(u.totp_secret, (req.body as any).code)) fail(400, 'totp_invalid');
    await q('update users set totp_enabled = true where id = $1', [req.user!.id]);
    return { ok: true };
  });

  // ---- Public profiles & social ----
  app.get('/users/:id', { preHandler: optionalAuth, schema: { tags: ['users'], params: idParam } }, async (req) => {
    const { id } = req.params as { id: string };
    const viewer = req.user?.id ?? null;
    const u = await one(`select ${PUBLIC_USER}, u.visibility, u.created_at from users u where u.id = $1 and u.deleted_at is null and not u.blocked`, [id]);
    if (!u) fail(404, 'not_found');
    if (viewer && (await isBlockedBetween(viewer, id))) fail(404, 'not_found');
    const visible = await canView(viewer, u as any);
    const counts = await one(
      `select (select count(*) from follows where followee_id = $1) as followers, (select count(*) from follows where follower_id = $1) as following,
              exists(select 1 from follows where follower_id = $2 and followee_id = $1) as is_following,
              exists(select 1 from follows where follower_id = $1 and followee_id = $2) as follows_you`,
      [id, viewer],
    );
    const base = { ...u, ...counts, visible, points: await balance(id) };
    delete (base as any).visibility;
    if (!visible) return base;
    const badges = await q(`select b.code, b.title, b.icon from user_badges ub join badges b on b.code = ub.badge_code where ub.user_id = $1`, [id]);
    const clubs = await q(`select c.id, c.name, c.logo_url, c.verified from club_members cm join clubs c on c.id = cm.club_id where cm.user_id = $1 and not c.hidden`, [id]);
    const activities = await q(
      `select id, started_at, distance_m, duration_s, avg_pace_s, track, is_commute from activities
       where user_id = $1 and not flagged order by started_at desc limit 10`,
      [id],
    );
    const hide = (await one('select hide_location from users where id = $1', [id]))?.hide_location;
    for (const a of activities) a.track = viewer === id ? a.track : hide ? trimPrivacyZone(a.track ?? []) : a.track;
    return { ...base, stats: await userStats(id), badges, clubs, activities };
  });

  app.post('/users/:id/follow', { preHandler: requireAuth, schema: { tags: ['users'], params: idParam } }, async (req) => {
    const { id } = req.params as { id: string };
    if (id === req.user!.id) fail(400, 'self');
    if (await isBlockedBetween(req.user!.id, id)) fail(403, 'blocked');
    const r = await one('insert into follows (follower_id, followee_id) values ($1, $2) on conflict do nothing returning 1', [req.user!.id, id]);
    if (r) await notify(id, 'new_follower', { name: req.user!.name ?? 'EcoRun' }, { user: req.user!.id }, { telegram: false });
    return { ok: true };
  });

  app.delete('/users/:id/follow', { preHandler: requireAuth, schema: { tags: ['users'], params: idParam } }, async (req) => {
    await q('delete from follows where follower_id = $1 and followee_id = $2', [req.user!.id, (req.params as any).id]);
    return { ok: true };
  });

  app.post('/users/:id/block', { preHandler: requireAuth, schema: { tags: ['users'], params: idParam } }, async (req) => {
    const { id } = req.params as { id: string };
    if (id === req.user!.id) fail(400, 'self');
    await q('insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing', [req.user!.id, id]);
    await q('delete from follows where (follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)', [req.user!.id, id]);
    return { ok: true };
  });

  app.delete('/users/:id/block', { preHandler: requireAuth, schema: { tags: ['users'], params: idParam } }, async (req) => {
    await q('delete from blocks where blocker_id = $1 and blocked_id = $2', [req.user!.id, (req.params as any).id]);
    return { ok: true };
  });

  app.get('/me/blocks', { preHandler: requireAuth, schema: { tags: ['me'] } }, async (req) =>
    q(`select ${PUBLIC_USER} from blocks b join users u on u.id = b.blocked_id where b.blocker_id = $1`, [req.user!.id]),
  );

  app.post(
    '/reports',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        tags: ['moderation'],
        body: S.obj(
          { target_type: S.enum(['user', 'run', 'message', 'club', 'eco_action']), target_id: S.str({ maxLength: 64 }), reason: S.enum(['spam', 'abuse', 'fake', 'unsafe', 'inappropriate', 'other']), details: S.str({ maxLength: 1000 }) },
          ['target_type', 'target_id', 'reason'],
        ),
      },
    },
    async (req) => {
      const b = req.body as any;
      await q('insert into reports (reporter_id, target_type, target_id, reason, details) values ($1, $2, $3, $4, $5)', [
        req.user!.id, b.target_type, b.target_id, b.reason, b.details ?? null,
      ]);
      return { ok: true };
    },
  );

  // ---- Feed from followed runners and joined clubs ----
  app.get('/feed', { preHandler: requireAuth, schema: { tags: ['social'] } }, async (req) => {
    const me = req.user!.id;
    return q(
      `with f as (select followee_id as id from follows where follower_id = $1),
            cl as (select club_id from club_members where user_id = $1)
       select * from (
         select 'activity' as kind, a.id::text, a.started_at as at, json_build_object('distance_m', a.distance_m, 'duration_s', a.duration_s, 'avg_pace_s', a.avg_pace_s, 'is_commute', a.is_commute) as data,
                json_build_object('id', u.id, 'name', u.name, 'photo_url', u.photo_url) as actor
         from activities a join users u on u.id = a.user_id
         where a.user_id in (select id from f) and not a.flagged and u.visibility <> 'nobody' and u.deleted_at is null
         union all
         select 'eco', e.id::text, e.reviewed_at, json_build_object('bags', e.bags_small + e.bags_large, 'waste_types', e.waste_types, 'photo', e.photo_after_url),
                json_build_object('id', u.id, 'name', u.name, 'photo_url', u.photo_url)
         from eco_actions e join users u on u.id = e.user_id
         where e.user_id in (select id from f) and e.status = 'approved' and u.visibility <> 'nobody'
         union all
         select 'run', r.id::text, r.created_at, json_build_object('title', r.title, 'start_at', r.start_at, 'type', r.type, 'club', c.name),
                json_build_object('id', u.id, 'name', u.name, 'photo_url', u.photo_url)
         from runs r join users u on u.id = r.organizer_id left join clubs c on c.id = r.club_id
         where (r.organizer_id in (select id from f) or r.club_id in (select club_id from cl)) and not r.hidden and r.status = 'scheduled'
           and r.start_at > now() and (not r.women_only or $2 = 'female')
         union all
         select 'badge', ub.badge_code, ub.awarded_at, json_build_object('title', b.title, 'icon', b.icon),
                json_build_object('id', u.id, 'name', u.name, 'photo_url', u.photo_url)
         from user_badges ub join badges b on b.code = ub.badge_code join users u on u.id = ub.user_id
         where ub.user_id in (select id from f) and u.visibility <> 'nobody'
       ) x where at is not null order by at desc limit 60`,
      [me, req.user!.gender ?? ''],
    );
  });

  // ---- Running buddy suggestions: same district, similar pace & time ----
  app.get('/buddies', { preHandler: requireAuth, schema: { tags: ['social'] } }, async (req) => {
    const me = await one('select district, pace_sec_per_km, preferred_time, level from users where id = $1', [req.user!.id]);
    return q(
      `select ${PUBLIC_USER}, u.preferred_time,
              (case when u.district = $2 then 3 else 0 end
               + case when u.preferred_time = $4 then 2 else 0 end
               + case when u.level = $5 then 1 else 0 end
               + case when $3::int is not null and u.pace_sec_per_km is not null and abs(u.pace_sec_per_km - $3) <= 45 then 3 else 0 end) as score
       from users u
       where u.id <> $1 and u.deleted_at is null and not u.blocked and u.onboarded and u.visibility = 'all'
         and not exists (select 1 from follows where follower_id = $1 and followee_id = u.id)
         and not exists (select 1 from blocks where (blocker_id = $1 and blocked_id = u.id) or (blocker_id = u.id and blocked_id = $1))
       order by score desc, u.created_at desc limit 12`,
      [req.user!.id, me?.district ?? null, me?.pace_sec_per_km ?? null, me?.preferred_time ?? null, me?.level ?? null],
    );
  });

  // ---- 1-to-1 messages: only mutual followers or people who share a run ----
  async function canDm(a: string, b: string) {
    if (await isBlockedBetween(a, b)) return false;
    const mutual = await one(
      'select 1 from follows f1 join follows f2 on f2.follower_id = f1.followee_id and f2.followee_id = f1.follower_id where f1.follower_id = $1 and f1.followee_id = $2',
      [a, b],
    );
    if (mutual) return true;
    return Boolean(
      await one(
        `select 1 from participations p1 join participations p2 on p2.run_id = p1.run_id
         where p1.user_id = $1 and p2.user_id = $2 and p1.status in ('joined','checked_in') and p2.status in ('joined','checked_in') limit 1`,
        [a, b],
      ),
    );
  }

  app.get('/dm', { preHandler: requireAuth, schema: { tags: ['social'] } }, async (req) => {
    return q(
      `select distinct on (other) other as user_id, u.name, u.photo_url, d.body, d.created_at,
              (select count(*) from direct_messages x where x.sender_id = other and x.recipient_id = $1 and x.read_at is null) as unread
       from (select *, case when sender_id = $1 then recipient_id else sender_id end as other from direct_messages where sender_id = $1 or recipient_id = $1) d
       join users u on u.id = d.other order by other, d.id desc`,
      [req.user!.id],
    );
  });

  app.get('/dm/:id', { preHandler: requireAuth, schema: { tags: ['social'], params: idParam } }, async (req) => {
    const other = (req.params as any).id;
    await q('update direct_messages set read_at = now() where sender_id = $2 and recipient_id = $1 and read_at is null', [req.user!.id, other]);
    const messages = await q(
      `select id, sender_id, body, created_at from direct_messages
       where (sender_id = $1 and recipient_id = $2) or (sender_id = $2 and recipient_id = $1) order by id desc limit 100`,
      [req.user!.id, other],
    );
    return { canMessage: await canDm(req.user!.id, other), messages: messages.reverse() };
  });

  app.post(
    '/dm/:id',
    { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['social'], params: idParam, body: S.obj({ body: S.str({ minLength: 1, maxLength: 2000 }) }, ['body']) } },
    async (req) => {
      const other = (req.params as any).id;
      if (!(await canDm(req.user!.id, other))) fail(403, 'dm_not_allowed');
      const m = await one('insert into direct_messages (sender_id, recipient_id, body) values ($1, $2, $3) returning id, sender_id, body, created_at', [
        req.user!.id, other, (req.body as any).body,
      ]);
      emitToUser(other, { type: 'dm', from: req.user!.id, message: m });
      await notify(other, 'dm', { name: req.user!.name ?? '', text: String((req.body as any).body).slice(0, 80) }, { dm: req.user!.id }, { telegram: false });
      return m;
    },
  );

  // ---- Leaderboards ----
  app.get(
    '/leaderboard',
    { preHandler: optionalAuth, schema: { tags: ['gamification'], querystring: S.obj({ period: S.enum(['week', 'month', 'all']), metric: S.enum(['km', 'points']), club: S.uuid() }) } },
    async (req) => {
      const { period = 'week', metric = 'km', club } = req.query as any;
      const since =
        period === 'week'
          ? `date_trunc('week', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'`
          : period === 'month'
            ? `date_trunc('month', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'`
            : `'-infinity'::timestamptz`;
      const inner =
        metric === 'km'
          ? `select user_id, sum(distance_m) / 1000.0 as value from activities where not flagged and started_at >= ${since} group by user_id`
          : `select user_id, sum(amount)::numeric as value from points_transactions
             where status = 'confirmed' and amount > 0 and reason not in ('redemption_refund','admin_adjust') and created_at >= ${since} group by user_id`;
      const rows = await q(
        `with t as (${inner}), ranked as (
           select t.user_id, round(t.value::numeric, 1)::float as value, rank() over (order by t.value desc) as rank
           from t join users u on u.id = t.user_id
           where u.deleted_at is null and not u.blocked and u.visibility <> 'nobody'
             and ($1::uuid is null or exists (select 1 from club_members cm where cm.club_id = $1 and cm.user_id = t.user_id))
         )
         select r.rank, r.value, u.id, u.name, u.photo_url, u.district from ranked r join users u on u.id = r.user_id order by r.rank limit 100`,
        [club ?? null],
      );
      const mine = req.user ? rows.find((r) => r.id === req.user!.id) ?? null : null;
      return { period, metric, rows: rows.slice(0, 50), mine };
    },
  );

  // ---- City counter (home screen) ----
  app.get('/city', { schema: { tags: ['eco'] } }, async () => {
    const s = await getSettings();
    const r = await one(
      `with m as (select date_trunc('month', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent' as since)
       select
         (select coalesce(sum(distance_m), 0) / 1000.0 from activities, m where not flagged and started_at >= m.since) as km,
         (select coalesce(sum(bags_small + bags_large), 0) from eco_actions, m where status = 'approved' and created_at >= m.since) as bags,
         (select coalesce(sum(bags_small), 0) * $1 + coalesce(sum(bags_large), 0) * $2 from eco_actions, m where status = 'approved' and created_at >= m.since) as kg,
         (select count(distinct user_id) from (
            select user_id from activities, m where started_at >= m.since and not flagged
            union select user_id from participations, m where status = 'checked_in' and check_in_at >= m.since) x) as participants,
         (select count(*) from runs, m where start_at >= m.since and status <> 'cancelled' and not hidden) as runs`,
      [s.impact.kg_per_small_bag, s.impact.kg_per_large_bag],
    );
    return { km: Math.round(r!.km), bags: r!.bags, kgWaste: Math.round(r!.kg), participants: r!.participants, runs: r!.runs };
  });

  app.get('/content', { schema: { tags: ['content'], querystring: S.obj({ kind: S.enum(['banner', 'faq', 'terms', 'privacy']), lang: S.enum(['uz', 'ru', 'en']) }) } }, async (req) => {
    const { kind, lang = 'uz' } = req.query as any;
    const rows = await q(`select id, kind, title, body, image_url, link from content where active and ($1::text is null or kind = $1) order by sort, created_at`, [kind ?? null]);
    return rows.map((r) => ({ ...r, title: pickI18n(r.title, lang), body: pickI18n(r.body, lang) }));
  });
}
