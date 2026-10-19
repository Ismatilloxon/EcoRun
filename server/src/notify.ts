import webpush from 'web-push';
import { config } from './config.ts';
import { one, q } from './db.ts';
import { t } from './i18n.ts';
import { emitToUser } from './realtime.ts';
import { esc, tgSend } from './telegram.ts';

const pushEnabled = Boolean(config.vapid.publicKey && config.vapid.privateKey);
if (pushEnabled) webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);

type Opts = {
  telegram?: boolean;
  push?: boolean;
  tgButtons?: { text: string; url?: string; callback_data?: string }[][];
};

/** Fan-out: in-app (DB + websocket), web push, Telegram. Text is rendered in the recipient's language. */
export async function notify(
  userId: string,
  type: string,
  vars: Record<string, string | number> = {},
  data: Record<string, unknown> = {},
  opts: Opts = {},
) {
  const user = await one('select id, language, telegram_id, deleted_at from users where id = $1', [userId]);
  if (!user || user.deleted_at) return;
  const text = t(user.language, type, vars);
  const row = await one(
    'insert into notifications (user_id, type, title, body, data) values ($1, $2, $3, $4, $5) returning id, created_at',
    [userId, type, text, vars.body ?? null, JSON.stringify(data)],
  );
  emitToUser(userId, { type: 'notification', notification: { id: row?.id, type, title: text, data, created_at: row?.created_at } });

  if (opts.push !== false && pushEnabled) {
    const subs = await q('select id, endpoint, keys from push_subscriptions where user_id = $1', [userId]);
    for (const s of subs) {
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: 'EcoRun', body: text, data }))
        .catch(async (e: any) => {
          if (e?.statusCode === 404 || e?.statusCode === 410) await q('delete from push_subscriptions where id = $1', [s.id]);
        });
    }
  }
  if (opts.telegram !== false && user.telegram_id) {
    await tgSend(user.telegram_id, vars.body ? `<b>${esc(text)}</b>\n${esc(vars.body)}` : esc(text), opts.tgButtons);
  }
}

export async function notifyMany(userIds: string[], type: string, vars: Record<string, string | number>, data = {}, opts: Opts = {}) {
  for (const id of new Set(userIds)) await notify(id, type, vars, data, opts);
}

export const webPushPublicKey = () => (pushEnabled ? config.vapid.publicKey : null);
