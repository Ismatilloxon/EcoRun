import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, GrammyError, InlineKeyboard, Keyboard, type Context } from 'grammy';
import { ERR, t, type Key, type Lang } from './i18n.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const SECRET = process.env.BOT_INTERNAL_SECRET?.trim() ?? '';
const API = (process.env.BOT_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`).replace(/\/$/, '') + '/api/v1/internal/bot';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, '');

if (!TOKEN) {
  console.log('[bot] TELEGRAM_BOT_TOKEN is empty — bot not started. Create a bot with @BotFather and put the token into .env');
  process.exit(0);
}

type Tg = { id: number; username?: string; first_name?: string; last_name?: string; language_code?: string };
class ApiErr extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function call<T = any>(route: string, from: Tg, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${API}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-secret': SECRET },
    body: JSON.stringify({
      tg: { id: from.id, username: from.username ?? null, first_name: from.first_name ?? null, last_name: from.last_name ?? null, language_code: from.language_code ?? null },
      ...body,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiErr(res.status, json.error ?? 'error');
  return json as T;
}

// Per-chat state: language cache and what the next location / text message is for.
const langCache = new Map<number, Lang>();
const pending = new Map<number, 'nearby' | 'checkin' | 'redeem'>();
const pendingLogin = new Map<number, string>();
const fallbackLang = (code?: string): Lang => (code?.startsWith('ru') ? 'ru' : code?.startsWith('en') ? 'en' : 'uz');

async function langOf(ctx: Context): Promise<Lang> {
  const id = ctx.from!.id;
  if (langCache.has(id)) return langCache.get(id)!;
  try {
    const u = await call('user', ctx.from!);
    langCache.set(id, u.language);
    return u.language;
  } catch {
    return fallbackLang(ctx.from?.language_code);
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const appUrl = (p: string) => `${PUBLIC_URL}${p}`;
const canLink = PUBLIC_URL.startsWith('https://');

function menu(lang: Lang, partner = false) {
  const kb = new Keyboard()
    .requestLocation(t(lang, 'btn_nearby')).text(t(lang, 'btn_myruns')).row()
    .text(t(lang, 'btn_checkin')).text(t(lang, 'btn_points')).row();
  if (partner) kb.text(t(lang, 'btn_redeem')).row();
  kb.requestContact(t(lang, 'btn_phone')).text(t(lang, 'btn_lang'));
  return kb.resized();
}

const UZ_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
function fmtWhen(iso: string, lang: Lang) {
  const d = new Date(iso);
  if (lang === 'uz') {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tashkent', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.day}-${UZ_MONTHS[Number(p.month) - 1]}, ${p.hour}:${p.minute}`;
  }
  return d.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: 'Asia/Tashkent', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function reportError(ctx: Context, e: unknown) {
  const lang = await langOf(ctx);
  if (e instanceof ApiErr) {
    if (e.code === 'not_linked') return ctx.reply(t(lang, 'not_linked'), { parse_mode: 'HTML' });
    if (e.code === 'not_partner') return ctx.reply(t(lang, 'not_partner'));
    if (e.code === 'token_expired') return ctx.reply(t(lang, 'token_expired'));
    return ctx.reply(ERR[e.code]?.[lang] ?? t(lang, 'error', { code: e.code }));
  }
  console.error('[bot]', e);
  return ctx.reply(t(lang, 'error', { code: 'network' }));
}

const bot = new Bot(TOKEN);

bot.command('start', async (ctx) => {
  const payload = ctx.match?.trim() ?? '';
  const lang = await langOf(ctx);
  try {
    if (payload.startsWith('login_')) {
      return ctx.reply(t(lang, 'login_ask'), { reply_markup: new InlineKeyboard().text(t(lang, 'btn_login_confirm'), `login:${payload.slice(6)}`) });
    }
    if (payload.startsWith('link_')) {
      const r = await call('link', ctx.from!, { token: payload.slice(5) });
      langCache.set(ctx.from!.id, r.language);
      return ctx.reply(t(r.language, 'link_ok', { name: esc(r.name ?? '') }), { reply_markup: menu(r.language) });
    }
    const u = await call('user', ctx.from!);
    await ctx.reply(t(lang, 'welcome'), { parse_mode: 'HTML', reply_markup: menu(lang, Boolean(u.partner) || u.user?.role === 'admin') });
    if (!u.linked) await ctx.reply(t(lang, 'not_linked'), { parse_mode: 'HTML' });
  } catch (e) {
    await reportError(ctx, e);
  }
});

bot.command('help', async (ctx) => ctx.reply(t(await langOf(ctx), 'help')));

bot.callbackQuery(/^login:(.+)$/, async (ctx) => {
  const token = ctx.match[1];
  try {
    const lang = await langOf(ctx);
    pendingLogin.set(ctx.from.id, token);
    await ctx.answerCallbackQuery();
    // Remove the inline confirmation prompt before showing the one-time
    // contact keyboard, otherwise Telegram displays the instruction twice.
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(t(lang, 'login_phone_ask'), {
      reply_markup: new Keyboard().requestContact(t(lang, 'btn_phone')).resized().oneTime(),
    });
  } catch (e) {
    await ctx.answerCallbackQuery();
    await reportError(ctx, e);
  }
});

// ---- Nearby runs ----
const askLocation = async (ctx: Context, kind: 'nearby' | 'checkin') => {
  const lang = await langOf(ctx);
  pending.set(ctx.chat!.id, kind);
  await ctx.reply(t(lang, kind === 'nearby' ? 'send_location' : 'send_location_checkin'), {
    reply_markup: new Keyboard().requestLocation(t(lang, 'share_location')).resized().oneTime(),
  });
};
bot.command('runs', (ctx) => askLocation(ctx, 'nearby'));
bot.command('checkin', (ctx) => askLocation(ctx, 'checkin'));

bot.on('message:location', async (ctx) => {
  const lang = await langOf(ctx);
  const kind = pending.get(ctx.chat.id) ?? 'nearby';
  pending.delete(ctx.chat.id);
  const { latitude: lat, longitude: lng } = ctx.message.location;
  try {
    if (kind === 'checkin') {
      const r = await call('checkin', ctx.from, { lat, lng });
      const key: Key = r.status === 'ok' ? 'checkin_ok' : r.status === 'already' ? 'checkin_already' : r.status === 'too_far' ? 'checkin_far' : 'checkin_none';
      return ctx.reply(t(lang, key, { title: r.title ?? '', points: r.points ?? 0, distance: r.distance ?? 0, radius: r.radius ?? 0 }), { reply_markup: menu(lang) });
    }
    const runs: any[] = await call('nearby', ctx.from, { lat, lng });
    if (!runs.length) return ctx.reply(t(lang, 'no_runs'), { reply_markup: menu(lang) });
    await ctx.reply(t(lang, 'runs_found'), { reply_markup: menu(lang) });
    for (const r of runs) {
      const kb = new InlineKeyboard();
      if (!r.my_status || ['left', 'rejected'].includes(r.my_status)) kb.text(t(lang, 'btn_join'), `join:${r.id}`);
      if (canLink) kb.url(t(lang, 'btn_open'), appUrl(`/runs/${r.id}`));
      const lines = [
        `<b>${esc(r.title)}</b>`,
        `${fmtWhen(r.start_at, lang)} · ${(r.distance_m / 1000).toFixed(1)} km`,
        [r.distance_km && `${r.distance_km} km`, r.pace_groups?.join(', '), r.meeting_address].filter(Boolean).map(esc).join(' · '),
        t(lang, 'going', { n: `${r.participants_count}${r.capacity ? `/${r.capacity}` : ''}` }),
      ];
      if (r.my_status) lines.push(t(lang, `status_${r.my_status}` as Key) ?? r.my_status);
      await ctx.reply(lines.filter(Boolean).join('\n'), { parse_mode: 'HTML', reply_markup: kb.inline_keyboard.length && kb.inline_keyboard[0].length ? kb : undefined });
    }
  } catch (e) {
    await reportError(ctx, e);
  }
});

bot.callbackQuery(/^join:([0-9a-f-]{36})$/, async (ctx) => {
  const lang = await langOf(ctx);
  try {
    const r = await call('join', ctx.from, { runId: ctx.match[1] });
    await ctx.answerCallbackQuery({ text: t(lang, 'joined', { status: t(lang, `status_${r.status}` as Key) }) });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(t(lang, 'joined', { status: t(lang, `status_${r.status}` as Key) }));
  } catch (e) {
    await ctx.answerCallbackQuery();
    await reportError(ctx, e);
  }
});

// ---- My runs / points ----
async function myRuns(ctx: Context) {
  const lang = await langOf(ctx);
  try {
    const runs: any[] = await call('myruns', ctx.from!);
    if (!runs.length) return ctx.reply(t(lang, 'myruns_empty'));
    const text = runs.map((r) => `<b>${esc(r.title)}</b>\n${fmtWhen(r.start_at, lang)} · ${esc(r.meeting_address ?? '')}\n${t(lang, `status_${r.my_status ?? 'joined'}` as Key)}`).join('\n\n');
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (e) {
    await reportError(ctx, e);
  }
}
async function points(ctx: Context) {
  const lang = await langOf(ctx);
  try {
    const p = await call('points', ctx.from!);
    const i = p.stats.impact;
    await ctx.reply(t(lang, 'points', { balance: p.balance, pending: p.pending, level: p.level, km: i.km, kg: i.kgWaste, co2: i.co2Kg, trees: i.trees }), { parse_mode: 'HTML' });
  } catch (e) {
    await reportError(ctx, e);
  }
}
bot.command('my', myRuns);
bot.command('points', points);

// ---- Partner: redeem codes ----
async function startRedeem(ctx: Context) {
  pending.set(ctx.chat!.id, 'redeem');
  await ctx.reply(t(await langOf(ctx), 'redeem_ask'));
}
bot.command('redeem', async (ctx) => {
  const code = ctx.match?.trim();
  if (code) return checkCode(ctx, code);
  return startRedeem(ctx);
});
async function checkCode(ctx: Context, raw: string) {
  const lang = await langOf(ctx);
  const code = raw.toUpperCase().replace(/^ECORUN:REWARD:/, '').replace(/[^A-Z0-9]/g, '');
  try {
    const r = await call('redeem', ctx.from!, { code });
    await ctx.reply(t(lang, 'redeem_valid', { title: esc(r.title), user: esc(r.user_name), points: r.points_spent }), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text(t(lang, 'btn_confirm'), `redeem:${code}`),
    });
  } catch (e) {
    await reportError(ctx, e);
  }
}
bot.callbackQuery(/^redeem:([A-Z0-9]{6,12})$/, async (ctx) => {
  const lang = await langOf(ctx);
  try {
    const r = await call('redeem', ctx.from, { code: ctx.match[1], confirm: true, branch: 'Telegram' });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, 'redeem_done', { title: r.title, stock: r.stock_left }));
  } catch (e) {
    await ctx.answerCallbackQuery();
    await reportError(ctx, e);
  }
});

// ---- Organizer confirms group plogging ----
bot.callbackQuery(/^eco:(ok|no):([0-9a-f-]{36})$/, async (ctx) => {
  const lang = await langOf(ctx);
  try {
    await call('eco-review', ctx.from, { id: ctx.match[2], approve: ctx.match[1] === 'ok' });
    await ctx.answerCallbackQuery({ text: t(lang, ctx.match[1] === 'ok' ? 'eco_ok' : 'eco_no') });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  } catch (e) {
    await ctx.answerCallbackQuery();
    await reportError(ctx, e);
  }
});

// ---- Phone (verified by Telegram: own contact only) ----
bot.on('message:contact', async (ctx) => {
  const lang = await langOf(ctx);
  const c = ctx.message.contact;
  if (c.user_id !== ctx.from.id) return ctx.reply(t(lang, 'phone_not_own'));
  try {
    const loginToken = pendingLogin.get(ctx.from.id);
    if (loginToken) {
      pendingLogin.delete(ctx.from.id);
      const r = await call('login-phone', ctx.from, { token: loginToken, phone: c.phone_number });
      langCache.set(ctx.from.id, r.language);
      return ctx.reply(t(r.language, 'login_ok'), { reply_markup: menu(r.language) });
    }
    await call('contact', ctx.from, { phone: c.phone_number });
    langCache.delete(ctx.from.id);
    await ctx.reply(t(lang, 'phone_ok'), { reply_markup: menu(lang) });
  } catch (e) {
    await reportError(ctx, e);
  }
});

// ---- Language ----
const langKb = new InlineKeyboard().text('O‘zbekcha', 'lang:uz').text('Русский', 'lang:ru').text('English', 'lang:en');
bot.command('lang', async (ctx) => ctx.reply(t(await langOf(ctx), 'lang_pick'), { reply_markup: langKb }));
bot.callbackQuery(/^lang:(uz|ru|en)$/, async (ctx) => {
  const lang = ctx.match[1] as Lang;
  langCache.set(ctx.from.id, lang);
  await call('lang', ctx.from, { lang }).catch(() => {});
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t(lang, 'lang_set'));
  const u = await call('user', ctx.from).catch(() => null);
  await ctx.reply(t(lang, 'welcome'), { parse_mode: 'HTML', reply_markup: menu(lang, Boolean(u?.partner)) });
});

// ---- Menu buttons (any language) ----
const label = (key: Key) => [t('uz', key), t('ru', key), t('en', key)];
bot.hears(label('btn_myruns'), myRuns);
bot.hears(label('btn_points'), points);
bot.hears(label('btn_checkin'), (ctx) => askLocation(ctx, 'checkin'));
bot.hears(label('btn_redeem'), startRedeem);
bot.hears(label('btn_lang'), async (ctx) => ctx.reply(t(await langOf(ctx), 'lang_pick'), { reply_markup: langKb }));

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (pending.get(ctx.chat.id) === 'redeem' || /^(ECORUN:REWARD:)?[A-Z0-9]{8}$/i.test(text)) {
    pending.delete(ctx.chat.id);
    return checkCode(ctx, text);
  }
  const lang = await langOf(ctx);
  await ctx.reply(t(lang, 'help'));
});

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error('[bot] telegram error:', e.description);
  else console.error('[bot] error:', e);
});

await bot.api.setMyCommands([
  { command: 'runs', description: 'Runs nearby / Пробежки рядом' },
  { command: 'my', description: 'My runs / Мои пробежки' },
  { command: 'points', description: 'Eco-points / Эко-баллы' },
  { command: 'checkin', description: 'Check in / Отметиться' },
  { command: 'redeem', description: 'Redeem code (partners)' },
  { command: 'lang', description: 'Language / Til / Язык' },
]).catch((e) => console.warn('[bot] setMyCommands failed:', e.message));

const me = await bot.api.getMe();
console.log(`[bot] @${me.username} running (long polling). API: ${API}`);
bot.start({ drop_pending_updates: true });
