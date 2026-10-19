import type { FastifyInstance } from 'fastify';
import { one, q, tx } from '../db.ts';
import { fail, idParam, S } from '../http.ts';
import { optionalAuth, requireAuth, STAFF, type AuthUser } from '../auth.ts';
import { distanceM, minDistanceToPath } from '../geo.ts';
import { pickI18n } from '../i18n.ts';
import { notify } from '../notify.ts';
import { afterProgress, award, balance, setPointsStatus } from '../points.ts';
import { getSettings } from '../settings.ts';
import { esc, tgSend } from '../telegram.ts';
import { isUploadUrl } from '../uploads.ts';

const WASTE = ['plastic', 'paper', 'glass', 'metal', 'mixed'];

async function bagPoints(small: number, large: number) {
  const s = await getSettings();
  return Math.round((small + large * s.points.plogging_large_bag_multiplier) * s.points.plogging_bag);
}

async function canReview(user: AuthUser, action: { run_id: string | null; user_id: string }) {
  if (STAFF.includes(user.role)) return true;
  if (!action.run_id || action.user_id === user.id) return false;
  return Boolean(
    await one(
      `select 1 from runs r where r.id = $1 and (r.organizer_id = $2 or exists (
         select 1 from club_members cm where cm.club_id = r.club_id and cm.user_id = $2 and cm.role in ('owner','co_organizer')))`,
      [action.run_id, user.id],
    ),
  );
}

/** Shared by the app, admin panel and Telegram bot. */
export async function reviewEcoAction(id: string, reviewer: AuthUser, approve: boolean, reason?: string | null) {
  const action = await one('select * from eco_actions where id = $1', [id]);
  if (!action) fail(404, 'not_found');
  if (!(await canReview(reviewer, action as any))) fail(403, 'forbidden');
  if (action!.status !== 'pending') fail(409, 'already_reviewed');
  const status = approve ? 'approved' : 'rejected';
  await tx(async (c) => {
    await c.query(`update eco_actions set status = $2, reviewed_by = $3, review_reason = $4, reviewed_at = now() where id = $1`, [
      id, status, reviewer.id, reason ?? null,
    ]);
    await setPointsStatus('eco_action', id, approve ? 'confirmed' : 'rejected', c);
    if (approve && action!.dirty_spot_id) {
      await c.query(`update dirty_spots set status = 'cleaned', cleaned_at = now() where id = $1`, [action!.dirty_spot_id]);
    }
  });
  const pts = await one(`select amount from points_transactions where source_type = 'eco_action' and source_id = $1`, [id]);
  if (approve) await notify(action!.user_id, 'eco_approved', { points: pts?.amount ?? 0 }, { eco: id });
  else await notify(action!.user_id, 'eco_rejected', { reason: reason ?? '—' }, { eco: id });
  if (approve) afterProgress(action!.user_id);
  return { status };
}

export default async function ecoRoutes(app: FastifyInstance) {
  app.post(
    '/eco/actions',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        tags: ['eco'],
        body: S.obj(
          {
            run_id: S.nuuid(), activity_id: S.nuuid(), dirty_spot_id: S.nuuid(),
            bags_small: S.int({ minimum: 0, maximum: 20 }), bags_large: S.int({ minimum: 0, maximum: 20 }),
            waste_types: S.arr(S.enum(WASTE), { minItems: 1, maxItems: 5 }),
            photo_before_url: S.nstr({ maxLength: 200 }), photo_after_url: S.str({ maxLength: 200 }),
            lat: S.num({ minimum: -90, maximum: 90 }), lng: S.num({ minimum: -180, maximum: 180 }),
          },
          ['bags_small', 'bags_large', 'waste_types', 'photo_after_url', 'lat', 'lng'],
        ),
      },
    },
    async (req) => {
      const b = req.body as any;
      const u = req.user!;
      const s = await getSettings();
      if (b.bags_small + b.bags_large < 1) fail(400, 'no_bags');
      for (const url of [b.photo_before_url, b.photo_after_url].filter(Boolean)) {
        if (!isUploadUrl(url)) fail(400, 'invalid_photo');
        const up = await one('select user_id from uploads where url = $1', [url]);
        if (up?.user_id !== u.id) fail(400, 'photo_not_yours');
      }
      const meta = (await one('select meta from uploads where url = $1', [b.photo_after_url]))?.meta ?? {};
      const verification: Record<string, unknown> = { device_geo: [b.lat, b.lng], exif: meta };
      let run: any = null;
      if (b.run_id) {
        run = await one('select * from runs where id = $1', [b.run_id]);
        if (!run) fail(404, 'run_not_found');
        const p = await one('select status from participations where run_id = $1 and user_id = $2', [run.id, u.id]);
        if (p?.status !== 'checked_in' && run.organizer_id !== u.id) fail(400, 'not_checked_in');
        const start = new Date(run.start_at).getTime();
        if (Date.now() < start) fail(400, 'run_not_started');
        if (Date.now() > start + s.eco.max_hours_after_run * 3600_000) fail(400, 'too_late');
        const path = [{ lat: run.meeting_lat, lng: run.meeting_lng }, ...((run.route ?? []) as [number, number][]).map(([lat, lng]) => ({ lat, lng }))];
        const d = minDistanceToPath({ lat: b.lat, lng: b.lng }, path);
        verification.device_distance_m = Math.round(d);
        verification.device_geo_ok = d <= s.eco.max_distance_from_run_m;
        if (!verification.device_geo_ok) fail(400, 'too_far_from_run', `${Math.round(d)}`);
        if (meta.lat != null) {
          const de = minDistanceToPath({ lat: meta.lat, lng: meta.lng }, path);
          verification.exif_distance_m = Math.round(de);
          verification.exif_geo_ok = de <= s.eco.max_distance_from_run_m;
        }
        if (meta.takenAt) {
          const tt = new Date(meta.takenAt).getTime();
          verification.exif_time_ok = tt >= start - 3600_000 && tt <= Date.now() + 300_000;
        }
        if (verification.exif_geo_ok === false || verification.exif_time_ok === false) fail(400, 'photo_does_not_match_run');
      } else {
        if (meta.lat != null) {
          const de = distanceM({ lat: meta.lat, lng: meta.lng }, { lat: b.lat, lng: b.lng });
          verification.exif_distance_m = Math.round(de);
          verification.exif_geo_ok = de <= s.eco.max_distance_from_run_m;
        }
        if (meta.takenAt) verification.exif_time_ok = Date.now() - new Date(meta.takenAt).getTime() <= s.eco.max_hours_after_run * 3600_000;
      }
      if (b.dirty_spot_id) {
        const spot = await one('select lat, lng, status from dirty_spots where id = $1', [b.dirty_spot_id]);
        if (!spot || spot.status === 'cleaned' || spot.status === 'rejected') fail(400, 'spot_unavailable');
        verification.spot_distance_m = Math.round(distanceM({ lat: b.lat, lng: b.lng }, spot!));
        if ((verification.spot_distance_m as number) > 500) fail(400, 'too_far_from_spot');
      }

      const points = await bagPoints(b.bags_small, b.bags_large);
      // Solo plogging can be auto-approved up to a daily bag cap when all automatic checks pass.
      let autoApprove = false;
      if (!run && s.caps.solo_plogging_auto_approve_bags_per_day > 0 && verification.exif_geo_ok !== false && verification.exif_time_ok !== false) {
        const today = await one(
          `select coalesce(sum(bags_small + bags_large), 0) as n from eco_actions
           where user_id = $1 and run_id is null and status = 'approved' and reviewed_by is null
             and created_at >= date_trunc('day', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'`,
          [u.id],
        );
        autoApprove = Number(today!.n) + b.bags_small + b.bags_large <= s.caps.solo_plogging_auto_approve_bags_per_day;
      }
      // Organizer's own plogging on their run goes to moderators, not to themselves.
      const action = await one(
        `insert into eco_actions (user_id, run_id, activity_id, dirty_spot_id, bags_small, bags_large, waste_types, photo_before_url, photo_after_url, lat, lng, verification, status, reviewed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id, status`,
        [
          u.id, b.run_id ?? null, b.activity_id ?? null, b.dirty_spot_id ?? null, b.bags_small, b.bags_large, b.waste_types,
          b.photo_before_url ?? null, b.photo_after_url, b.lat, b.lng, JSON.stringify(verification),
          autoApprove ? 'approved' : 'pending', autoApprove ? new Date() : null,
        ],
      );
      const txp = await award({ userId: u.id, reason: 'plogging_bag', amount: points, sourceType: 'eco_action', sourceId: action!.id, status: autoApprove ? 'confirmed' : 'pending' });
      if (autoApprove) {
        if (b.dirty_spot_id) await q(`update dirty_spots set status = 'cleaned', cleaned_at = now() where id = $1`, [b.dirty_spot_id]);
        afterProgress(u.id);
      } else if (run && run.organizer_id !== u.id) {
        const org = await one('select telegram_id, language from users where id = $1', [run.organizer_id]);
        await notify(run.organizer_id, 'eco_review_request', { name: u.name ?? '', run: run.title, bags: b.bags_small + b.bags_large }, { eco: action!.id, run: run.id }, { telegram: false });
        if (org?.telegram_id) {
          const labels: Record<string, [string, string]> = { uz: ['Tasdiqlash', 'Rad etish'], ru: ['Подтвердить', 'Отклонить'], en: ['Approve', 'Reject'] };
          const [ok, no] = labels[org.language] ?? labels.uz;
          await tgSend(
            org.telegram_id,
            `<b>${esc(run.title)}</b>\n${esc(u.name ?? '')}: ${b.bags_small} S + ${b.bags_large} L · ${esc(b.waste_types.join(', '))}`,
            [[{ text: ok, callback_data: `eco:ok:${action!.id}` }, { text: no, callback_data: `eco:no:${action!.id}` }]],
          );
        }
      }
      return { id: action!.id, status: action!.status, points: txp?.amount ?? 0, verification };
    },
  );

  app.get('/eco/actions/mine', { preHandler: requireAuth, schema: { tags: ['eco'] } }, async (req) =>
    q(
      `select e.*, r.title as run_title, (select amount from points_transactions where source_type = 'eco_action' and source_id = e.id::text limit 1) as points
       from eco_actions e left join runs r on r.id = e.run_id where e.user_id = $1 order by e.created_at desc limit 100`,
      [req.user!.id],
    ),
  );

  app.get('/eco/actions/to-review', { preHandler: requireAuth, schema: { tags: ['eco'] } }, async (req) =>
    q(
      `select e.*, r.title as run_title, json_build_object('id', u.id, 'name', u.name, 'photo_url', u.photo_url) as user
       from eco_actions e join runs r on r.id = e.run_id join users u on u.id = e.user_id
       where e.status = 'pending' and e.user_id <> $1 and (r.organizer_id = $1 or exists (
         select 1 from club_members cm where cm.club_id = r.club_id and cm.user_id = $1 and cm.role in ('owner','co_organizer')))
       order by e.created_at`,
      [req.user!.id],
    ),
  );

  app.post(
    '/eco/actions/:id/review',
    { preHandler: requireAuth, schema: { tags: ['eco'], params: idParam, body: S.obj({ approve: S.bool(), reason: S.nstr({ maxLength: 300 }) }, ['approve']) } },
    async (req) => {
      const b = req.body as any;
      if (!b.approve && !b.reason) fail(400, 'reason_required');
      return reviewEcoAction((req.params as any).id, req.user!, b.approve, b.reason);
    },
  );

  // ---- Dirty spots ----
  app.post(
    '/eco/spots',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        tags: ['eco'],
        body: S.obj({ lat: S.num({ minimum: -90, maximum: 90 }), lng: S.num({ minimum: -180, maximum: 180 }), photo_url: S.str({ maxLength: 200 }), description: S.nstr({ maxLength: 500 }) }, ['lat', 'lng', 'photo_url']),
      },
    },
    async (req) => {
      const b = req.body as any;
      if (!isUploadUrl(b.photo_url)) fail(400, 'invalid_photo');
      const dup = await one(
        `select id from dirty_spots where status in ('reported','approved','scheduled') and earth_distance(ll_to_earth(lat, lng), ll_to_earth($1, $2)) < 50`,
        [b.lat, b.lng],
      );
      if (dup) fail(409, 'spot_exists');
      const s = await getSettings();
      const spot = await one(`insert into dirty_spots (reporter_id, lat, lng, photo_url, description) values ($1,$2,$3,$4,$5) returning id, status`, [
        req.user!.id, b.lat, b.lng, b.photo_url, b.description ?? null,
      ]);
      await award({ userId: req.user!.id, reason: 'dirty_spot', amount: s.points.dirty_spot, sourceType: 'dirty_spot', sourceId: spot!.id, status: 'pending' });
      return spot;
    },
  );

  app.get('/eco/spots', { preHandler: optionalAuth, schema: { tags: ['eco'], querystring: S.obj({ lat: S.num(), lng: S.num(), radius_km: S.num({ maximum: 100 }) }) } }, async (req) => {
    const { lat, lng, radius_km = 30 } = req.query as any;
    const staff = req.user && STAFF.includes(req.user.role);
    const params: unknown[] = [req.user?.id ?? null, Boolean(staff)];
    let geo = '';
    if (lat != null && lng != null) {
      params.push(lat, lng, radius_km * 1000);
      geo = `and earth_box(ll_to_earth($3, $4), $5) @> ll_to_earth(s.lat, s.lng)`;
    }
    return q(
      `select s.id, s.lat, s.lng, s.photo_url, s.description, s.status, s.created_at, s.cleaned_at, (s.reporter_id = $1) as mine,
              (select id from runs r where r.dirty_spot_id = s.id and r.status = 'scheduled' and r.start_at > now() order by start_at limit 1) as run_id
       from dirty_spots s
       where (s.status in ('approved','scheduled') or (s.status = 'cleaned' and s.cleaned_at > now() - interval '30 days')
              or (s.status = 'reported' and (s.reporter_id = $1 or $2))) ${geo}
       order by s.created_at desc limit 300`,
      params,
    );
  });

  // ---- Donations: convert points into sponsored tree planting / charity ----
  app.get('/eco/donations', { preHandler: optionalAuth, schema: { tags: ['eco'] } }, async (req) => {
    const lang = req.user?.language ?? 'uz';
    const rows = await q(
      `select d.*, coalesce((select -sum(amount) from points_transactions where reason = 'donation' and source_type = 'donation' and split_part(source_id, ':', 1) = d.id::text), 0) as raised
       from donation_projects d where d.active order by d.created_at`,
    );
    return rows.map((r) => ({ ...r, title: pickI18n(r.title, lang), description: pickI18n(r.description, lang), unit_label: pickI18n(r.unit_label, lang) }));
  });

  app.post(
    '/eco/donations/:id',
    { preHandler: requireAuth, schema: { tags: ['eco'], params: idParam, body: S.obj({ points: S.int({ minimum: 10, maximum: 100000 }) }, ['points']) } },
    async (req) => {
      const { id } = req.params as any;
      const amount = (req.body as any).points;
      const proj = await one('select id from donation_projects where id = $1 and active', [id]);
      if (!proj) fail(404, 'not_found');
      return tx(async (c) => {
        await c.query('select id from users where id = $1 for update', [req.user!.id]);
        const bal = await balance(req.user!.id);
        if (bal.balance < amount) fail(400, 'not_enough_points');
        await award({ userId: req.user!.id, reason: 'donation', amount: -amount, sourceType: 'donation', sourceId: `${id}:${Date.now()}` }, c);
        return { ok: true };
      });
    },
  );
}
