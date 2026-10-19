import { locale, type Lang } from '../i18n/index.ts';

export const TZ = 'Asia/Tashkent';

export function fmtPace(secPerKm?: number | null) {
  if (!secPerKm || !Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '–:––';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s === 60 ? 59 : s).padStart(2, '0')}`;
}

export function fmtDuration(sec?: number | null) {
  if (sec == null || !Number.isFinite(sec)) return '0:00';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const fmtKm = (m?: number | null, digits = 2) => ((m ?? 0) / 1000).toFixed(digits);
export const fmtNum = (n: number | null | undefined, lang: Lang) => new Intl.NumberFormat(locale(lang)).format(Math.round(Number(n ?? 0) * 10) / 10);

export function fmtDistanceAway(m: number | null | undefined) {
  if (m == null) return '';
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

function dayDiff(d: Date) {
  const f = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(x);
  const a = new Date(f(d));
  const b = new Date(f(new Date()));
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

// Browser ICU data often lacks Uzbek month names ("M10"), so Uzbek dates are formatted by hand.
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const UZ_MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const UZ_DAYS = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
function tzParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day), wd };
}
function uzDate(d: Date, opts: Intl.DateTimeFormatOptions) {
  const p = tzParts(d);
  const month = opts.month === 'long' ? UZ_MONTHS[p.m] : UZ_MONTHS_SHORT[p.m];
  let out = opts.day ? `${p.d}-${month}` : month;
  if (opts.year) out += ` ${p.y}`;
  if (opts.weekday) out = `${UZ_DAYS[p.wd]}, ${out}`;
  return out;
}

export function fmtTime(d: string | Date, lang: Lang) {
  return new Date(d).toLocaleTimeString(locale(lang), { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(d: string | Date, lang: Lang, t: (k: string) => string) {
  const date = new Date(d);
  const diff = dayDiff(date);
  if (diff === 0) return t('common.today');
  if (diff === 1) return t('common.tomorrow');
  if (lang === 'uz') return uzDate(date, { weekday: 'short', day: 'numeric', month: 'short' });
  return date.toLocaleDateString(locale(lang), { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
}

export const fmtWhen = (d: string | Date, lang: Lang, t: (k: string) => string) => `${fmtDay(d, lang, t)} · ${fmtTime(d, lang)}`;

export function fmtDate(d: string | Date | null | undefined, lang: Lang, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '';
  if (lang === 'uz') return uzDate(new Date(d), opts);
  return new Date(d).toLocaleDateString(locale(lang), { timeZone: TZ, ...opts });
}

export function fmtDateTime(d: string | Date | null | undefined, lang: Lang) {
  if (!d) return '';
  if (lang === 'uz') return `${uzDate(new Date(d), { day: 'numeric', month: 'short' })}, ${fmtTime(d, lang)}`;
  return new Date(d).toLocaleString(locale(lang), { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(d: string | Date, lang: Lang) {
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (lang === 'uz') {
    const [n, unit] = abs < 60 ? [Math.round(abs), 'soniya'] : abs < 3600 ? [Math.round(abs / 60), 'daqiqa'] : abs < 86400 ? [Math.round(abs / 3600), 'soat'] : [Math.round(abs / 86400), 'kun'];
    if (abs < 60) return 'hozir';
    return diff > 0 ? `${n} ${unit}dan keyin` : `${n} ${unit} oldin`;
  }
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** Date + time input values in Tashkent time <-> ISO. */
export function toLocalInputs(iso: string) {
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}
export function fromLocalInputs(date: string, time: string) {
  return new Date(`${date}T${time}:00+05:00`).toISOString();
}

export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';

export function parsePace(s: string) {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
