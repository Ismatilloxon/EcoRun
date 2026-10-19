import { en, type Key } from './en.ts';
import { ru } from './ru.ts';
import { uz } from './uz.ts';

export type Lang = 'uz' | 'ru' | 'en';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'uz', label: 'O‘zbekcha' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
];
const dicts = { uz, ru, en };

export function translate(lang: Lang, key: Key | string, vars?: Record<string, string | number>) {
  const d = dicts[lang] as Record<string, string>;
  let s = d[key] ?? (en as Record<string, string>)[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  return s;
}

export const locale = (lang: Lang) => (lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'uz-Latn-UZ');

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'uz' || saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = navigator.language?.toLowerCase() ?? '';
  return nav.startsWith('ru') ? 'ru' : nav.startsWith('en') ? 'en' : 'uz';
}

export type { Key };
