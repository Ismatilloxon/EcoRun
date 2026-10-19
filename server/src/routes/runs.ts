import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { one, q, tx } from '../db.ts';
import { fail, idParam, S, toCsv } from '../http.ts';
import { optionalAuth, requireAuth, STAFF, type AuthUser } from '../auth.ts';
import { distanceM } from '../geo.ts';
import { fmtTime } from '../i18n.ts';
import { notify, notifyMany } from '../notify.ts';
import { afterProgress, award, maybeRewardInviter } from '../points.ts';
import { emitToRun } from '../realtime.ts';
import { getSettings } from '../settings.ts';
import { esc, tgSend } from '../telegram.ts';
import { isUploadUrl } from '../uploads.ts';
import { isBlockedBetween } from './users.ts';

const RUN_FIELDS = `
  r.id, r.title, r.type, r.start_at, r.meeting_lat, r.meeting_lng, r.meeting_address, r.district, r.distance_km, r.pace_groups,
  r.level, r.capacity, r.women_only, r.requires_approval, r.cover_url, r.status, r.series_id, r.recurrence_rule, r.featured,
  r.plogging_supplies, r.plogging_dropoff, r.dirty_spot_id,
  json_build_object('id', o.id, 'name', o.name, 'photo_url', o.photo_url, 'strava_verified', o.strava_id is not null) as organizer,
  case when c.id is null then null else json_build_object('id', c.id, 'name', c.name, 'logo_url', c.logo_url, 'verified', c.verified) end as club,
  (select count(*) from participations p where p.run_id = r.id and p.status in ('joined','checked_in')) as participants_count,
  (select count(*) from participations p where p.run_id = r.id and p.status = 'waitlist') as waitlist_count,
  (select count(*) from participations p where p.run_id = r.id and p.status = 'checked_in') as checked_in_count`;

/** Women-only runs are visible only to women (and to their organizer / staff). */
export function womenOnlyFilter(user: AuthUser | null, alias = 'r') {
  if (user && (STAFF.includes(user.role) || user.gender === 'female')) return 'true';
  if (user) return `(not ${alias}.women_only or ${alias}.organizer_id = '${user.id}')`;
  return `not ${alias}.women_only`;
}

async function canManageRun(user: AuthUser, run: { organizer_id: string; club_id: string | null }) {
  if (run.organizer_id === user.id || STAFF.includes(user.role)) return true;
  if (!run.club_id) return false;
  return Boolean(await one(`select 1 from club_members where club_id = $1 and user_id = $2 and role in ('owner','co_organizer')`, [run.club_id, user.id]));
}

async function loadRun(id: string) {
  const run = await one('select * from runs where id = $1', [id]);
  if (!run) fail(404, 'run_not_found');
  return run!;
}

const runBody = (required: string[]) =>
  S.obj(
    {
      title: S.str({ minLength: 3, maxLength: 120 }),
      description: S.nstr({ maxLength: 3000 }),
      type: S.enum(['casual', 'training', 'plogging', 'race_prep']),
      start_at: S.str({ format: 'date-time' }),
      meeting_lat: S.num({ minimum: -90, maximum: 90 }),
      meeting_lng: S.num({ minimum: -180, maximum: 180 }),
      meeting_address: S.nstr({ maxLength: 200 }),
      district: S.nstr({ maxLength: 60 }),
      route: { anyOf: [{ type: 'null' }, S.arr(S.arr(S.num(), { minItems: 2, maxItems: 2 }), { maxItems: 3000 })] },
      distance_km: S.nnum({ minimum: 0.5, maximum: 100 }),
      pace_groups: S.arr(S.str({ pattern: '^\\d{1,2}:\\d{2}$' }), { maxItems: 6 }),
      level: S.enum(['beginner', 'intermediate', 'advanced', 'all']),
      capacity: S.nint({ minimum: 2, maximum: 1000 }),
      women_only: S.bool(),
      requires_approval: S.bool(),
      recurrence_rule: S.nenum(['WEEKLY']),
      cover_url: S.nstr({ maxLength: 200 }),
      club_id: S.nuuid(),
      plogging_supplies: S.nstr({ maxLength: 300 }),
      plogging_dropoff: S.nstr({ maxLength: 300 }),
      dirty_spot_id: S.nuuid(),
    },
    required,
  );

/** Weekly series: keep 4 upcoming instances materialised. */
export async function extendSeries(seriesId: string) {
  const base = await one('select * from runs where id = $1', [seriesId]);
  if (!base || base.status === 'cancelled' || !base.recurrence_rule) return;
  const last = await one(`select max(start_at) as last, count(*) filter (where start_at > now()) as upcoming from runs where series_id = $1 and status <> 'cancelled'`, [seriesId]);
  let next = new Date(last!.last);
  let upcoming = Number(last!.upcoming);
  while (upcoming < 4) {
    next = new Date(next.getTime() + 7 * 86400_000);
    await q(
      `insert into runs (organizer_id, club_id, series_id, title, description, type, start_at, meeting_lat, meeting_lng, meeting_address, district,
         route, distance_km, pace_groups, level, capacity, women_only, requires_approval, recurrence_rule, cover_url, plogging_supplies, plogging_dropoff)
       select organizer_id, club_id, series_id, title, description, type, $2, meeting_lat, meeting_lng, meeting_address, district,
         route, distance_km, pace_groups, level, capacity, women_only, requires_approval, recurrence_rule, cover_url, plogging_supplies, plogging_dropoff
       from runs where id = $1`,
      [seriesId, next.toISOString()],
    );
    upcoming++;
  }
}

async function announceNewRun(run: any) {
  // Nearby runners who opted in, within their own radius of their coarse last location.
  const nearby = await q(
    `select id from users
     where notify_nearby and deleted_at is null and not blocked and id <> $1 and last_lat is not null
       and earth_distance(ll_to_earth(last_lat, last_lng), ll_to_earth($2, $3)) <= notify_radius_km * 1000
       and ($4::boolean = false or gender = 'female')
     limit 500`,
    [run.organizer_id, run.meeting_lat, run.meeting_lng, run.women_only],
  );
  for (const u of nearby) {
    const lang = (await one('select language from users where id = $1', [u.id]))?.language;
    await notify(u.id, 'new_run_nearby', { run: run.title, time: fmtTime(run.start_at, lang) }, { run: run.id });
  }
  if (config.telegram.channelId && !run.women_only) {
    await tgSend(
      config.telegram.channelId,
      `<b>${esc(run.title)}</b>\n${esc(fmtTime(run.start_at, 'uz'))}\n${esc(run.meeting_address ?? '')}${run.distance_km ? `\n${run.distance_km} km` : ''}`,
    );
  }
}

async function promoteWaitlist(runId: string) {
  const run = await one('select title, capacity from runs where id = $1', [runId]);
  if (!run?.capacity) return;
  const count = await one(`select count(*) as n from participations where run_id = $1 and status in ('joined','checked_in')`, [runId]);
  if (Number(count!.n) >= run.capacity) return;
  const next = await one(
    `update participations set status = 'joined', joined_at = now()
     where (run_id, user_id) = (select run_id, user_id from participations where run_id = $1 and status = 'waitlist' order by joined_at limit 1)
     returning user_id`,
    [runId],
  );
  if (next) await notify(next.user_id, 'waitlist_promoted', { run: run.title }, { run: runId });
}

export async function doCheckin(run: any, userId: string, method: string) {
  const s = await getSettings();
  const r = await one(
    `update participations set status = 'checked_in', check_in_at = now(), check_in_method = $3
     where run_id = $1 and user_id = $2 and status in ('joined','no_show') returning 1`,
    [run.id, userId, method],
  );
  if (!r) {
    const cur = await one('select status from participations where run_id = $1 and user_id = $2', [run.id, userId]);
    if (cur?.status === 'checked_in') return { already: true, points: 0 };
    fail(400, 'not_joined');
  }
  const tx1 = await award({ userId, reason: 'group_attendance', amount: s.points.group_attendance, sourceType: 'run', sourceId: run.id });
  if (tx1) await notify(userId, 'checked_in', { points: tx1.amount }, { run: run.id }, { telegram: method !== 'telegram' });
  // Organizer reward once the run reaches the minimum checked-in participants (organizer excluded).
  const n = Number((await one(`select count(*) as n from participations where run_id = $1 and status = 'checked_in' and user_id <> $2`, [run.id, run.organizer_id]))!.n);
  if (n >= s.points.organize_min_checkins) {
    const claimed = await one('update runs set organizer_rewarded = true where id = $1 and not organizer_rewarded returning 1', [run.id]);
    if (claimed) {
      const t2 = await award({ userId: run.organizer_id, reason: 'organize_run', amount: s.points.organize_run, sourceType: 'run', sourceId: run.id });
      if (t2) await notify(run.organizer_id, 'organizer_reward', { count: n, points: t2.amount }, { run: run.id });
      afterProgress(run.organizer_id);
    }
  }
  emitToRun(run.id, { type: 'checkin', runId: run.id, userId });
  await maybeRewardInviter(userId);
  afterProgress(userId);
  return { already: false, points: tx1?.amount ?? 0 };
}

export default async function runRoutes(app: FastifyInstance) {
  app.get(
    '/runs',
    {
      preHandler: optionalAuth,
      schema: {
        tags: ['runs'],
        querystring: S.obj({
          lat: S.num(), lng: S.num(), radius_km: S.num({ minimum: 0.5, maximum: 100 }),
          from: S.str({ format: 'date-time' }), to: S.str({ format: 'date-time' }),
          type: S.enum(['casual', 'training', 'plogging', 'race_prep']), level: S.enum(['beginner', 'intermediate', 'advanced', 'all']),
          district: S.str({ maxLength: 60 }), club: S.uuid(), min_km: S.num(), max_km: S.num(),
          pace: S.str({ pattern: '^\\d{1,2}:\\d{2}$' }), q: S.str({ maxLength: 80 }), featured: S.bool(), limit: S.int({ minimum: 1, maximum: 300 }),
        }),
      },
    },
    async (req) => {
      const f = req.query as any;
      const where: string[] = [`not r.hidden`, `r.status = 'scheduled'`, womenOnlyFilter(req.user)];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      where.push(`r.start_at >= ${f.from ? p(f.from) : `now() - interval '2 hours'`}`);
      if (f.to) where.push(`r.start_at <= ${p(f.to)}`);
      if (f.type) where.push(`r.type = ${p(f.type)}`);
      if (f.level) where.push(`(r.level = ${p(f.level)} or r.level = 'all')`);
      if (f.district) where.push(`r.district = ${p(f.district)}`);
      if (f.club) where.push(`r.club_id = ${p(f.club)}`);
      if (f.min_km) where.push(`r.distance_km >= ${p(f.min_km)}`);
      if (f.max_km) where.push(`r.distance_km <= ${p(f.max_km)}`);
      if (f.pace) where.push(`${p(f.pace)} = any(r.pace_groups)`);
      if (f.featured) where.push(`r.featured`);
      if (f.q) where.push(`r.title ilike ${p(`%${f.q.replace(/[%_]/g, '')}%`)}`);
      if (req.user) where.push(`not exists (select 1 from blocks b where (b.blocker_id = ${p(req.user.id)} and b.blocked_id = r.organizer_id) or (b.blocked_id = $${params.length} and b.blocker_id = r.organizer_id))`);
      let distSel = 'null::float as distance_m';
      if (f.lat != null && f.lng != null) {
        const ll = `ll_to_earth(${p(f.lat)}, ${p(f.lng)})`;
        distSel = `earth_distance(${ll}, ll_to_earth(r.meeting_lat, r.meeting_lng)) as distance_m`;
        if (f.radius_km) {
          const rad = p(f.radius_km * 1000);
          where.push(`earth_box(${ll}, ${rad}) @> ll_to_earth(r.meeting_lat, r.meeting_lng) and earth_distance(${ll}, ll_to_earth(r.meeting_lat, r.meeting_lng)) <= ${rad}`);
        }
      }
      const mine = req.user ? `(select status from participations where run_id = r.id and user_id = ${p(req.user.id)}) as my_status` : 'null as my_status';
      return q(
        `select ${RUN_FIELDS}, ${distSel}, ${mine}
         from runs r join users o on o.id = r.organizer_id left join clubs c on c.id = r.club_id
         where ${where.join(' and ')}
         order by r.start_at limit ${Number(f.limit ?? 200)}`,
        params,
      );
    },
  );

  app.get('/runs/mine', { preHandler: requireAuth, schema: { tags: ['runs'] } }, async (req) => {
    const me = req.user!.id;
    const rows = await q(
      `select ${RUN_FIELDS}, p.status as my_status, (r.organizer_id = $1) as is_organizer
       from runs r join users o on o.id = r.organizer_id left join clubs c on c.id = r.club_id
       left join participations p on p.run_id = r.id and p.user_id = $1
       where (p.user_id is not null and p.status not in ('left','rejected')) or r.organizer_id = $1
       order by r.start_at desc limit 200`,
      [me],
    );
    const now = Date.now() - 2 * 3600_000;
    return {
      upcoming: rows.filter((r) => new Date(r.start_at).getTime() >= now && r.status === 'scheduled').reverse(),
      past: rows.filter((r) => new Date(r.start_at).getTime() < now || r.status !== 'scheduled'),
    };
  });

  app.get('/runs/:id', { preHandler: optionalAuth, schema: { tags: ['runs'], params: idParam } }, async (req) => {
    const { id } = req.params as { id: string };
    const run = await one(
      `select ${RUN_FIELDS}, r.description, r.route, r.organizer_id, r.club_id, r.checkin_code, r.hidden
       from runs r join users o on o.id = r.organizer_id left join clubs c on c.id = r.club_id where r.id = $1`,
      [id],
    );
    if (!run) fail(404, 'run_not_found');
    const u = req.user;
    const manage = u ? await canManageRun(u, run as any) : false;
    if (run!.women_only && !manage && u?.gender !== 'female') fail(404, 'run_not_found');
    if (run!.hidden && !manage) fail(404, 'run_not_found');
    const my = u ? await one('select status, check_in_at, rating from participations where run_id = $1 and user_id = $2', [id, u.id]) : null;
    const participants = await q(
      `select u.id, u.name, u.photo_url, p.status, p.check_in_at, p.joined_at from participations p join users u on u.id = p.user_id
       where p.run_id = $1 and p.status in (${manage ? `'joined','checked_in','waitlist','pending','no_show'` : `'joined','checked_in'`}) and u.deleted_at is null
       order by p.joined_at`,
      [id],
    );
    const s = await getSettings();
    const startMs = new Date(run!.start_at).getTime();
    const checkinOpen = Date.now() >= startMs - s.checkin.window_before_min * 60_000 && Date.now() <= startMs + s.checkin.window_after_min * 60_000;
    const rating = await one('select round(avg(rating)::numeric, 1)::float as avg, count(rating) as n from participations where run_id = $1 and rating is not null', [id]);
    const out: any = { ...run, my_status: my?.status ?? null, my_rating: my?.rating ?? null, can_manage: manage, participants, checkin_open: checkinOpen, checkin_radius_m: s.checkin.radius_m, rating };
    if (!manage) delete out.checkin_code;
    return out;
  });

  app.post('/runs', { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 hour' } }, schema: { tags: ['runs'], body: runBody(['title', 'start_at', 'meeting_lat', 'meeting_lng', 'type']) } }, async (req) => {
    const b = req.body as any;
    const u = req.user!;
    if (new Date(b.start_at).getTime() < Date.now() - 5 * 60_000) fail(400, 'start_in_past');
    if (b.cover_url && !isUploadUrl(b.cover_url)) fail(400, 'invalid_cover');
    if (b.women_only && u.gender !== 'female' && !STAFF.includes(u.role)) fail(403, 'women_only_requires_female_organizer');
    if (b.club_id) {
      const ok = await one(`select 1 from club_members where club_id = $1 and user_id = $2 and role in ('owner','co_organizer')`, [b.club_id, u.id]);
      if (!ok && !STAFF.includes(u.role)) fail(403, 'not_club_organizer');
    }
    if (b.recurrence_rule && !b.club_id && !['club_organizer', 'admin', 'moderator'].includes(u.role)) fail(403, 'recurring_requires_club');
    const run = await one(
      `insert into runs (organizer_id, club_id, title, description, type, start_at, meeting_lat, meeting_lng, meeting_address, district, route, distance_km,
         pace_groups, level, capacity, women_only, requires_approval, recurrence_rule, cover_url, plogging_supplies, plogging_dropoff, dirty_spot_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *`,
      [
        u.id, b.club_id ?? null, b.title, b.description ?? null, b.type, b.start_at, b.meeting_lat, b.meeting_lng, b.meeting_address ?? null,
        b.district ?? null, b.route ? JSON.stringify(b.route) : null, b.distance_km ?? null, b.pace_groups ?? [], b.level ?? 'all', b.capacity ?? null,
        b.women_only ?? false, b.requires_approval ?? false, b.recurrence_rule ?? null, b.cover_url ?? null, b.plogging_supplies ?? null,
        b.plogging_dropoff ?? null, b.dirty_spot_id ?? null,
      ],
    );
    await q('insert into participations (run_id, user_id, status) values ($1, $2, $3)', [run!.id, u.id, 'joined']);
    if (b.recurrence_rule) {
      await q('update runs set series_id = id where id = $1', [run!.id]);
      await extendSeries(run!.id);
    }
    if (b.dirty_spot_id) await q(`update dirty_spots set status = 'scheduled' where id = $1 and status in ('reported','approved')`, [b.dirty_spot_id]);
    announceNewRun(run).catch((e) => req.log.error(e));
    return { id: run!.id };
  });

  app.patch('/runs/:id', { preHandler: requireAuth, schema: { tags: ['runs'], params: idParam, body: runBody([]) } }, async (req) => {
    const run = await loadRun((req.params as any).id);
    if (!(await canManageRun(req.user!, run))) fail(403, 'forbidden');
    const b = req.body as Record<string, any>;
    if (b.cover_url && !isUploadUrl(b.cover_url)) fail(400, 'invalid_cover');
    if (b.women_only && req.user!.gender !== 'female' && !STAFF.includes(req.user!.role)) fail(403, 'women_only_requires_female_organizer');
    delete b.club_id;
    delete b.recurrence_rule;
    if (b.route) b.route = JSON.stringify(b.route);
    const keys = Object.keys(b);
    if (keys.length) await q(`update runs set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [run.id, ...keys.map((k) => b[k])]);
    return { ok: true };
  });

  app.post('/runs/:id/cancel', { preHandler: requireAuth, schema: { tags: ['runs'], params: idParam, body: S.obj({ series: S.bool() }) } }, async (req) => {
    const run = await loadRun((req.params as any).id);
    if (!(await canManageRun(req.user!, run))) fail(403, 'forbidden');
    const ids =
      (req.body as any)?.series && run.series_id
        ? (await q(`update runs set status = 'cancelled', recurrence_rule = null where series_id = $1 and start_at >= now() returning id`, [run.series_id])).map((r) => r.id)
        : [(await one(`update runs set status = 'cancelled' where id = $1 returning id`, [run.id]))!.id];
    if ((req.body as any)?.series && run.series_id) await q('update runs set recurrence_rule = null where id = $1', [run.series_id]);
    const users = await q(`select distinct user_id from participations where run_id = any($1) and status in ('joined','waitlist','pending') and user_id <> $2`, [ids, run.organizer_id]);
    await notifyMany(users.map((u) => u.user_id), 'run_cancelled', { run: run.title }, { run: run.id });
    return { ok: true, cancelled: ids.length };
  });

  app.post('/runs/:id/join', { preHandler: requireAuth, schema: { tags: ['runs'], params: idParam } }, async (req) => {
    const u = req.user!;
    const run = await loadRun((req.params as any).id);
    if (run.status !== 'scheduled' || run.hidden) fail(400, 'run_not_open');
    if (new Date(run.start_at).getTime() < Date.now() - 60 * 60_000) fail(400, 'run_started');
    if (run.women_only && u.gender !== 'female') fail(403, 'women_only');
    if (await isBlockedBetween(u.id, run.organizer_id)) fail(403, 'blocked');
    const status = await tx(async (c) => {
      await c.query('select id from runs where id = $1 for update', [run.id]);
      const existing = (await c.query('select status from participations where run_id = $1 and user_id = $2', [run.id, u.id])).rows[0];
      if (existing && ['joined', 'checked_in', 'waitlist', 'pending'].includes(existing.status)) return existing.status;
      const taken = Number((await c.query(`select count(*) as n from participations where run_id = $1 and status in ('joined','checked_in')`, [run.id])).rows[0].n);
      const st = run.requires_approval ? 'pending' : run.capacity && taken >= run.capacity ? 'waitlist' : 'joined';
      await c.query(
        `insert into participations (run_id, user_id, status) values ($1, $2, $3)
         on conflict (run_id, user_id) do update set status = excluded.status, joined_at = now()`,
        [run.id, u.id, st],
      );
      return st;
    });
    if (status === 'pending') await notify(run.organizer_id, 'join_request', { name: u.name ?? '', run: run.title }, { run: run.id, user: u.id });
    else if (status === 'joined') await notify(run.organizer_id, 'run_joined', { name: u.name ?? '', run: run.title }, { run: run.id }, { telegram: false });
    return { status };
  });

  app.post('/runs/:id/leave', { preHandler: requireAuth, schema: { tags: ['runs'], params: idParam } }, async (req) => {
    const run = await loadRun((req.params as any).id);
    if (run.organizer_id === req.user!.id) fail(400, 'organizer_cannot_leave');
    const prev = await one(`update participations set status = 'left' where run_id = $1 and user_id = $2 and status in ('joined','waitlist','pending') returning 1`, [run.id, req.user!.id]);
    if (prev) await promoteWaitlist(run.id);
    return { ok: true };
  });

  app.post(
    '/runs/:id/participants/:userId/:decision',
    { preHandler: requireAuth, schema: { tags: ['runs'], params: S.obj({ id: S.uuid(), userId: S.uuid(), decision: S.enum(['approve', 'reject', 'no_show', 'checkin']) }, ['id', 'userId', 'decision']) } },
    async (req) => {
      const { userId, decision } = req.params as any;
      const run = await loadRun((req.params as any).id);
      if (!(await canManageRun(req.user!, run))) fail(403, 'forbidden');
      if (decision === 'approve') {
        const taken = Number((await one(`select count(*) as n from participations where run_id = $1 and status in ('joined','checked_in')`, [run.id]))!.n);
        const st = run.capacity && taken >= run.capacity ? 'waitlist' : 'joined';
        const r = await one(`update participations set status = $3 where run_id = $1 and user_id = $2 and status = 'pending' returning 1`, [run.id, userId, st]);
        if (r && st === 'joined') await notify(userId, 'join_approved', { run: run.title }, { run: run.id });
      } else if (decision === 'reject') {
        const r = await one(`update participations set status = 'rejected' where run_id = $1 and user_id = $2 and status in ('pending','waitlist','joined') returning 1`, [run.id, userId]);
        if (r) await notify(userId, 'join_rejected', { run: run.title }, { run: run.id });
      } else if (decision === 'no_show') {
        await q(`update participations set status = 'no_show' where run_id = $1 and user_id = $2 and status = 'joined'`, [run.id, userId]);
      } else {
        await doCheckin(run, userId, 'organizer');
      }
      return { ok: true };
    },
  );

  app.post(
    '/runs/:id/checkin',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
      schema: { tags: ['runs'], params: idParam, body: S.obj({ lat: S.num(), lng: S.num(), accuracy: S.num(), code: S.str({ maxLength: 12 }) }) },
    },
    async (req) => {
      const run = await loadRun((req.params as any).id);
      const b = req.body as any;
      const s = await getSettings();
      const start = new Date(run.start_at).getTime();
      if (Date.now() < start - s.checkin.window_before_min * 60_000) fail(400, 'checkin_not_open');
      if (Date.now() > start + s.checkin.window_after_min * 60_000) fail(400, 'checkin_closed');
      let method = '';
      if (b.code) {
        if (String(b.code).toUpperCase() !== run.checkin_code) fail(400, 'invalid_code');
        method = 'qr';
      } else if (b.lat != null && b.lng != null) {
        const d = distanceM({ lat: b.lat, lng: b.lng }, { lat: run.meeting_lat, lng: run.meeting_lng });
        // Allow GPS accuracy slack up to 50 m on top of the geofence radius.
        const slack = Math.min(50, Math.max(0, Number(b.accuracy ?? 0)));
        if (d > s.checkin.radius_m + slack) fail(400, 'too_far', `${Math.round(d)}`);
        method = 'geo';
      } else fail(400, 'location_or_code_required');
      return doCheckin(run, req.user!.id, method);
    },
  );

  app.post('/runs/:id/rate', { preHandler: requireAuth, schema: { tags: ['runs'], params: idParam, body: S.obj({ rating: S.int({ minimum: 1, maximum: 5 }) }, ['rating']) } }, async (req) => {
    const r = await one(`update participations set rating = $3 where run_id = $1 and user_id = $2 and status = 'checked_in' returning 1`, [
      (req.params as any).id, req.user!.id, (req.body as any).rating,
    ]);
    if (!r) fail(400, 'not_checked_in');
    return { ok: true };
  });

  app.get('/runs/:id/attendance', { preHandler: requireAuth, schema: { tags: ['runs'], params: idParam, querystring: S.obj({ format: S.enum(['json', 'csv']) }) } }, async (req, reply) => {
    const run = await loadRun((req.params as any).id);
    if (!(await canManageRun(req.user!, run))) fail(403, 'forbidden');
    const rows = await q(
      `select u.name, u.phone, p.status, p.joined_at, p.check_in_at, p.check_in_method from participations p join users u on u.id = p.user_id
       where p.run_id = $1 order by p.joined_at`,
      [run.id],
    );
    if ((req.query as any).format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="attendance-${run.id.slice(0, 8)}.csv"`);
      return '﻿' + toCsv(rows, ['name', 'phone', 'status', 'joined_at', 'check_in_at', 'check_in_method']);
    }
    return rows;
  });

  // ---- Chat ----
  async function chatAccess(runId: string, user: AuthUser) {
    const run = await loadRun(runId);
    if (await canManageRun(user, run)) return { run, manage: true };
    const p = await one(`select 1 from participations where run_id = $1 and user_id = $2 and status in ('joined','checked_in','waitlist')`, [runId, user.id]);
    if (!p) fail(403, 'not_participant');
    return { run, manage: false };
  }

  app.get('/runs/:id/messages', { preHandler: requireAuth, schema: { tags: ['chat'], params: idParam, querystring: S.obj({ after: S.int() }) } }, async (req) => {
    const { id } = req.params as any;
    await chatAccess(id, req.user!);
    const rows = await q(
      `select m.id, m.body, m.is_announcement, m.created_at, json_build_object('id', u.id, 'name', u.name, 'photo_url', u.photo_url) as user
       from messages m join users u on u.id = m.user_id
       where m.run_id = $1 and not m.hidden and ($2::bigint is null or m.id > $2)
         and not exists (select 1 from blocks b where b.blocker_id = $3 and b.blocked_id = m.user_id)
       order by m.id desc limit 200`,
      [id, (req.query as any).after ?? null, req.user!.id],
    );
    return rows.reverse();
  });

  app.post(
    '/runs/:id/messages',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['chat'], params: idParam, body: S.obj({ body: S.str({ minLength: 1, maxLength: 2000 }), announcement: S.bool() }, ['body']) },
    },
    async (req) => {
      const { id } = req.params as any;
      const { run, manage } = await chatAccess(id, req.user!);
      const b = req.body as any;
      const isAnn = Boolean(b.announcement && manage);
      const m = await one(
        `insert into messages (run_id, user_id, body, is_announcement) values ($1, $2, $3, $4) returning id, body, is_announcement, created_at`,
        [id, req.user!.id, b.body.trim(), isAnn],
      );
      const msg = { ...m, user: { id: req.user!.id, name: req.user!.name } };
      emitToRun(id, { type: 'message', runId: id, message: msg });
      const others = (await q(`select user_id from participations where run_id = $1 and status in ('joined','checked_in','waitlist') and user_id <> $2`, [id, req.user!.id])).map((r) => r.user_id);
      if (isAnn) await notifyMany(others, 'run_announcement', { run: run.title, text: b.body.slice(0, 200) }, { run: id });
      else notifyMany(others, 'chat_message', { name: req.user!.name ?? '', run: run.title }, { run: id, chat: true }, { telegram: false }).catch(() => {});
      return msg;
    },
  );

  app.delete('/runs/:id/messages/:mid', { preHandler: requireAuth, schema: { tags: ['chat'], params: S.obj({ id: S.uuid(), mid: S.int() }, ['id', 'mid']) } }, async (req) => {
    const { id, mid } = req.params as any;
    const { manage } = await chatAccess(id, req.user!);
    await q(`update messages set hidden = true where id = $1 and run_id = $2 and ($3 or user_id = $4)`, [mid, id, manage, req.user!.id]);
    emitToRun(id, { type: 'message_deleted', runId: id, id: mid });
    return { ok: true };
  });

  // ---- Calendar export ----
  app.get('/runs/:id/ics', { schema: { tags: ['runs'], params: idParam } }, async (req, reply) => {
    const run = await loadRun((req.params as any).id);
    if (run.women_only || run.hidden) fail(404, 'run_not_found');
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const start = new Date(run.start_at);
    const end = new Date(start.getTime() + Math.max(60, (Number(run.distance_km) || 5) * 8) * 60_000);
    const escIcs = (s: string) => String(s ?? '').replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EcoRun//Runs//EN', 'BEGIN:VEVENT',
      `UID:${run.id}@ecorun`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${escIcs(run.title)}`, `LOCATION:${escIcs(run.meeting_address ?? `${run.meeting_lat},${run.meeting_lng}`)}`,
      `GEO:${run.meeting_lat};${run.meeting_lng}`, `URL:${config.publicUrl}/runs/${run.id}`,
      `DESCRIPTION:${escIcs(run.description ?? '')}`,
      'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:EcoRun', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    reply.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', `attachment; filename="ecorun-${run.id.slice(0, 8)}.ics"`);
    return ics;
  });
}
