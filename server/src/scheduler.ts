import { one, q, tx } from './db.ts';
import { fmtTime } from './i18n.ts';
import { notify } from './notify.ts';
import { award } from './points.ts';
import { extendSeries } from './routes/runs.ts';
import { runCampaign } from './routes/admin.ts';

async function reminders() {
  for (const [kind, from, to] of [
    ['24h', '23 hours 30 minutes', '24 hours 30 minutes'],
    ['1h', '45 minutes', '75 minutes'],
  ] as const) {
    const rows = await q(
      `select p.user_id, r.id as run_id, r.title, r.start_at, coalesce(r.meeting_address, '') as place, u.language
       from participations p join runs r on r.id = p.run_id join users u on u.id = p.user_id
       where p.status = 'joined' and r.status = 'scheduled'
         and r.start_at between now() + interval '${from}' and now() + interval '${to}'
         and not exists (select 1 from run_reminders x where x.run_id = r.id and x.user_id = p.user_id and x.kind = $1)`,
      [kind],
    );
    for (const r of rows) {
      const ins = await one('insert into run_reminders (run_id, user_id, kind) values ($1,$2,$3) on conflict do nothing returning 1', [r.run_id, r.user_id, kind]);
      if (!ins) continue;
      await notify(r.user_id, `reminder_${kind}`, { run: r.title, time: fmtTime(r.start_at, r.language), place: r.place }, { run: r.run_id });
    }
  }
}

async function expireCodes() {
  const expired = await q(`update redemptions set status = 'expired' where status = 'issued' and expires_at < now() returning id, user_id, points_spent`);
  for (const r of expired) {
    await award({ userId: r.user_id, reason: 'redemption_refund', amount: r.points_spent, sourceType: 'redemption', sourceId: r.id, note: 'code_expired' });
  }
}

async function closeRuns() {
  await tx(async (c) => {
    const done = await c.query(`update runs set status = 'completed' where status = 'scheduled' and start_at < now() - interval '6 hours' returning id`);
    if (done.rowCount) {
      await c.query(`update participations set status = 'no_show' where status = 'joined' and run_id = any($1)`, [done.rows.map((r) => r.id)]);
    }
  });
}

async function series() {
  const rows = await q(`select distinct series_id from runs where series_id is not null and recurrence_rule is not null and status <> 'cancelled'`);
  for (const r of rows) await extendSeries(r.series_id);
}

async function campaigns() {
  const due = await q(`select id from push_campaigns where sent_at is null and scheduled_at is not null and scheduled_at <= now()`);
  for (const c of due) await runCampaign(c.id);
}

async function cleanup() {
  await q(`delete from otp_codes where created_at < now() - interval '1 day'`);
  await q(`delete from telegram_tokens where created_at < now() - interval '1 day'`);
  await q(`delete from refresh_tokens where expires_at < now() or (revoked_at is not null and revoked_at < now() - interval '7 days')`);
}

let tick = 0;
export function startScheduler(log: { error: (o: unknown, m?: string) => void }) {
  const safe = (name: string, fn: () => Promise<void>) => fn().catch((e) => log.error(e, `scheduler:${name}`));
  const run = () => {
    tick++;
    safe('reminders', reminders);
    safe('campaigns', campaigns);
    if (tick % 5 === 1) safe('expireCodes', expireCodes);
    if (tick % 15 === 1) safe('closeRuns', closeRuns);
    if (tick % 60 === 1) {
      safe('series', series);
      safe('cleanup', cleanup);
    }
  };
  run();
  return setInterval(run, 60_000);
}
