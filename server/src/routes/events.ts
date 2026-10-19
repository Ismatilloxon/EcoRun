import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { one, q } from '../db.ts';
import { fail, idParam, S, toCsv } from '../http.ts';
import { optionalAuth, requireAuth, requireRole, STAFF } from '../auth.ts';
import { isUploadUrl } from '../uploads.ts';

const paymentsConfigured = () => Boolean(config.payments.payme || config.payments.click || config.payments.uzum);

const eventBody = (required: string[]) =>
  S.obj(
    {
      title: S.str({ minLength: 3, maxLength: 120 }),
      description: S.nstr({ maxLength: 5000 }),
      type: S.enum(['race', 'eco_run', 'virtual']),
      start_at: S.str({ format: 'date-time' }),
      location: S.nstr({ maxLength: 200 }),
      lat: S.nnum(), lng: S.nnum(),
      distances: S.arr(S.obj({ km: S.num({ minimum: 0.5, maximum: 200 }), price: S.int({ minimum: 0 }), limit: S.nint({ minimum: 1 }) }, ['km', 'price']), { minItems: 1, maxItems: 8 }),
      registration_opens_at: S.nstr({ format: 'date-time' }),
      registration_closes_at: S.nstr({ format: 'date-time' }),
      cover_url: S.nstr({ maxLength: 200 }),
      status: S.enum(['draft', 'published', 'cancelled', 'finished']),
    },
    required,
  );

export default async function eventRoutes(app: FastifyInstance) {
  app.get('/events', { preHandler: optionalAuth, schema: { tags: ['events'] } }, async (req) =>
    q(
      `select e.*, (select count(*) from event_registrations r where r.event_id = e.id and r.status = 'confirmed') as registered,
              (select json_build_object('status', r.status, 'ticket_code', r.ticket_code, 'distance_km', r.distance_km) from event_registrations r where r.event_id = e.id and r.user_id = $1) as my_registration
       from events e where e.status = 'published' and e.start_at > now() - interval '1 day' order by e.start_at`,
      [req.user?.id ?? null],
    ),
  );

  app.get('/events/:id', { preHandler: optionalAuth, schema: { tags: ['events'], params: idParam } }, async (req) => {
    const e = await one(
      `select e.*, (select json_build_object('status', r.status, 'ticket_code', r.ticket_code, 'distance_km', r.distance_km) from event_registrations r where r.event_id = e.id and r.user_id = $2) as my_registration
       from events e where e.id = $1`,
      [(req.params as any).id, req.user?.id ?? null],
    );
    if (!e || (e.status === 'draft' && e.organizer_id !== req.user?.id)) fail(404, 'not_found');
    const counts = await q(`select distance_km, count(*) as n from event_registrations where event_id = $1 and status = 'confirmed' group by distance_km`, [e!.id]);
    return { ...e, counts, payments_configured: paymentsConfigured() };
  });

  app.post('/events/:id/register', { preHandler: requireAuth, schema: { tags: ['events'], params: idParam, body: S.obj({ distance_km: S.num() }, ['distance_km']) } }, async (req) => {
    const e = await one(`select * from events where id = $1 and status = 'published'`, [(req.params as any).id]);
    if (!e) fail(404, 'not_found');
    const now = Date.now();
    if (e!.registration_opens_at && new Date(e!.registration_opens_at).getTime() > now) fail(400, 'registration_not_open');
    if (e!.registration_closes_at && new Date(e!.registration_closes_at).getTime() < now) fail(400, 'registration_closed');
    const dist = (e!.distances as any[]).find((d) => Number(d.km) === Number((req.body as any).distance_km));
    if (!dist) fail(400, 'invalid_distance');
    if (dist.limit) {
      const n = await one(`select count(*) as n from event_registrations where event_id = $1 and distance_km = $2 and status in ('confirmed','pending_payment')`, [e!.id, dist.km]);
      if (Number(n!.n) >= dist.limit) fail(409, 'sold_out');
    }
    const paid = dist.price > 0;
    if (paid && !paymentsConfigured()) fail(501, 'payments_not_configured');
    const reg = await one(
      `insert into event_registrations (event_id, user_id, distance_km, amount, status, provider) values ($1,$2,$3,$4,$5,$6)
       on conflict (event_id, user_id) do update set distance_km = excluded.distance_km, amount = excluded.amount,
         status = case when event_registrations.status = 'confirmed' then 'confirmed' else excluded.status end
       returning id, status, ticket_code, amount`,
      [e!.id, req.user!.id, dist.km, dist.price, paid ? 'pending_payment' : 'confirmed', paid ? 'payme' : null],
    );
    // Phase 2: build the Payme/Click/Uzum checkout URL from the merchant id and registration id here.
    return { ...reg, payment_required: paid };
  });

  app.post('/events', { preHandler: requireRole('event_organizer', 'admin'), schema: { tags: ['events'], body: eventBody(['title', 'start_at', 'distances']) } }, async (req) => {
    const b = req.body as any;
    if (b.cover_url && !isUploadUrl(b.cover_url)) fail(400, 'invalid_cover');
    return one(
      `insert into events (organizer_id, title, description, type, start_at, location, lat, lng, distances, registration_opens_at, registration_closes_at, cover_url, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [req.user!.id, b.title, b.description ?? null, b.type ?? 'race', b.start_at, b.location ?? null, b.lat ?? null, b.lng ?? null, JSON.stringify(b.distances),
        b.registration_opens_at ?? null, b.registration_closes_at ?? null, b.cover_url ?? null, b.status ?? 'published'],
    );
  });

  app.patch('/events/:id', { preHandler: requireRole('event_organizer', 'admin'), schema: { tags: ['events'], params: idParam, body: eventBody([]) } }, async (req) => {
    const e = await one('select organizer_id from events where id = $1', [(req.params as any).id]);
    if (!e) fail(404, 'not_found');
    if (e!.organizer_id !== req.user!.id && !STAFF.includes(req.user!.role)) fail(403, 'forbidden');
    const b = req.body as Record<string, any>;
    if (b.distances) b.distances = JSON.stringify(b.distances);
    const keys = Object.keys(b);
    if (keys.length) await q(`update events set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [(req.params as any).id, ...keys.map((k) => b[k])]);
    return { ok: true };
  });

  app.get('/events/:id/registrations', { preHandler: requireRole('event_organizer', 'admin'), schema: { tags: ['events'], params: idParam, querystring: S.obj({ format: S.enum(['json', 'csv']) }) } }, async (req, reply) => {
    const e = await one('select organizer_id from events where id = $1', [(req.params as any).id]);
    if (!e) fail(404, 'not_found');
    if (e!.organizer_id !== req.user!.id && !STAFF.includes(req.user!.role)) fail(403, 'forbidden');
    const rows = await q(
      `select u.name, u.phone, r.distance_km, r.amount, r.status, r.ticket_code, r.created_at from event_registrations r join users u on u.id = r.user_id where r.event_id = $1 order by r.created_at`,
      [(req.params as any).id],
    );
    if ((req.query as any).format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="registrations.csv"');
      return '﻿' + toCsv(rows, ['name', 'phone', 'distance_km', 'amount', 'status', 'ticket_code', 'created_at']);
    }
    return rows;
  });

  app.get('/organizer/events', { preHandler: requireRole('event_organizer', 'admin'), schema: { tags: ['events'] } }, async (req) =>
    q(
      `select e.*, (select count(*) from event_registrations r where r.event_id = e.id and r.status = 'confirmed') as registered,
              (select coalesce(sum(amount), 0) from event_registrations r where r.event_id = e.id and r.status = 'confirmed') as revenue
       from events e where e.organizer_id = $1 or $2 order by e.start_at desc`,
      [req.user!.id, req.user!.role === 'admin'],
    ),
  );
}
