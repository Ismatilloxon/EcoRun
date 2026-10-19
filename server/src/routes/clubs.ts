import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.ts';
import { fail, idParam, S } from '../http.ts';
import { optionalAuth, requireAuth, STAFF, type AuthUser } from '../auth.ts';
import { isUploadUrl } from '../uploads.ts';
import { womenOnlyFilter } from './runs.ts';

export async function clubRole(clubId: string, user: AuthUser | null) {
  if (!user) return null;
  return (await one('select role from club_members where club_id = $1 and user_id = $2', [clubId, user.id]))?.role ?? null;
}

async function requireClubManager(clubId: string, user: AuthUser, ownerOnly = false) {
  if (STAFF.includes(user.role)) return;
  const role = await clubRole(clubId, user);
  if (ownerOnly ? role !== 'owner' : !['owner', 'co_organizer'].includes(role ?? '')) fail(403, 'forbidden');
}

const clubBody = (required: string[]) =>
  S.obj(
    {
      name: S.str({ minLength: 2, maxLength: 80 }),
      description: S.nstr({ maxLength: 3000 }),
      logo_url: S.nstr({ maxLength: 200 }),
      cover_url: S.nstr({ maxLength: 200 }),
      district: S.nstr({ maxLength: 60 }),
      lat: S.nnum({ minimum: -90, maximum: 90 }),
      lng: S.nnum({ minimum: -180, maximum: 180 }),
      address: S.nstr({ maxLength: 200 }),
      schedule_text: S.nstr({ maxLength: 300 }),
      telegram_link: S.nstr({ maxLength: 120, pattern: '^(https://t\\.me/[A-Za-z0-9_+/]+)?$' }),
      instagram: S.nstr({ maxLength: 60, pattern: '^[A-Za-z0-9_.]*$' }),
    },
    required,
  );

export default async function clubRoutes(app: FastifyInstance) {
  app.get('/clubs', { preHandler: optionalAuth, schema: { tags: ['clubs'], querystring: S.obj({ q: S.str({ maxLength: 60 }), district: S.str({ maxLength: 60 }), mine: S.bool() }) } }, async (req) => {
    const f = req.query as any;
    return q(
      `select c.id, c.name, c.logo_url, c.cover_url, c.district, c.schedule_text, c.verified, c.featured,
              (select count(*) from club_members m where m.club_id = c.id) as members,
              (select count(*) from runs r where r.club_id = c.id and r.start_at > now() and r.status = 'scheduled' and not r.hidden) as upcoming_runs,
              (select role from club_members m where m.club_id = c.id and m.user_id = $1) as my_role
       from clubs c
       where not c.hidden and ($2::text is null or c.name ilike '%' || $2 || '%') and ($3::text is null or c.district = $3)
         and ($4::boolean is not true or exists (select 1 from club_members m where m.club_id = c.id and m.user_id = $1))
       order by c.featured desc, c.verified desc, members desc`,
      [req.user?.id ?? null, f.q?.replace(/[%_]/g, '') || null, f.district ?? null, f.mine ?? null],
    );
  });

  app.get('/clubs/:id', { preHandler: optionalAuth, schema: { tags: ['clubs'], params: idParam } }, async (req) => {
    const { id } = req.params as any;
    const club = await one(`select c.*, (select count(*) from club_members m where m.club_id = c.id) as members from clubs c where c.id = $1`, [id]);
    if (!club) fail(404, 'not_found');
    const myRole = await clubRole(id, req.user);
    if (club!.hidden && !myRole && !(req.user && STAFF.includes(req.user.role))) fail(404, 'not_found');
    const members = await q(
      `select u.id, u.name, u.photo_url, m.role from club_members m join users u on u.id = m.user_id
       where m.club_id = $1 and u.deleted_at is null order by case m.role when 'owner' then 0 when 'co_organizer' then 1 else 2 end, m.joined_at limit 200`,
      [id],
    );
    const runs = await q(
      `select r.id, r.title, r.type, r.start_at, r.distance_km, r.meeting_address, r.level, r.women_only, r.recurrence_rule,
              (select count(*) from participations p where p.run_id = r.id and p.status in ('joined','checked_in')) as participants_count
       from runs r where r.club_id = $1 and r.start_at > now() - interval '2 hours' and r.status = 'scheduled' and not r.hidden and ${womenOnlyFilter(req.user)}
       order by r.start_at limit 20`,
      [id],
    );
    const photos = await q('select id, url from club_photos where club_id = $1 order by created_at desc limit 60', [id]);
    return { ...club, my_role: myRole, members_list: members, runs, photos };
  });

  app.post('/clubs', { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: '1 day' } }, schema: { tags: ['clubs'], body: clubBody(['name']) } }, async (req) => {
    const b = req.body as any;
    for (const k of ['logo_url', 'cover_url']) if (b[k] && !isUploadUrl(b[k])) fail(400, 'invalid_image');
    const club = await one(
      `insert into clubs (name, description, logo_url, cover_url, district, lat, lng, address, schedule_text, telegram_link, instagram, owner_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [b.name, b.description ?? null, b.logo_url ?? null, b.cover_url ?? null, b.district ?? null, b.lat ?? null, b.lng ?? null, b.address ?? null,
        b.schedule_text ?? null, b.telegram_link || null, b.instagram || null, req.user!.id],
    );
    await q(`insert into club_members (club_id, user_id, role) values ($1, $2, 'owner')`, [club!.id, req.user!.id]);
    await q(`update users set role = 'club_organizer' where id = $1 and role = 'runner'`, [req.user!.id]);
    return club;
  });

  app.patch('/clubs/:id', { preHandler: requireAuth, schema: { tags: ['clubs'], params: idParam, body: clubBody([]) } }, async (req) => {
    const { id } = req.params as any;
    await requireClubManager(id, req.user!);
    const b = req.body as Record<string, any>;
    for (const k of ['logo_url', 'cover_url']) if (b[k] && !isUploadUrl(b[k])) fail(400, 'invalid_image');
    const keys = Object.keys(b);
    if (keys.length) await q(`update clubs set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((k) => b[k] === '' ? null : b[k])]);
    return { ok: true };
  });

  app.post('/clubs/:id/join', { preHandler: requireAuth, schema: { tags: ['clubs'], params: idParam } }, async (req) => {
    await q(`insert into club_members (club_id, user_id) select id, $2 from clubs where id = $1 and not hidden on conflict do nothing`, [(req.params as any).id, req.user!.id]);
    return { ok: true };
  });

  app.post('/clubs/:id/leave', { preHandler: requireAuth, schema: { tags: ['clubs'], params: idParam } }, async (req) => {
    await q(`delete from club_members where club_id = $1 and user_id = $2 and role <> 'owner'`, [(req.params as any).id, req.user!.id]);
    return { ok: true };
  });

  app.post(
    '/clubs/:id/members/:userId',
    { preHandler: requireAuth, schema: { tags: ['clubs'], params: S.obj({ id: S.uuid(), userId: S.uuid() }, ['id', 'userId']), body: S.obj({ role: S.enum(['co_organizer', 'member', 'remove']) }, ['role']) } },
    async (req) => {
      const { id, userId } = req.params as any;
      await requireClubManager(id, req.user!, true);
      const role = (req.body as any).role;
      const target = await clubRole(id, { id: userId } as AuthUser);
      if (target === 'owner') fail(400, 'cannot_change_owner');
      if (role === 'remove') await q('delete from club_members where club_id = $1 and user_id = $2', [id, userId]);
      else await q('update club_members set role = $3 where club_id = $1 and user_id = $2', [id, userId, role]);
      if (role === 'co_organizer') await q(`update users set role = 'club_organizer' where id = $1 and role = 'runner'`, [userId]);
      return { ok: true };
    },
  );

  app.post('/clubs/:id/photos', { preHandler: requireAuth, schema: { tags: ['clubs'], params: idParam, body: S.obj({ url: S.str({ maxLength: 200 }) }, ['url']) } }, async (req) => {
    const { id } = req.params as any;
    await requireClubManager(id, req.user!);
    if (!isUploadUrl((req.body as any).url)) fail(400, 'invalid_image');
    return one('insert into club_photos (club_id, url) values ($1, $2) returning id, url', [id, (req.body as any).url]);
  });

  app.delete('/clubs/:id/photos/:photoId', { preHandler: requireAuth, schema: { tags: ['clubs'], params: S.obj({ id: S.uuid(), photoId: S.uuid() }, ['id', 'photoId']) } }, async (req) => {
    const { id, photoId } = req.params as any;
    await requireClubManager(id, req.user!);
    await q('delete from club_photos where id = $1 and club_id = $2', [photoId, id]);
    return { ok: true };
  });

  app.post('/clubs/:id/verification', { preHandler: requireAuth, schema: { tags: ['clubs'], params: idParam } }, async (req) => {
    const { id } = req.params as any;
    await requireClubManager(id, req.user!, true);
    await q('update clubs set verification_requested_at = now() where id = $1 and not verified', [id]);
    return { ok: true };
  });

  // Organizer cabinet overview
  app.get('/organizer/overview', { preHandler: requireAuth, schema: { tags: ['organizer'] } }, async (req) => {
    const clubs = await q(
      `select c.id, c.name, c.logo_url, c.verified, c.verification_requested_at, m.role,
              (select count(*) from club_members x where x.club_id = c.id) as members
       from club_members m join clubs c on c.id = m.club_id where m.user_id = $1 and m.role in ('owner','co_organizer') order by c.name`,
      [req.user!.id],
    );
    const runs = await q(
      `select r.id, r.title, r.start_at, r.status, r.type, r.capacity, r.recurrence_rule, r.series_id, c.name as club_name,
              (select count(*) from participations p where p.run_id = r.id and p.status in ('joined','checked_in')) as joined,
              (select count(*) from participations p where p.run_id = r.id and p.status = 'checked_in') as checked_in,
              (select count(*) from participations p where p.run_id = r.id and p.status = 'pending') as pending,
              (select count(*) from participations p where p.run_id = r.id and p.status = 'waitlist') as waitlist
       from runs r left join clubs c on c.id = r.club_id
       where r.organizer_id = $1 or r.club_id in (select club_id from club_members where user_id = $1 and role in ('owner','co_organizer'))
       order by r.start_at desc limit 200`,
      [req.user!.id],
    );
    const totals = await one(
      `select count(distinct p.user_id) as unique_runners, count(*) filter (where p.status = 'checked_in') as checkins, count(*) as joins
       from participations p join runs r on r.id = p.run_id
       where (r.organizer_id = $1 or r.club_id in (select club_id from club_members where user_id = $1 and role in ('owner','co_organizer'))) and p.user_id <> r.organizer_id`,
      [req.user!.id],
    );
    return { clubs, runs, totals };
  });
}
