export type Lang = 'uz' | 'ru' | 'en';

const T: Record<string, Record<Lang, string>> = {
  join_request: {
    uz: '{name} «{run}» yugurishiga qo‘shilmoqchi',
    ru: '{name} хочет присоединиться к пробежке «{run}»',
    en: '{name} wants to join “{run}”',
  },
  run_joined: { uz: '{name} «{run}» yugurishiga qo‘shildi', ru: '{name} присоединился к «{run}»', en: '{name} joined “{run}”' },
  join_approved: { uz: '«{run}» yugurishiga qabul qilindingiz', ru: 'Вас приняли на пробежку «{run}»', en: 'You’re in for “{run}”' },
  join_rejected: { uz: '«{run}» tashkilotchisi so‘rovni rad etdi', ru: 'Организатор «{run}» отклонил заявку', en: 'The organizer of “{run}” declined your request' },
  waitlist_promoted: { uz: 'Joy bo‘shadi — siz «{run}» ro‘yxatidasiz', ru: 'Место освободилось — вы в списке «{run}»', en: 'A spot opened up — you’re in for “{run}”' },
  reminder_24h: { uz: 'Ertaga: «{run}», {time}', ru: 'Завтра: «{run}», {time}', en: 'Tomorrow: “{run}” at {time}' },
  reminder_1h: { uz: '1 soatdan so‘ng: «{run}». Uchrashuv: {place}', ru: 'Через час: «{run}». Встреча: {place}', en: 'In 1 hour: “{run}”. Meet at {place}' },
  run_cancelled: { uz: '«{run}» bekor qilindi', ru: 'Пробежка «{run}» отменена', en: '“{run}” was cancelled' },
  run_announcement: { uz: '«{run}»: {text}', ru: '«{run}»: {text}', en: '“{run}”: {text}' },
  chat_message: { uz: '{name} · {run}', ru: '{name} · {run}', en: '{name} · {run}' },
  new_run_nearby: { uz: 'Yaqin atrofda yangi yugurish: «{run}», {time}', ru: 'Рядом новая пробежка: «{run}», {time}', en: 'New run nearby: “{run}”, {time}' },
  eco_approved: { uz: 'Plogging tasdiqlandi: +{points} eko-ball', ru: 'Плоггинг подтверждён: +{points} эко-баллов', en: 'Plogging approved: +{points} eco-points' },
  eco_rejected: { uz: 'Plogging rad etildi: {reason}', ru: 'Плоггинг отклонён: {reason}', en: 'Plogging rejected: {reason}' },
  eco_review_request: {
    uz: '{name} «{run}» uchun plogging yubordi: {bags} qop',
    ru: '{name} отправил плоггинг по «{run}»: {bags} меш.',
    en: '{name} submitted plogging for “{run}”: {bags} bags',
  },
  dirty_spot_approved: { uz: 'Iflos joy haqidagi xabaringiz tasdiqlandi: +{points}', ru: 'Ваша метка грязного места подтверждена: +{points}', en: 'Your dirty-spot report was approved: +{points}' },
  checked_in: { uz: 'Check-in tasdiqlandi: +{points} eko-ball', ru: 'Отметка подтверждена: +{points} эко-баллов', en: 'Checked in: +{points} eco-points' },
  organizer_reward: { uz: 'Siz tashkil qilgan yugurishga {count} kishi keldi: +{points}', ru: 'На вашу пробежку пришли {count} человек: +{points}', en: '{count} runners checked in to your run: +{points}' },
  invite_reward: { uz: 'Do‘stingiz birinchi yugurishini yakunladi: +{points}', ru: 'Ваш друг завершил первую пробежку: +{points}', en: 'Your friend finished their first run: +{points}' },
  challenge_completed: { uz: 'Musobaqa bajarildi: «{title}» +{points}', ru: 'Челлендж выполнен: «{title}» +{points}', en: 'Challenge complete: “{title}” +{points}' },
  badge_awarded: { uz: 'Yangi nishon: {title}', ru: 'Новый значок: {title}', en: 'New badge: {title}' },
  new_reward: { uz: 'Yangi sovg‘a: {title} — {points} ball', ru: 'Новая награда: {title} — {points} баллов', en: 'New reward: {title} — {points} points' },
  redemption_done: { uz: '«{title}» kodi ishlatildi. Rahmat!', ru: 'Код «{title}» использован. Спасибо!', en: 'Code for “{title}” redeemed. Thank you!' },
  new_follower: { uz: '{name} sizga obuna bo‘ldi', ru: '{name} подписался на вас', en: '{name} started following you' },
  otp: { uz: 'EcoRun kirish kodi: {code}. Hech kimga bermang.', ru: 'Код входа EcoRun: {code}. Никому не сообщайте.', en: 'EcoRun login code: {code}. Do not share it.' },
  dm: { uz: '{name}: {text}', ru: '{name}: {text}', en: '{name}: {text}' },
  campaign: { uz: '{title}', ru: '{title}', en: '{title}' },
};

export function t(lang: string | null | undefined, key: string, vars: Record<string, string | number> = {}) {
  const l = (['uz', 'ru', 'en'].includes(lang ?? '') ? lang : 'uz') as Lang;
  const tpl = T[key]?.[l] ?? key;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function fmtTime(d: Date | string, lang: string | null | undefined) {
  const locale = lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'uz-UZ';
  return new Date(d).toLocaleString(locale, {
    timeZone: 'Asia/Tashkent',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const pickI18n = (obj: any, lang: string) => (obj && typeof obj === 'object' ? obj[lang] ?? obj.en ?? obj.uz ?? obj.ru ?? '' : obj ?? '');
