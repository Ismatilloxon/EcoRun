import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, q } from '../db.ts';
import { fail, idParam, S } from '../http.ts';
import { requireRole } from '../auth.ts';
import { notifyMany } from '../notify.ts';
import { isUploadUrl } from '../uploads.ts';
import { partnerIdsFor, redeemCode } from './rewards.ts';

const rewardBody = (required: string[]) =>
  S.obj(
    {
      title: S.str({ minLength: 2, maxLength: 120 }),
      description: S.nstr({ maxLength: 2000 }),
      terms: S.nstr({ maxLength: 2000 }),
      photo_url: S.nstr({ maxLength: 200 }),
      category: S.enum(['cafe', 'sport', 'gym', 'eco', 'other']),
      points_price: S.int({ minimum: 1, maximum: 1000000 }),
      stock: S.int({ minimum: 0, maximum: 1000000 }),
      valid_until: S.nstr({ format: 'date' }),
      branches: S.arr(S.str({ maxLength: 120 }), { maxItems: 50 }),
      active: S.bool(),
      partner_id: S.uuid(),
    },
    required,
  );

async function myPartner(req: FastifyRequest, wanted?: string) {
  if (req.user!.role === 'admin' && wanted) return wanted;
  const ids = await partnerIdsFor(req.user!);
  if (!ids.length) fail(403, 'not_partner');
  if (wanted && !ids.includes(wanted)) fail(403, 'forbidden');
  return wanted ?? ids[0];
}

export default async function partnerRoutes(app: FastifyInstance) {
  const guard = requireRole('partner', 'admin');

  app.get('/partner/overview', { preHandler: guard, schema: { tags: ['partner'], querystring: S.obj({ partner: S.uuid() }) } }, async (req) => {
    const pid = await myPartner(req, (req.query as any).partner);
    const partner = await one('select * from partners where id = $1', [pid]);
    const stats = await one(
      `select count(*) filter (where rd.status = 'redeemed') as redeemed,
              count(*) filter (where rd.status = 'redeemed' and rd.redeemed_at >= date_trunc('month', now())) as redeemed_month,
              count(*) filter (where rd.status = 'issued' and rd.expires_at > now()) as outstanding,
              count(distinct rd.user_id) filter (where rd.status = 'redeemed') as unique_users,
              coalesce(sum(rd.points_spent) filter (where rd.status = 'redeemed'), 0) as points
       from redemptions rd join rewards rw on rw.id = rd.reward_id where rw.partner_id = $1`,
      [pid],
    );
    const monthly = await q(
      `select to_char(date_trunc('month', rd.redeemed_at), 'YYYY-MM') as month, count(*) as redemptions, count(distinct rd.user_id) as users
       from redemptions rd join rewards rw on rw.id = rd.reward_id
       where rw.partner_id = $1 and rd.status = 'redeemed' and rd.redeemed_at > now() - interval '12 months'
       group by 1 order by 1`,
      [pid],
    );
    const sponsored = await q(
      `select c.id, c.title, c.ends_at, (select count(*) from challenge_participants cp where cp.challenge_id = c.id) as participants,
              (select count(*) from challenge_participants cp where cp.challenge_id = c.id and cp.completed_at is not null) as completed
       from challenges c where c.sponsor_partner_id = $1 order by c.ends_at desc`,
      [pid],
    );
    const partners = req.user!.role === 'admin' ? await q('select id, name from partners order by name') : await q('select p.id, p.name from partners p join partner_users pu on pu.partner_id = p.id where pu.user_id = $1', [req.user!.id]);
    return { partner, stats, monthly, sponsored, partners };
  });

  app.get('/partner/rewards', { preHandler: guard, schema: { tags: ['partner'], querystring: S.obj({ partner: S.uuid() }) } }, async (req) => {
    const pid = await myPartner(req, (req.query as any).partner);
    return q(
      `select rw.*, (select count(*) from redemptions rd where rd.reward_id = rw.id and rd.status = 'redeemed') as redeemed,
              (select count(*) from redemptions rd where rd.reward_id = rw.id and rd.status = 'issued' and rd.expires_at > now()) as outstanding
       from rewards rw where rw.partner_id = $1 order by rw.created_at desc`,
      [pid],
    );
  });

  app.post('/partner/rewards', { preHandler: guard, schema: { tags: ['partner'], body: rewardBody(['title', 'points_price', 'stock']) } }, async (req) => {
    const b = req.body as any;
    const pid = await myPartner(req, b.partner_id);
    if (b.photo_url && !isUploadUrl(b.photo_url)) fail(400, 'invalid_photo');
    const r = await one(
      `insert into rewards (partner_id, title, description, terms, photo_url, category, points_price, stock, valid_until, branches, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, title, points_price, active`,
      [pid, b.title, b.description ?? null, b.terms ?? null, b.photo_url ?? null, b.category ?? 'other', b.points_price, b.stock, b.valid_until ?? null, b.branches ?? [], b.active ?? true],
    );
    if (r!.active) {
      // Announce new rewards to recently active runners (in-app + push only).
      const users = await q(`select distinct user_id from user_days where day > current_date - 14 limit 2000`);
      notifyMany(users.map((u) => u.user_id), 'new_reward', { title: r!.title, points: r!.points_price }, { reward: r!.id }, { telegram: false }).catch(() => {});
    }
    return r;
  });

  app.patch('/partner/rewards/:id', { preHandler: guard, schema: { tags: ['partner'], params: idParam, body: rewardBody([]) } }, async (req) => {
    const rw = await one('select partner_id from rewards where id = $1', [(req.params as any).id]);
    if (!rw) fail(404, 'not_found');
    await myPartner(req, rw!.partner_id);
    const b = req.body as Record<string, any>;
    delete b.partner_id;
    if (b.photo_url && !isUploadUrl(b.photo_url)) fail(400, 'invalid_photo');
    const keys = Object.keys(b);
    if (keys.length) await q(`update rewards set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [(req.params as any).id, ...keys.map((k) => b[k])]);
    return { ok: true };
  });

  app.post('/partner/redeem/check', { preHandler: guard, config: { rateLimit: { max: 60, timeWindow: '10 minutes' } }, schema: { tags: ['partner'], body: S.obj({ code: S.str({ maxLength: 32 }) }, ['code']) } }, async (req) =>
    redeemCode((req.body as any).code, req.user!, null, true),
  );

  app.post(
    '/partner/redeem',
    { preHandler: guard, config: { rateLimit: { max: 60, timeWindow: '10 minutes' } }, schema: { tags: ['partner'], body: S.obj({ code: S.str({ maxLength: 32 }), branch: S.nstr({ maxLength: 120 }) }, ['code']) } },
    async (req) => redeemCode((req.body as any).code, req.user!, (req.body as any).branch ?? null),
  );

  app.get('/partner/redemptions', { preHandler: guard, schema: { tags: ['partner'], querystring: S.obj({ partner: S.uuid() }) } }, async (req) => {
    const pid = await myPartner(req, (req.query as any).partner);
    return q(
      `select rd.id, rd.code, rd.status, rd.points_spent, rd.created_at, rd.redeemed_at, rd.branch, rw.title, u.name as user_name, s.name as staff_name
       from redemptions rd join rewards rw on rw.id = rd.reward_id join users u on u.id = rd.user_id left join users s on s.id = rd.redeemed_by
       where rw.partner_id = $1 order by coalesce(rd.redeemed_at, rd.created_at) desc limit 300`,
      [pid],
    );
  });

  app.post(
    '/partner/challenges',
    {
      preHandler: guard,
      schema: {
        tags: ['partner'],
        body: S.obj(
          {
            title: S.str({ minLength: 3, maxLength: 120 }), description: S.nstr({ maxLength: 1000 }),
            metric: S.enum(['km', 'group_runs', 'plogging_runs', 'eco_points', 'runs']), target: S.num({ minimum: 1 }),
            starts_at: S.str({ format: 'date-time' }), ends_at: S.str({ format: 'date-time' }), reward_points: S.int({ minimum: 0, maximum: 5000 }),
            reward_text: S.nstr({ maxLength: 300 }), partner_id: S.uuid(),
          },
          ['title', 'metric', 'target', 'starts_at', 'ends_at'],
        ),
      },
    },
    async (req) => {
      const b = req.body as any;
      const pid = await myPartner(req, b.partner_id);
      const i18n = (s: string | null) => (s ? JSON.stringify({ uz: s, ru: s, en: s }) : null);
      // Sponsored challenges go live inactive until a moderator approves them in the admin panel.
      return one(
        `insert into challenges (title, description, metric, target, starts_at, ends_at, sponsor_partner_id, reward_points, reward_text, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false) returning id`,
        [i18n(b.title), i18n(b.description ?? '') ?? '{}', b.metric, b.target, b.starts_at, b.ends_at, pid, b.reward_points ?? 0, i18n(b.reward_text ?? null)],
      );
    },
  );
}
