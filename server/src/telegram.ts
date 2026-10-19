import { config } from './config.ts';

const api = (method: string) => `https://api.telegram.org/bot${config.telegram.token}/${method}`;

export const telegramEnabled = () => Boolean(config.telegram.token);

export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type InlineButton = { text: string; url?: string; callback_data?: string };

async function call(method: string, body: Record<string, unknown>) {
  if (!telegramEnabled()) return null;
  try {
    const res = await fetch(api(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const json: any = await res.json();
    if (!json.ok) console.warn(`[telegram] ${method} failed:`, json.description);
    return json.result ?? null;
  } catch (e) {
    console.warn(`[telegram] ${method} error:`, (e as Error).message);
    return null;
  }
}

export function tgSend(chatId: number | string, html: string, buttons?: InlineButton[][]) {
  return call('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Photos are served from localhost in dev, which Telegram cannot fetch — send as text link then. */
export function tgSendPhoto(chatId: number | string, photoUrl: string, captionHtml: string, buttons?: InlineButton[][]) {
  const absolute = photoUrl.startsWith('http') ? photoUrl : `${config.publicUrl}${photoUrl}`;
  if (/localhost|127\.0\.0\.1/.test(absolute)) return tgSend(chatId, captionHtml, buttons);
  return call('sendPhoto', {
    chat_id: chatId,
    photo: absolute,
    caption: captionHtml,
    parse_mode: 'HTML',
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Telegram rejects inline URL buttons that point at localhost; only add them for public URLs. */
export function appButton(text: string, path: string): InlineButton[][] | undefined {
  const url = `${config.publicUrl}${path}`;
  if (!url.startsWith('https://')) return undefined;
  return [[{ text, url }]];
}
