import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { one, q, tx } from '../db.ts';
import { fail, idParam, S } from '../http.ts';
import { optionalAuth, requireAuth, type AuthUser } from '../auth.ts';
import { pickI18n } from '../i18n.ts';
import { notify } from '../notify.ts';
import { award, balance } from '../points.ts';
import { getSettings } from '../settings.ts';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newCode = (n = 8) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');

const REWARD_FIELDS = `rw.id, rw.title, rw.description, rw.terms, rw.photo_url, rw.category, rw.points_price, rw.stock, rw.valid_until, rw.branches, rw.active,
  json_build_object('id', p.id, 'name', p.name, 'logo_url', p.logo_url) as partner,
  greatest(0, rw.stock - (select count(*) from redemptions x where x.reward_id = rw.id and x.status = 'issued' and x.expires_at > now())) as available`;

export async function partnerIdsFor(user: AuthUser) {
  return (await q('select partner_id from partner_users where user_id = $1', [user.id])).map((r) => r.partner_id as string);
}

/** Validates and consumes a redemption code at a partner (cabinet or Telegram bot). Stock decreases here. */
export async function redeemCode(code: string, user: AuthUser, branch: string | null, dryRun = false) {
  const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const partnerIds = user.role === 'admin' ? null : await partnerIdsFor(user);
  if (partnerIds && !partnerIds.length) fail(403, 'not_partner');
  return tx(async (c) => {
    const r = (
      await c.query(
        `select rd.*, rw.title, rw.partner_id, rw.stock, u.name as user_name from redemptions rd
         join rewards rw on rw.id = rd.reward_id join users u on u.id = rd.user_id
         where rd.code = $1 for update of rd`,
        [clean],
      )
    ).rows[0];
    if (!r || (partnerIds && !partnerIds.includes(r.partner_id))) fail(404, 'code_not_found');
    if (r.status === 'redeemed') fail(409, 'code_already_used', new Date(r.redeemed_at).toISOString());
    if (r.status !== 'issued' || new Date(r.expires_at) < new Date()) fail(410, 'code_expired');
    const info = { code: r.code, title: r.title, user_name: r.user_name, points_spent: r.points_spent, expires_at: r.expires_at };
    if (dryRun) return { valid: true, ...info };
    const stock = await c.query('update rewards set stock = stock - 1 where id = $1 and stock > 0 returning stock', [r.reward_id]);
    if (!stock.rowCount) fail(409, 'out_of_stock');
    await c.query(`update redemptions set status = 'redeemed', redeemed_at = now(), redeemed_by = $2, branch = $3 where id = $1`, [r.id, user.id, branch]);
    notify(r.user_id, 'redemption_done', { title: r.title }, { redemption: r.id }).catch(() => {});
    return { redeemed: true, ...info, stock_left: stock.rows[0].stock };
  });
}

export default async function rewardRoutes(app: FastifyInstance) {
  app.get('/rewards', { preHandler: optionalAuth, schema: { tags: ['rewards'], querystring: S.obj({ category: S.enum(['cafe', 'sport', 'gym', 'eco', 'other']) }) } }, async (req) => {
    const { category } = req.query as any;
    return q(
      `select ${REWARD_FIELDS} from rewards rw join partners p on p.id = rw.partner_id
       where rw.active and p.contract_status = 'active' and (rw.valid_until is null or rw.valid_until >= current_date) and ($1::text is null or rw.category = $1)
       order by rw.points_price`,
      [category ?? null],
    );
  });

  app.get('/rewards/:id', { preHandler: optionalAuth, schema: { tags: ['rewards'], params: idParam } }, async (req) => {
    const r = await one(`select ${REWARD_FIELDS}, p.branches as partner_branches from rewards rw join partners p on p.id = rw.partner_id where rw.id = $1`, [(req.params as any).id]);
    if (!r) fail(404, 'not_found');
    return r;
  });

  app.post('/rewards/:id/claim', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } }, schema: { tags: ['rewards'], params: idParam } }, async (req) => {
    const s = await getSettings();
    const user = req.user!;
    return tx(async (c) => {
      // Serialize claims per user (balance) and per reward (stock).
      await c.query('select id from users where id = $1 for update', [user.id]);
      const rw = (await c.query(`select rw.*, p.contract_status from rewards rw join partners p on p.id = rw.partner_id where rw.id = $1 for update of rw`, [(req.params as any).id])).rows[0];
      if (!rw || !rw.active || rw.contract_status !== 'active') fail(404, 'not_found');
      if (rw.valid_until && new Date(rw.valid_until) < new Date(new Date().toDateString())) fail(410, 'reward_expired');
      const issued = Number((await c.query(`select count(*) as n from redemptions where reward_id = $1 and status = 'issued' and expires_at > now()`, [rw.id])).rows[0].n);
      if (rw.stock - issued <= 0) fail(409, 'out_of_stock');
      const bal = Number((await c.query(`select coalesce(sum(amount), 0) as b from points_transactions where user_id = $1 and status = 'confirmed'`, [user.id])).rows[0].b);
      if (bal < rw.points_price) fail(400, 'not_enough_points');
      let expires = new Date(Date.now() + s.rewards.code_valid_days * 86400_000);
      if (rw.valid_until) {
        const vu = new Date(`${new Date(rw.valid_until).toISOString().slice(0, 10)}T23:59:59+05:00`);
        if (vu < expires) expires = vu;
      }
      let code = newCode();
      for (let i = 0; i < 5 && (await c.query('select 1 from redemptions where code = $1', [code])).rowCount; i++) code = newCode();
      const red = (
        await c.query(
          `insert into redemptions (reward_id, user_id, code, points_spent, expires_at) values ($1,$2,$3,$4,$5) returning id, code, expires_at, status`,
          [rw.id, user.id, code, rw.points_price, expires],
        )
      ).rows[0];
      await award({ userId: user.id, reason: 'redemption', amount: -rw.points_price, sourceType: 'redemption', sourceId: red.id }, c);
      return { ...red, title: rw.title, points_spent: rw.points_price };
    });
  });

  app.get('/me/redemptions', { preHandler: requireAuth, schema: { tags: ['rewards'] } }, async (req) =>
    q(
      `select rd.id, rd.code, rd.status, rd.points_spent, rd.expires_at, rd.redeemed_at, rd.branch, rd.created_at,
              json_build_object('id', rw.id, 'title', rw.title, 'photo_url', rw.photo_url, 'terms', rw.terms, 'partner', p.name, 'branches', rw.branches) as reward
       from redemptions rd join rewards rw on rw.id = rd.reward_id join partners p on p.id = rw.partner_id
       where rd.user_id = $1 order by rd.created_at desc`,
      [req.user!.id],
    ),
  );

  // ---- Challenges ----
  app.get('/challenges', { preHandler: optionalAuth, schema: { tags: ['gamification'] } }, async (req) => {
    const lang = req.user?.language ?? 'uz';
    const { challengeProgress } = await import('../points.ts');
    const rows = await q(
      `select c.*, p.name as sponsor_name, p.logo_url as sponsor_logo,
              (select count(*) from challenge_participants cp where cp.challenge_id = c.id) as participants,
              cp.joined_at, cp.completed_at
       from challenges c left join partners p on p.id = c.sponsor_partner_id
       left join challenge_participants cp on cp.challenge_id = c.id and cp.user_id = $1
       where c.active and c.ends_at > now() - interval '7 days' order by c.ends_at`,
      [req.user?.id ?? null],
    );
    const out = [];
    for (const r of rows) {
      const progress = req.user && r.joined_at ? await challengeProgress(req.user.id, r) : null;
      out.push({ ...r, title: pickI18n(r.title, lang), description: pickI18n(r.description, lang), reward_text: pickI18n(r.reward_text, lang), progress, joined: Boolean(r.joined_at) });
    }
    return out;
  });

  app.post('/challenges/:id/join', { preHandler: requireAuth, schema: { tags: ['gamification'], params: idParam } }, async (req) => {
    const c = await one('select id from challenges where id = $1 and active and ends_at > now()', [(req.params as any).id]);
    if (!c) fail(404, 'not_found');
    await q('insert into challenge_participants (challenge_id, user_id) values ($1, $2) on conflict do nothing', [c!.id, req.user!.id]);
    const { evaluateChallenges } = await import('../points.ts');
    await evaluateChallenges(req.user!.id);
    return { ok: true };
  });

  app.get('/me/balance', { preHandler: requireAuth, schema: { tags: ['rewards'] } }, async (req) => balance(req.user!.id));
}
