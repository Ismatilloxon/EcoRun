import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, q } from '../db.ts';
import { fail, idParam, S } from '../http.ts';
import { requireRole, revokeAll } from '../auth.ts';
import { notify } from '../notify.ts';
import { afterProgress, award, balance, setPointsStatus } from '../points.ts';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../settings.ts';
import { onlineCount } from '../realtime.ts';
import { reviewEcoAction } from './eco.ts';

export async function audit(req: FastifyRequest, action: string, targetType: string | null, targetId: string | null, data: unknown = null) {
  await q('insert into audit_log (actor_id, action, target_type, target_id, data, ip) values ($1,$2,$3,$4,$5,$6)', [
    req.user?.id ?? null, action, targetType, targetId, data ? JSON.stringify(data) : null, req.ip,
  ]);
}

const i18nObj = S.obj({ uz: S.str({ maxLength: 20000 }), ru: S.str({ maxLength: 20000 }), en: S.str({ maxLength: 20000 }) });

export async function runCampaign(id: string) {
  const c = await one('select * from push_campaigns where id = $1 and sent_at is null', [id]);
  if (!c) return 0;
  const seg = c.segment ?? {};
  const users = await q(
    `select u.id from users u
     where u.deleted_at is null and not u.blocked
       and ($1::text is null or u.district = $1)
       and ($2::text is null or u.level = $2)
       and ($3::int is null or exists (select 1 from user_days d where d.user_id = u.id and d.day > current_date - $3))
       and ($4::int is null or not exists (select 1 from user_days d where d.user_id = u.id and d.day > current_date - $4))
       and ($5::text is null or u.language = $5)`,
    [seg.district ?? null, seg.level ?? null, seg.active_days ?? null, seg.inactive_days ?? null, seg.language ?? null],
  );
  await q('update push_campaigns set sent_at = now(), sent_count = $2 where id = $1', [id, users.length]);
  for (const u of users) await notify(u.id, 'campaign', { title: c.title, body: c.body }, { campaign: id }).catch(() => {});
  return users.length;
}

export default async function adminRoutes(app: FastifyInstance) {
  const staff = requireRole('moderator', 'admin');
  const admin = requireRole('admin');

  app.get('/admin/dashboard', { preHandler: staff, schema: { tags: ['admin'] } }, async () => {
    const k = await one(
      `select
         (select count(distinct user_id) from user_days where day = current_date) as dau,
         (select count(distinct user_id) from user_days where day > current_date - 7) as wau,
         (select count(distinct user_id) from user_days where day > current_date - 30) as mau,
         (select count(*) from users where deleted_at is null) as users_total,
         (select count(*) from users where created_at > now() - interval '1 day') as signups_1d,
         (select count(*) from users where created_at > now() - interval '7 days') as signups_7d,
         (select count(*) from users where onboarded) as onboarded,
         (select count(*) from runs where created_at > now() - interval '7 days') as runs_7d,
         (select count(*) from participations where status = 'checked_in' and check_in_at > now() - interval '7 days') as checkins_7d,
         (select count(*) from participations p join runs r on r.id = p.run_id where r.start_at between now() - interval '30 days' and now() and p.status in ('joined','checked_in','no_show') and p.user_id <> r.organizer_id) as joins_30d,
         (select count(*) from participations p join runs r on r.id = p.run_id where r.start_at between now() - interval '30 days' and now() and p.status = 'checked_in' and p.user_id <> r.organizer_id) as checkins_30d,
         (select count(*) from eco_actions where created_at > now() - interval '7 days') as eco_7d,
         (select count(*) from eco_actions where status = 'approved' and created_at > now() - interval '30 days') as eco_approved_30d,
         (select coalesce(sum(amount), 0) from points_transactions where status = 'confirmed' and amount > 0 and created_at > now() - interval '30 days') as points_issued_30d,
         (select coalesce(-sum(amount), 0) from points_transactions where reason = 'redemption' and created_at > now() - interval '30 days') as points_spent_30d,
         (select count(*) from redemptions where status = 'redeemed' and redeemed_at > now() - interval '30 days') as redeemed_30d,
         (select count(*) from reports where status = 'open') as open_reports,
         (select count(*) from eco_actions where status = 'pending') as pending_eco,
         (select count(*) from dirty_spots where status = 'reported') as pending_spots,
         (select count(*) from clubs where verification_requested_at is not null and not verified) as pending_clubs`,
    );
    const series = await q(
      `with d as (select generate_series(current_date - 29, current_date, '1 day')::date as day)
       select d.day::text,
         (select count(*) from users u where u.created_at::date = d.day) as signups,
         (select count(*) from user_days ud where ud.day = d.day) as active,
         (select count(*) from participations p where p.check_in_at::date = d.day) as checkins,
         (select count(*) from eco_actions e where e.created_at::date = d.day) as eco
       from d order by d.day`,
    );
    return { kpi: { ...k, online: onlineCount() }, series };
  });

  // ---- Users ----
  app.get('/admin/users', { preHandler: staff, schema: { tags: ['admin'], querystring: S.obj({ q: S.str({ maxLength: 60 }), role: S.str({ maxLength: 20 }), blocked: S.bool(), offset: S.int({ minimum: 0 }) }) } }, async (req) => {
    const f = req.query as any;
    const term = f.q?.replace(/[%_]/g, '') || null;
    return q(
      `select u.id, u.name, u.phone, u.role, u.district, u.level, u.blocked, u.created_at, u.telegram_username, u.deleted_at is not null as deleted,
              (select coalesce(sum(amount), 0) from points_transactions p where p.user_id = u.id and p.status = 'confirmed') as points,
              (select max(day) from user_days d where d.user_id = u.id) as last_seen
       from users u
       where ($1::text is null or u.name ilike '%' || $1 || '%' or u.phone ilike '%' || $1 || '%' or u.telegram_username ilike '%' || $1 || '%')
         and ($2::text is null or u.role = $2) and ($3::boolean is null or u.blocked = $3)
       order by u.created_at desc limit 100 offset $4`,
      [term, f.role ?? null, f.blocked ?? null, f.offset ?? 0],
    );
  });

  app.get('/admin/users/:id', { preHandler: staff, schema: { tags: ['admin'], params: idParam } }, async (req) => {
    const { id } = req.params as any;
    const user = await one('select id, phone, name, photo_url, gender, district, level, role, blocked, blocked_reason, telegram_username, created_at, deleted_at, totp_enabled from users where id = $1', [id]);
    if (!user) fail(404, 'not_found');
    return {
      user,
      points: await balance(id),
      transactions: await q('select * from points_transactions where user_id = $1 order by id desc limit 50', [id]),
      activities: await q('select id, started_at, distance_m, duration_s, flagged, flag_reason, source from activities where user_id = $1 order by started_at desc limit 30', [id]),
      eco: await q('select id, status, bags_small, bags_large, created_at from eco_actions where user_id = $1 order by created_at desc limit 30', [id]),
      reports: await q(`select * from reports where target_type = 'user' and target_id = $1 order by created_at desc`, [id]),
      partners: await q('select p.id, p.name from partner_users pu join partners p on p.id = pu.partner_id where pu.user_id = $1', [id]),
    };
  });

  app.post('/admin/users/:id/block', { preHandler: staff, schema: { tags: ['admin'], params: idParam, body: S.obj({ blocked: S.bool(), reason: S.nstr({ maxLength: 300 }) }, ['blocked']) } }, async (req) => {
    const { id } = req.params as any;
    const { blocked, reason } = req.body as any;
    const target = await one('select role from users where id = $1', [id]);
    if (!target) fail(404, 'not_found');
    if (target!.role === 'admin' && req.user!.role !== 'admin') fail(403, 'forbidden');
    await q('update users set blocked = $2, blocked_reason = $3 where id = $1', [id, blocked, blocked ? reason ?? null : null]);
    if (blocked) await revokeAll(id);
    await audit(req, blocked ? 'user.block' : 'user.unblock', 'user', id, { reason });
    return { ok: true };
  });

  app.post('/admin/users/:id/role', { preHandler: admin, schema: { tags: ['admin'], params: idParam, body: S.obj({ role: S.enum(['runner', 'club_organizer', 'partner', 'event_organizer', 'moderator', 'admin']) }, ['role']) } }, async (req) => {
    const { id } = req.params as any;
    if (id === req.user!.id) fail(400, 'cannot_change_own_role');
    await q('update users set role = $2 where id = $1', [id, (req.body as any).role]);
    await revokeAll(id);
    await audit(req, 'user.role', 'user', id, req.body);
    return { ok: true };
  });

  app.post('/admin/users/:id/points', { preHandler: admin, schema: { tags: ['admin'], params: idParam, body: S.obj({ amount: S.int({ minimum: -100000, maximum: 100000 }), reset: S.bool(), note: S.str({ minLength: 3, maxLength: 300 }) }, ['note']) } }, async (req) => {
    const { id } = req.params as any;
    const b = req.body as any;
    const amount = b.reset ? -(await balance(id)).balance : b.amount ?? 0;
    if (!amount) return { ok: true, amount: 0 };
    await award({ userId: id, reason: 'admin_adjust', amount, sourceType: 'admin', sourceId: `adj:${Date.now()}`, note: b.note });
    await audit(req, b.reset ? 'points.reset' : 'points.adjust', 'user', id, { amount, note: b.note });
    return { ok: true, amount };
  });

  app.post('/admin/users/:id/partner', { preHandler: admin, schema: { tags: ['admin'], params: idParam, body: S.obj({ partner_id: S.uuid(), remove: S.bool() }, ['partner_id']) } }, async (req) => {
    const { id } = req.params as any;
    const b = req.body as any;
    if (b.remove) await q('delete from partner_users where partner_id = $1 and user_id = $2', [b.partner_id, id]);
    else {
      await q('insert into partner_users (partner_id, user_id) values ($1, $2) on conflict do nothing', [b.partner_id, id]);
      await q(`update users set role = 'partner' where id = $1 and role in ('runner')`, [id]);
    }
    await audit(req, b.remove ? 'partner.unlink_user' : 'partner.link_user', 'user', id, b);
    return { ok: true };
  });

  // ---- Moderation queue ----
  app.get('/admin/moderation', { preHandler: staff, schema: { tags: ['admin'] } }, async () => ({
    reports: await q(
      `select r.*, u.name as reporter_name,
              case r.target_type
                when 'user' then (select name from users where id::text = r.target_id)
                when 'run' then (select title from runs where id::text = r.target_id)
                when 'club' then (select name from clubs where id::text = r.target_id)
                when 'message' then (select body from messages where id::text = r.target_id)
                else null end as target_label
       from reports r join users u on u.id = r.reporter_id where r.status = 'open' order by r.created_at`,
    ),
    eco: await q(
      `select e.*, json_build_object('id', u.id, 'name', u.name) as user, r.title as run_title, r.organizer_id
       from eco_actions e join users u on u.id = e.user_id left join runs r on r.id = e.run_id where e.status = 'pending' order by e.created_at`,
    ),
    spots: await q(`select s.*, u.name as reporter_name from dirty_spots s join users u on u.id = s.reporter_id where s.status = 'reported' order by s.created_at`),
    clubs: await q(`select c.id, c.name, c.logo_url, c.district, c.description, c.verification_requested_at, (select count(*) from club_members m where m.club_id = c.id) as members from clubs c where c.verification_requested_at is not null and not c.verified order by c.verification_requested_at`),
    challenges: await q(`select c.*, p.name as sponsor_name from challenges c left join partners p on p.id = c.sponsor_partner_id where not c.active and c.ends_at > now() and c.sponsor_partner_id is not null`),
  }));

  app.post(
    '/admin/reports/:id/resolve',
    { preHandler: staff, schema: { tags: ['admin'], params: idParam, body: S.obj({ status: S.enum(['resolved', 'dismissed']), note: S.nstr({ maxLength: 500 }), action: S.enum(['none', 'hide_target', 'block_user']) }, ['status']) } },
    async (req) => {
      const { id } = req.params as any;
      const b = req.body as any;
      const r = await one('select * from reports where id = $1', [id]);
      if (!r) fail(404, 'not_found');
      if (b.action === 'hide_target') {
        if (r!.target_type === 'run') await q('update runs set hidden = true where id::text = $1', [r!.target_id]);
        if (r!.target_type === 'club') await q('update clubs set hidden = true where id::text = $1', [r!.target_id]);
        if (r!.target_type === 'message') await q('update messages set hidden = true where id::text = $1', [r!.target_id]);
      }
      if (b.action === 'block_user') {
        const uid =
          r!.target_type === 'user' ? r!.target_id
          : r!.target_type === 'message' ? (await one('select user_id from messages where id::text = $1', [r!.target_id]))?.user_id
          : r!.target_type === 'run' ? (await one('select organizer_id from runs where id::text = $1', [r!.target_id]))?.organizer_id
          : null;
        if (uid) {
          await q(`update users set blocked = true, blocked_reason = $2 where id = $1 and role <> 'admin'`, [uid, b.note ?? 'report']);
          await revokeAll(uid);
        }
      }
      await q('update reports set status = $2, resolution_note = $3, resolved_by = $4 where id = $1', [id, b.status, b.note ?? null, req.user!.id]);
      await audit(req, `report.${b.status}`, 'report', id, b);
      return { ok: true };
    },
  );

  app.post('/admin/eco/:id/review', { preHandler: staff, schema: { tags: ['admin'], params: idParam, body: S.obj({ approve: S.bool(), reason: S.nstr({ maxLength: 300 }) }, ['approve']) } }, async (req) => {
    const b = req.body as any;
    if (!b.approve && !b.reason) fail(400, 'reason_required');
    const out = await reviewEcoAction((req.params as any).id, req.user!, b.approve, b.reason);
    await audit(req, b.approve ? 'eco.approve' : 'eco.reject', 'eco_action', (req.params as any).id, b);
    return out;
  });

  app.post('/admin/spots/:id/review', { preHandler: staff, schema: { tags: ['admin'], params: idParam, body: S.obj({ approve: S.bool(), reason: S.nstr({ maxLength: 300 }) }, ['approve']) } }, async (req) => {
    const { id } = req.params as any;
    const b = req.body as any;
    const spot = await one(`update dirty_spots set status = $2, reviewed_by = $3, review_reason = $4 where id = $1 and status = 'reported' returning reporter_id`, [
      id, b.approve ? 'approved' : 'rejected', req.user!.id, b.reason ?? null,
    ]);
    if (!spot) fail(409, 'already_reviewed');
    await setPointsStatus('dirty_spot', id, b.approve ? 'confirmed' : 'rejected');
    if (b.approve) {
      const pts = await one(`select amount from points_transactions where source_type = 'dirty_spot' and source_id = $1`, [id]);
      await notify(spot!.reporter_id, 'dirty_spot_approved', { points: pts?.amount ?? 0 }, { spot: id });
      afterProgress(spot!.reporter_id);
    }
    await audit(req, b.approve ? 'spot.approve' : 'spot.reject', 'dirty_spot', id, b);
    return { ok: true };
  });

  app.post('/admin/clubs/:id/verify', { preHandler: staff, schema: { tags: ['admin'], params: idParam, body: S.obj({ approve: S.bool(), reason: S.nstr({ maxLength: 300 }) }, ['approve']) } }, async (req) => {
    const { id } = req.params as any;
    const b = req.body as any;
    await q(`update clubs set verified = $2, verification_requested_at = case when $2 then verification_requested_at else null end where id = $1`, [id, b.approve]);
    await audit(req, b.approve ? 'club.verify' : 'club.verify_reject', 'club', id, b);
    return { ok: true };
  });

  // ---- Runs & clubs ----
  app.get('/admin/runs', { preHandler: staff, schema: { tags: ['admin'], querystring: S.obj({ q: S.str({ maxLength: 60 }), scope: S.enum(['upcoming', 'past', 'all']) }) } }, async (req) => {
    const f = req.query as any;
    const scope = f.scope ?? 'upcoming';
    return q(
      `select r.id, r.title, r.type, r.start_at, r.status, r.hidden, r.featured, r.women_only, r.district, r.series_id, u.name as organizer, c.name as club,
              (select count(*) from participations p where p.run_id = r.id and p.status in ('joined','checked_in')) as joined,
              (select count(*) from participations p where p.run_id = r.id and p.status = 'checked_in') as checked_in
       from runs r join users u on u.id = r.organizer_id left join clubs c on c.id = r.club_id
       where ($1::text is null or r.title ilike '%' || $1 || '%')
         and ($2 = 'all' or ($2 = 'upcoming' and r.start_at > now() - interval '2 hours') or ($2 = 'past' and r.start_at <= now()))
       order by r.start_at ${scope === 'past' ? 'desc' : 'asc'} limit 300`,
      [f.q?.replace(/[%_]/g, '') || null, scope],
    );
  });

  app.patch('/admin/runs/:id', { preHandler: staff, schema: { tags: ['admin'], params: idParam, body: S.obj({ hidden: S.bool(), featured: S.bool(), title: S.str({ minLength: 3, maxLength: 120 }), status: S.enum(['scheduled', 'cancelled', 'completed']) }) } }, async (req) => {
    const b = req.body as Record<string, any>;
    const keys = Object.keys(b);
    if (keys.length) await q(`update runs set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [(req.params as any).id, ...keys.map((k) => b[k])]);
    await audit(req, 'run.update', 'run', (req.params as any).id, b);
    return { ok: true };
  });

  app.get('/admin/clubs', { preHandler: staff, schema: { tags: ['admin'] } }, async () =>
    q(
      `select c.id, c.name, c.district, c.verified, c.hidden, c.featured, c.created_at, u.name as owner, (select count(*) from club_members m where m.club_id = c.id) as members
       from clubs c join users u on u.id = c.owner_id order by c.created_at desc`,
    ),
  );

  app.patch('/admin/clubs/:id', { preHandler: staff, schema: { tags: ['admin'], params: idParam, body: S.obj({ hidden: S.bool(), featured: S.bool(), verified: S.bool(), name: S.str({ minLength: 2, maxLength: 80 }) }) } }, async (req) => {
    const b = req.body as Record<string, any>;
    const keys = Object.keys(b);
    if (keys.length) await q(`update clubs set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [(req.params as any).id, ...keys.map((k) => b[k])]);
    await audit(req, 'club.update', 'club', (req.params as any).id, b);
    return { ok: true };
  });

  // ---- Eco-points engine settings ----
  app.get('/admin/settings', { preHandler: admin, schema: { tags: ['admin'] } }, async () => ({ settings: await getSettings(), defaults: DEFAULT_SETTINGS }));
  app.put('/admin/settings', { preHandler: admin, schema: { tags: ['admin'], body: { type: 'object', additionalProperties: { type: ['object', 'array'] } } } }, async (req) => {
    const before = await getSettings();
    const after = await updateSettings(req.body as any);
    await audit(req, 'settings.update', 'settings', null, { before, after });
    return after;
  });

  // ---- Partners & rewards ----
  app.get('/admin/partners', { preHandler: admin, schema: { tags: ['admin'] } }, async () =>
    q(
      `select p.*, (select count(*) from rewards r where r.partner_id = p.id) as rewards,
              (select count(*) from redemptions rd join rewards r on r.id = rd.reward_id where r.partner_id = p.id and rd.status = 'redeemed') as redeemed,
              (select json_agg(json_build_object('id', u.id, 'name', u.name, 'phone', u.phone)) from partner_users pu join users u on u.id = pu.user_id where pu.partner_id = p.id) as users
       from partners p order by p.created_at desc`,
    ),
  );

  const partnerBody = S.obj({
    name: S.str({ minLength: 2, maxLength: 120 }), description: S.nstr({ maxLength: 2000 }), logo_url: S.nstr({ maxLength: 200 }),
    contacts: S.obj({ phone: S.str({ maxLength: 40 }), email: S.str({ maxLength: 120 }), telegram: S.str({ maxLength: 60 }), person: S.str({ maxLength: 120 }) }),
    branches: S.arr(S.obj({ name: S.str({ maxLength: 120 }), address: S.str({ maxLength: 200 }) }, ['name']), { maxItems: 100 }),
    contract_status: S.enum(['lead', 'active', 'paused', 'ended']),
  });
  app.post('/admin/partners', { preHandler: admin, schema: { tags: ['admin'], body: { ...partnerBody, required: ['name'] } } }, async (req) => {
    const b = req.body as any;
    const p = await one(`insert into partners (name, description, logo_url, contacts, branches, contract_status) values ($1,$2,$3,$4,$5,$6) returning id`, [
      b.name, b.description ?? null, b.logo_url ?? null, JSON.stringify(b.contacts ?? {}), JSON.stringify(b.branches ?? []), b.contract_status ?? 'active',
    ]);
    await audit(req, 'partner.create', 'partner', p!.id, b);
    return p;
  });
  app.patch('/admin/partners/:id', { preHandler: admin, schema: { tags: ['admin'], params: idParam, body: partnerBody } }, async (req) => {
    const b = req.body as Record<string, any>;
    for (const k of ['contacts', 'branches']) if (b[k]) b[k] = JSON.stringify(b[k]);
    const keys = Object.keys(b);
    if (keys.length) await q(`update partners set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [(req.params as any).id, ...keys.map((k) => b[k])]);
    await audit(req, 'partner.update', 'partner', (req.params as any).id, req.body);
    return { ok: true };
  });

  app.get('/admin/rewards', { preHandler: admin, schema: { tags: ['admin'] } }, async () =>
    q(
      `select rw.*, p.name as partner_name, (select count(*) from redemptions rd where rd.reward_id = rw.id and rd.status = 'redeemed') as redeemed
       from rewards rw join partners p on p.id = rw.partner_id order by rw.created_at desc`,
    ),
  );

  // ---- Challenges ----
  const challengeBody = S.obj({
    title: i18nObj, description: i18nObj, reward_text: i18nObj,
    metric: S.enum(['km', 'group_runs', 'plogging_runs', 'eco_points', 'runs']), target: S.num({ minimum: 1 }),
    starts_at: S.str({ format: 'date-time' }), ends_at: S.str({ format: 'date-time' }), reward_points: S.int({ minimum: 0, maximum: 10000 }),
    badge_code: S.nstr({ maxLength: 40 }), sponsor_partner_id: S.nuuid(), active: S.bool(),
  });
  app.get('/admin/challenges', { preHandler: staff, schema: { tags: ['admin'] } }, async () =>
    q(
      `select c.*, p.name as sponsor_name, (select count(*) from challenge_participants cp where cp.challenge_id = c.id) as participants,
              (select count(*) from challenge_participants cp where cp.challenge_id = c.id and cp.completed_at is not null) as completed
       from challenges c left join partners p on p.id = c.sponsor_partner_id order by c.starts_at desc`,
    ),
  );
  app.post('/admin/challenges', { preHandler: admin, schema: { tags: ['admin'], body: { ...challengeBody, required: ['title', 'metric', 'target', 'starts_at', 'ends_at'] } } }, async (req) => {
    const b = req.body as any;
    const c = await one(
      `insert into challenges (title, description, reward_text, metric, target, starts_at, ends_at, reward_points, badge_code, sponsor_partner_id, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [JSON.stringify(b.title), JSON.stringify(b.description ?? {}), b.reward_text ? JSON.stringify(b.reward_text) : null, b.metric, b.target, b.starts_at, b.ends_at,
        b.reward_points ?? 0, b.badge_code || null, b.sponsor_partner_id ?? null, b.active ?? true],
    );
    await audit(req, 'challenge.create', 'challenge', c!.id, b);
    return c;
  });
  app.patch('/admin/challenges/:id', { preHandler: staff, schema: { tags: ['admin'], params: idParam, body: challengeBody } }, async (req) => {
    const b = req.body as Record<string, any>;
    if (req.user!.role !== 'admin' && Object.keys(b).some((k) => k !== 'active')) fail(403, 'forbidden');
    for (const k of ['title', 'description', 'reward_text']) if (b[k]) b[k] = JSON.stringify(b[k]);
    const keys = Object.keys(b);
    if (keys.length) await q(`update challenges set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [(req.params as any).id, ...keys.map((k) => b[k])]);
    await audit(req, 'challenge.update', 'challenge', (req.params as any).id, req.body);
    return { ok: true };
  });

  // ---- Push campaigns ----
  app.get('/admin/campaigns', { preHandler: admin, schema: { tags: ['admin'] } }, async () => q('select * from push_campaigns order by created_at desc limit 100'));
  app.post(
    '/admin/campaigns',
    {
      preHandler: admin,
      schema: {
        tags: ['admin'],
        body: S.obj(
          {
            title: S.str({ minLength: 2, maxLength: 120 }), body: S.str({ minLength: 2, maxLength: 1000 }),
            segment: S.obj({ district: S.nstr({ maxLength: 60 }), level: S.nenum(['beginner', 'intermediate', 'advanced']), active_days: S.nint({ minimum: 1, maximum: 365 }), inactive_days: S.nint({ minimum: 1, maximum: 365 }), language: S.nenum(['uz', 'ru', 'en']) }),
            scheduled_at: S.nstr({ format: 'date-time' }), send_now: S.bool(),
          },
          ['title', 'body'],
        ),
      },
    },
    async (req) => {
      const b = req.body as any;
      const c = await one('insert into push_campaigns (title, body, segment, scheduled_at, created_by) values ($1,$2,$3,$4,$5) returning id', [
        b.title, b.body, JSON.stringify(b.segment ?? {}), b.send_now ? null : b.scheduled_at ?? null, req.user!.id,
      ]);
      await audit(req, 'campaign.create', 'campaign', c!.id, b);
      const sent = b.send_now ? await runCampaign(c!.id) : null;
      return { id: c!.id, sent };
    },
  );
  app.post('/admin/campaigns/preview', { preHandler: admin, schema: { tags: ['admin'], body: { type: 'object' } } }, async (req) => {
    const seg = (req.body as any)?.segment ?? {};
    const r = await one(
      `select count(*) as n from users u where u.deleted_at is null and not u.blocked
         and ($1::text is null or u.district = $1) and ($2::text is null or u.level = $2)
         and ($3::int is null or exists (select 1 from user_days d where d.user_id = u.id and d.day > current_date - $3))
         and ($4::int is null or not exists (select 1 from user_days d where d.user_id = u.id and d.day > current_date - $4))
         and ($5::text is null or u.language = $5)`,
      [seg.district || null, seg.level || null, seg.active_days || null, seg.inactive_days || null, seg.language || null],
    );
    return { audience: r!.n };
  });

  // ---- Content (banners, FAQ, terms, privacy) ----
  const contentBody = S.obj({ kind: S.enum(['banner', 'faq', 'terms', 'privacy']), title: i18nObj, body: i18nObj, image_url: S.nstr({ maxLength: 200 }), link: S.nstr({ maxLength: 300 }), sort: S.int(), active: S.bool() });
  app.get('/admin/content', { preHandler: admin, schema: { tags: ['admin'] } }, async () => q('select * from content order by kind, sort, created_at'));
  app.post('/admin/content', { preHandler: admin, schema: { tags: ['admin'], body: { ...contentBody, required: ['kind', 'title'] } } }, async (req) => {
    const b = req.body as any;
    const c = await one('insert into content (kind, title, body, image_url, link, sort, active) values ($1,$2,$3,$4,$5,$6,$7) returning id', [
      b.kind, JSON.stringify(b.title), JSON.stringify(b.body ?? {}), b.image_url ?? null, b.link ?? null, b.sort ?? 0, b.active ?? true,
    ]);
    await audit(req, 'content.create', 'content', c!.id, { kind: b.kind });
    return c;
  });
  app.patch('/admin/content/:id', { preHandler: admin, schema: { tags: ['admin'], params: idParam, body: contentBody } }, async (req) => {
    const b = req.body as Record<string, any>;
    for (const k of ['title', 'body']) if (b[k]) b[k] = JSON.stringify(b[k]);
    const keys = Object.keys(b);
    if (keys.length) await q(`update content set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [(req.params as any).id, ...keys.map((k) => b[k])]);
    await audit(req, 'content.update', 'content', (req.params as any).id, null);
    return { ok: true };
  });
  app.delete('/admin/content/:id', { preHandler: admin, schema: { tags: ['admin'], params: idParam } }, async (req) => {
    await q('delete from content where id = $1', [(req.params as any).id]);
    await audit(req, 'content.delete', 'content', (req.params as any).id, null);
    return { ok: true };
  });

  // ---- Events & payments report ----
  app.get('/admin/events', { preHandler: admin, schema: { tags: ['admin'] } }, async () =>
    q(
      `select e.id, e.title, e.start_at, e.status, u.name as organizer,
              count(r.id) filter (where r.status = 'confirmed') as registered,
              coalesce(sum(r.amount) filter (where r.status = 'confirmed'), 0) as revenue,
              count(r.id) filter (where r.status = 'refunded') as refunds
       from events e join users u on u.id = e.organizer_id left join event_registrations r on r.event_id = e.id
       group by e.id, u.name order by e.start_at desc`,
    ),
  );

  // ---- Audit log ----
  app.get('/admin/audit', { preHandler: admin, schema: { tags: ['admin'], querystring: S.obj({ offset: S.int({ minimum: 0 }) }) } }, async (req) =>
    q(
      `select a.*, u.name as actor_name from audit_log a left join users u on u.id = a.actor_id order by a.id desc limit 100 offset $1`,
      [(req.query as any).offset ?? 0],
    ),
  );
}
