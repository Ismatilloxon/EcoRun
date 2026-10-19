export type Lang = 'uz' | 'ru' | 'en';

const T = {
  welcome: {
    uz: '<b>EcoRun</b> — Toshkentda birga yuguring va shaharni toza saqlang.\n\nQuyidagi tugmalardan foydalaning yoki ilovani oching.',
    ru: '<b>EcoRun</b> — бегайте вместе и делайте Ташкент чище.\n\nПользуйтесь кнопками ниже или откройте приложение.',
    en: '<b>EcoRun</b> — run together and keep Tashkent clean.\n\nUse the buttons below or open the app.',
  },
  btn_nearby: { uz: 'Yaqin yugurishlar', ru: 'Пробежки рядом', en: 'Runs nearby' },
  btn_myruns: { uz: 'Mening yugurishlarim', ru: 'Мои пробежки', en: 'My runs' },
  btn_points: { uz: 'Eko-ballarim', ru: 'Мои эко-баллы', en: 'My eco-points' },
  btn_checkin: { uz: 'Check-in', ru: 'Отметиться', en: 'Check in' },
  btn_redeem: { uz: 'Kodni ishlatish', ru: 'Погасить код', en: 'Redeem code' },
  btn_lang: { uz: 'Til', ru: 'Язык', en: 'Language' },
  btn_phone: { uz: 'Telefonni ulash', ru: 'Привязать телефон', en: 'Link phone' },
  btn_join: { uz: 'Qo‘shilish', ru: 'Записаться', en: 'Join' },
  btn_confirm: { uz: 'Tasdiqlash', ru: 'Подтвердить', en: 'Confirm' },
  btn_open: { uz: 'Ilovada ochish', ru: 'Открыть в приложении', en: 'Open in app' },
  btn_login_confirm: { uz: 'Ha, kirishni tasdiqlayman', ru: 'Да, подтверждаю вход', en: 'Yes, confirm login' },
  send_location: { uz: 'Joylashuvingizni yuboring — yaqin yugurishlarni topaman.', ru: 'Отправьте геолокацию — найду пробежки рядом.', en: 'Send your location and I’ll find runs nearby.' },
  send_location_checkin: { uz: 'Uchrashuv joyida turib joylashuvingizni yuboring.', ru: 'Отправьте геолокацию, находясь на месте встречи.', en: 'Send your location while at the meeting point.' },
  share_location: { uz: 'Joylashuvni yuborish', ru: 'Отправить геолокацию', en: 'Share location' },
  no_runs: { uz: '15 km ichida yaqin 7 kunda yugurish topilmadi.', ru: 'В радиусе 15 км на ближайшие 7 дней пробежек нет.', en: 'No runs within 15 km in the next 7 days.' },
  going: { uz: '{n} kishi boradi', ru: 'Идут: {n}', en: '{n} going' },
  runs_found: { uz: 'Yaqin yugurishlar:', ru: 'Пробежки рядом:', en: 'Runs nearby:' },
  not_linked: {
    uz: 'Telegram hali EcoRun akkauntiga ulanmagan. Ilovada <b>Sozlamalar → Telegram → Ulash</b> ni bosing yoki telefoningizni ulang.',
    ru: 'Telegram ещё не привязан к аккаунту EcoRun. В приложении нажмите <b>Настройки → Telegram → Подключить</b> или привяжите телефон.',
    en: 'This Telegram isn’t linked to an EcoRun account yet. In the app tap <b>Settings → Telegram → Connect</b>, or link your phone.',
  },
  login_ask: { uz: 'EcoRun ilovasiga kirishni tasdiqlaysizmi?', ru: 'Подтвердить вход в приложение EcoRun?', en: 'Confirm signing in to the EcoRun app?' },
  login_phone_ask: { uz: 'Kirishni yakunlash uchun quyidagi tugma orqali telefon raqamingizni yuboring.', ru: 'Чтобы завершить вход, отправьте номер телефона кнопкой ниже.', en: 'To finish signing in, share your phone number with the button below.' },
  login_ok: { uz: 'Kirish tasdiqlandi. Ilovaga qayting.', ru: 'Вход подтверждён. Вернитесь в приложение.', en: 'Login confirmed. Go back to the app.' },
  link_ok: { uz: 'Telegram akkauntingizga ulandi, {name}. Endi bildirishnomalar shu yerga keladi.', ru: 'Telegram привязан к аккаунту {name}. Уведомления будут приходить сюда.', en: 'Telegram linked to {name}. Notifications will arrive here.' },
  token_expired: { uz: 'Havola eskirgan. Ilovada qayta urinib ko‘ring.', ru: 'Ссылка устарела. Попробуйте снова в приложении.', en: 'This link has expired. Try again in the app.' },
  joined: { uz: 'Siz yozildingiz: {status}', ru: 'Вы записаны: {status}', en: 'You’re in: {status}' },
  status_joined: { uz: 'boraman', ru: 'иду', en: 'going' },
  status_waitlist: { uz: 'navbatdasiz', ru: 'в листе ожидания', en: 'waitlisted' },
  status_pending: { uz: 'so‘rov tashkilotchiga yuborildi', ru: 'заявка отправлена организатору', en: 'request sent to organizer' },
  status_checked_in: { uz: 'check-in qilingan', ru: 'отмечены', en: 'checked in' },
  myruns_empty: { uz: 'Rejalashtirilgan yugurishlar yo‘q.', ru: 'Запланированных пробежек нет.', en: 'No upcoming runs.' },
  points: {
    uz: '<b>Eko-ball:</b> {balance} (+{pending} tekshiruvda)\n<b>Daraja:</b> {level}\n\n<b>Hissangiz</b>\n{km} km · {kg} kg axlat · {co2} kg CO₂ · {trees} daraxt/yil',
    ru: '<b>Эко-баллы:</b> {balance} (+{pending} на проверке)\n<b>Уровень:</b> {level}\n\n<b>Ваш вклад</b>\n{km} км · {kg} кг мусора · {co2} кг CO₂ · {trees} дерев./год',
    en: '<b>Eco-points:</b> {balance} (+{pending} pending)\n<b>Level:</b> {level}\n\n<b>Your impact</b>\n{km} km · {kg} kg litter · {co2} kg CO₂ · {trees} trees/yr',
  },
  checkin_ok: { uz: '«{title}» — check-in tasdiqlandi: +{points} eko-ball', ru: '«{title}» — отметка подтверждена: +{points} эко-баллов', en: '“{title}” — checked in: +{points} eco-points' },
  checkin_already: { uz: '«{title}» — siz allaqachon check-in qilgansiz.', ru: '«{title}» — вы уже отмечены.', en: '“{title}” — you’re already checked in.' },
  checkin_far: { uz: '«{title}» uchrashuv joyidan {distance} m uzoqdasiz (kerak: {radius} m).', ru: 'До места встречи «{title}» {distance} м (нужно ≤ {radius} м).', en: 'You’re {distance} m from “{title}” (need ≤ {radius} m).' },
  checkin_none: { uz: 'Hozir check-in ochiq bo‘lgan yugurishingiz yo‘q.', ru: 'Сейчас нет пробежек с открытой отметкой.', en: 'You have no run with check-in open right now.' },
  redeem_ask: { uz: 'Mijoz ko‘rsatgan 8 belgili kodni yuboring.', ru: 'Отправьте 8-значный код клиента.', en: 'Send the customer’s 8-character code.' },
  redeem_valid: { uz: '<b>Kod yaroqli</b>\n{title}\nYuguruvchi: {user}\n{points} ball', ru: '<b>Код действителен</b>\n{title}\nБегун: {user}\n{points} баллов', en: '<b>Valid code</b>\n{title}\nRunner: {user}\n{points} points' },
  redeem_done: { uz: 'Ishlatildi: {title}. Qoldiq: {stock}', ru: 'Погашено: {title}. Остаток: {stock}', en: 'Redeemed: {title}. Stock left: {stock}' },
  not_partner: { uz: 'Bu funksiya faqat hamkorlar uchun.', ru: 'Функция доступна только партнёрам.', en: 'This is for partner staff only.' },
  eco_ok: { uz: 'Tasdiqlandi.', ru: 'Подтверждено.', en: 'Approved.' },
  eco_no: { uz: 'Rad etildi.', ru: 'Отклонено.', en: 'Rejected.' },
  phone_ask: { uz: 'Telefon raqamingizni ulash uchun pastdagi tugmani bosing.', ru: 'Нажмите кнопку ниже, чтобы привязать номер телефона.', en: 'Tap the button below to link your phone number.' },
  phone_ok: { uz: 'Telefon ulandi.', ru: 'Телефон привязан.', en: 'Phone linked.' },
  phone_not_own: { uz: 'Faqat o‘zingizning kontaktingizni yuboring.', ru: 'Отправьте только свой контакт.', en: 'Please share your own contact.' },
  lang_pick: { uz: 'Tilni tanlang:', ru: 'Выберите язык:', en: 'Choose a language:' },
  lang_set: { uz: 'Til o‘zgartirildi.', ru: 'Язык изменён.', en: 'Language updated.' },
  error: { uz: 'Xatolik: {code}', ru: 'Ошибка: {code}', en: 'Error: {code}' },
  help: {
    uz: '/runs — yaqin yugurishlar\n/my — yugurishlarim\n/points — eko-ballar\n/checkin — check-in\n/redeem — kodni ishlatish (hamkorlar)\n/lang — til',
    ru: '/runs — пробежки рядом\n/my — мои пробежки\n/points — эко-баллы\n/checkin — отметиться\n/redeem — погасить код (партнёры)\n/lang — язык',
    en: '/runs — runs nearby\n/my — my runs\n/points — eco-points\n/checkin — check in\n/redeem — redeem a code (partners)\n/lang — language',
  },
} satisfies Record<string, Record<Lang, string>>;

export type Key = keyof typeof T;

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}) {
  return T[key][lang].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export const ERR: Record<string, Record<Lang, string>> = {
  women_only: { uz: 'Bu yugurish faqat ayollar uchun.', ru: 'Пробежка только для женщин.', en: 'This run is women-only.' },
  run_not_open: { uz: 'Yozilish yopilgan.', ru: 'Запись закрыта.', en: 'Registration is closed.' },
  run_started: { uz: 'Yugurish boshlangan.', ru: 'Пробежка уже началась.', en: 'The run has started.' },
  code_not_found: { uz: 'Kod topilmadi.', ru: 'Код не найден.', en: 'Code not found.' },
  code_already_used: { uz: 'Kod allaqachon ishlatilgan.', ru: 'Код уже использован.', en: 'Code already used.' },
  code_expired: { uz: 'Kod muddati o‘tgan.', ru: 'Срок кода истёк.', en: 'Code expired.' },
  out_of_stock: { uz: 'Sovg‘a tugagan.', ru: 'Награда закончилась.', en: 'Out of stock.' },
  already_reviewed: { uz: 'Allaqachon tekshirilgan.', ru: 'Уже проверено.', en: 'Already reviewed.' },
  phone_in_use: { uz: 'Bu raqam boshqa Telegram akkauntiga ulangan.', ru: 'Этот номер привязан к другому Telegram.', en: 'This phone is linked to another Telegram account.' },
  telegram_in_use: { uz: 'Bu Telegram boshqa akkauntga ulangan.', ru: 'Этот Telegram привязан к другому аккаунту.', en: 'This Telegram is linked to another account.' },
  blocked: { uz: 'Akkaunt bloklangan.', ru: 'Аккаунт заблокирован.', en: 'Account blocked.' },
  forbidden: { uz: 'Ruxsat yo‘q.', ru: 'Нет доступа.', en: 'Not allowed.' },
};
