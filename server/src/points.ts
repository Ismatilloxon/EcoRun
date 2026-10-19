import { one, q, type Db, pool } from './db.ts';
import { pickI18n } from './i18n.ts';
import { notify } from './notify.ts';
import { getSettings, levelFor } from './settings.ts';

export type Reason =
  | 'run_km'
  | 'commute_km'
  | 'group_attendance'
  | 'plogging_bag'
  | 'dirty_spot'
  | 'organize_run'
  | 'invite'
  | 'challenge'
  | 'redemption'
  | 'redemption_refund'
  | 'donation'
  | 'admin_adjust';

const UNCAPPED: Reason[] = ['redemption', 'redemption_refund', 'donation', 'admin_adjust', 'challenge'];

type AwardInput = {
  userId: string;
  reason: Reason;
  amount: number;
  sourceType?: string;
  sourceId?: string | null;
  status?: 'pending' | 'confirmed';
  note?: string;
};

/** Inserts a points transaction honouring daily/weekly caps. Idempotent per (user, reason, source). */
export async function award(input: AwardInput, db: Db = pool) {
  const s = await getSettings();
  let amount = Math.trunc(input.amount);
  let note = input.note ?? null;
  if (amount > 0 && !UNCAPPED.includes(input.reason)) {
    const r = (
      await db.query(
        `select
           coalesce(sum(amount) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'), 0) as today,
           coalesce(sum(amount) filter (where created_at >= date_trunc('week', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent'), 0) as week
         from points_transactions
         where user_id = $1 and amount > 0 and status <> 'rejected' and reason <> all($2)`,
        [input.userId, UNCAPPED],
      )
    ).rows[0];
    const room = Math.max(0, Math.min(s.caps.daily - Number(r.today), s.caps.weekly - Number(r.week)));
    if (room < amount) {
      note = room === 0 ? 'cap_reached' : `capped_from_${amount}`;
      amount = room;
    }
  }
  const res = await db.query(
    `insert into points_transactions (user_id, amount, reason, source_type, source_id, status, note)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id, reason, source_id) where source_id is not null do nothing
     returning id, amount, status`,
    [input.userId, amount, input.reason, input.sourceType ?? null, input.sourceId ?? null, input.status ?? 'confirmed', note],
  );
  return res.rows[0] ?? null;
}

export async function setPointsStatus(sourceType: string, sourceId: string, status: 'confirmed' | 'rejected', db: Db = pool) {
  await db.query(`update points_transactions set status = $3 where source_type = $1 and source_id = $2 and status = 'pending'`, [
    sourceType,
    sourceId,
    status,
  ]);
}

export async function balance(userId: string) {
  const s = await getSettings();
  const r = await one(
    `select
       coalesce(sum(amount) filter (where status = 'confirmed'), 0) as balance,
       coalesce(sum(amount) filter (where status = 'pending'), 0) as pending,
       coalesce(sum(amount) filter (where status = 'confirmed' and amount > 0 and reason not in ('redemption_refund')), 0) as earned
     from points_transactions where user_id = $1`,
    [userId],
  );
  const earned = Number(r?.earned ?? 0);
  return { balance: Number(r?.balance ?? 0), pending: Number(r?.pending ?? 0), earned, ...levelFor(earned, s.levels) };
}

// ---------- Badges ----------
export const BADGES: { code: string; icon: string; title: Record<string, string>; description: Record<string, string> }[] = [
  { code: 'first_run', icon: 'shoe', title: { uz: 'Birinchi qadam', ru: 'Первый шаг', en: 'First step' }, description: { uz: 'Birinchi yugurish', ru: 'Первая пробежка', en: 'First tracked run' } },
  { code: 'km_50', icon: 'road', title: { uz: '50 km', ru: '50 км', en: '50 km' }, description: { uz: 'Jami 50 km', ru: 'Всего 50 км', en: '50 km in total' } },
  { code: 'km_100', icon: 'road', title: { uz: '100 km', ru: '100 км', en: '100 km' }, description: { uz: 'Jami 100 km', ru: 'Всего 100 км', en: '100 km in total' } },
  { code: 'km_500', icon: 'trophy', title: { uz: '500 km', ru: '500 км', en: '500 km' }, description: { uz: 'Jami 500 km', ru: 'Всего 500 км', en: '500 km in total' } },
  { code: 'first_group_run', icon: 'people', title: { uz: 'Jamoa', ru: 'В компании', en: 'Team player' }, description: { uz: 'Birinchi guruh yugurishi', ru: 'Первая групповая пробежка', en: 'First group run' } },
  { code: 'group_runs_10', icon: 'people', title: { uz: '10 ta guruh', ru: '10 групповых', en: '10 group runs' }, description: { uz: '10 ta guruh yugurishi', ru: '10 групповых пробежек', en: '10 group runs attended' } },
  { code: 'first_plogging', icon: 'leaf', title: { uz: 'Plogger', ru: 'Плоггер', en: 'Plogger' }, description: { uz: 'Birinchi plogging', ru: 'Первый плоггинг', en: 'First plogging action' } },
  { code: 'bags_10', icon: 'bag', title: { uz: '10 qop', ru: '10 мешков', en: '10 bags' }, description: { uz: '10 qop chiqindi yig‘ildi', ru: 'Собрано 10 мешков', en: '10 bags collected' } },
  { code: 'organizer', icon: 'flag', title: { uz: 'Tashkilotchi', ru: 'Организатор', en: 'Organizer' }, description: { uz: '5+ kishilik yugurish', ru: 'Пробежка на 5+ человек', en: 'Ran a group of 5+' } },
  { code: 'spotter', icon: 'pin', title: { uz: 'Kuzatuvchi', ru: 'Наблюдатель', en: 'Spotter' }, description: { uz: 'Iflos joy tasdiqlandi', ru: 'Подтверждённое грязное место', en: 'Approved dirty spot' } },
  { code: 'commuter', icon: 'bolt', title: { uz: 'Mashinasiz', ru: 'Без машины', en: 'Car-free' }, description: { uz: '50 km yugurib borish', ru: '50 км пробежек вместо авто', en: '50 km of commute runs' } },
];

export async function checkBadges(userId: string) {
  const st = await one(
    `select
       (select count(*) from activities where user_id = $1 and not flagged) as runs,
       (select coalesce(sum(distance_m), 0) / 1000.0 from activities where user_id = $1 and not flagged) as km,
       (select coalesce(sum(distance_m), 0) / 1000.0 from activities where user_id = $1 and not flagged and is_commute) as commute_km,
       (select count(*) from participations where user_id = $1 and status = 'checked_in') as group_runs,
       (select count(*) from eco_actions where user_id = $1 and status = 'approved') as eco,
       (select coalesce(sum(bags_small + bags_large), 0) from eco_actions where user_id = $1 and status = 'approved') as bags,
       (select count(*) from runs where organizer_id = $1 and organizer_rewarded) as organized,
       (select count(*) from dirty_spots where reporter_id = $1 and status in ('approved','scheduled','cleaned')) as spots`,
    [userId],
  );
  if (!st) return;
  const earned: string[] = [];
  if (st.runs >= 1) earned.push('first_run');
  if (st.km >= 50) earned.push('km_50');
  if (st.km >= 100) earned.push('km_100');
  if (st.km >= 500) earned.push('km_500');
  if (st.group_runs >= 1) earned.push('first_group_run');
  if (st.group_runs >= 10) earned.push('group_runs_10');
  if (st.eco >= 1) earned.push('first_plogging');
  if (st.bags >= 10) earned.push('bags_10');
  if (st.organized >= 1) earned.push('organizer');
  if (st.spots >= 1) earned.push('spotter');
  if (st.commute_km >= 50) earned.push('commuter');
  for (const code of earned) await grantBadge(userId, code);
}

export async function grantBadge(userId: string, code: string) {
  const r = await one(
    'insert into user_badges (user_id, badge_code) values ($1, $2) on conflict do nothing returning badge_code',
    [userId, code],
  );
  if (!r) return;
  const b = await one('select title from badges where code = $1', [code]);
  const u = await one('select language from users where id = $1', [userId]);
  await notify(userId, 'badge_awarded', { title: pickI18n(b?.title, u?.language ?? 'uz') }, { badge: code }, { telegram: false });
}

// ---------- Challenges ----------
export async function challengeProgress(userId: string, c: { metric: string; starts_at: string | Date; ends_at: string | Date }) {
  const args = [userId, c.starts_at, c.ends_at];
  let sql = '';
  switch (c.metric) {
    case 'km':
      sql = `select coalesce(sum(distance_m), 0) / 1000.0 as v from activities where user_id = $1 and not flagged and started_at between $2 and $3`;
      break;
    case 'runs':
      sql = `select count(*) as v from activities where user_id = $1 and not flagged and started_at between $2 and $3`;
      break;
    case 'group_runs':
      sql = `select count(*) as v from participations where user_id = $1 and status = 'checked_in' and check_in_at between $2 and $3`;
      break;
    case 'plogging_runs':
      sql = `select count(*) as v from eco_actions where user_id = $1 and status = 'approved' and created_at between $2 and $3`;
      break;
    case 'eco_points':
      sql = `select coalesce(sum(amount), 0) as v from points_transactions where user_id = $1 and status = 'confirmed' and amount > 0 and reason not in ('challenge','redemption_refund') and created_at between $2 and $3`;
      break;
    default:
      return 0;
  }
  const r = await one(sql, args);
  return Math.round(Number(r?.v ?? 0) * 10) / 10;
}

export async function evaluateChallenges(userId: string) {
  const list = await q(
    `select c.* from challenges c join challenge_participants cp on cp.challenge_id = c.id
     where cp.user_id = $1 and cp.completed_at is null and c.active and now() between c.starts_at and c.ends_at + interval '1 day'`,
    [userId],
  );
  const u = await one('select language from users where id = $1', [userId]);
  for (const c of list) {
    const p = await challengeProgress(userId, c);
    if (p < Number(c.target)) continue;
    const done = await one(
      'update challenge_participants set completed_at = now() where challenge_id = $1 and user_id = $2 and completed_at is null returning 1',
      [c.id, userId],
    );
    if (!done) continue;
    if (c.reward_points > 0) await award({ userId, reason: 'challenge', amount: c.reward_points, sourceType: 'challenge', sourceId: c.id });
    if (c.badge_code) await grantBadge(userId, c.badge_code);
    await notify(userId, 'challenge_completed', { title: pickI18n(c.title, u?.language ?? 'uz'), points: c.reward_points }, { challenge: c.id });
  }
}

/** Run after any event that can change stats. */
export async function afterProgress(userId: string) {
  await checkBadges(userId).catch((e) => console.error('badges', e));
  await evaluateChallenges(userId).catch((e) => console.error('challenges', e));
}

/** Invite reward: inviter gets points once the invitee completes a first valid run or check-in. */
export async function maybeRewardInviter(userId: string) {
  const u = await one('select invited_by, invite_rewarded from users where id = $1', [userId]);
  if (!u?.invited_by || u.invite_rewarded) return;
  const s = await getSettings();
  const claimed = await one('update users set invite_rewarded = true where id = $1 and not invite_rewarded returning 1', [userId]);
  if (!claimed) return;
  const tx = await award({ userId: u.invited_by, reason: 'invite', amount: s.points.invite, sourceType: 'user', sourceId: userId });
  if (tx) await notify(u.invited_by, 'invite_reward', { points: tx.amount }, { user: userId });
}
