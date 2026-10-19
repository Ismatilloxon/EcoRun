import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, connectRealtime, disconnectRealtime, hasSession, onRealtime, setLogoutHandler, setTokens } from './api.ts';
import { detectLang, translate, type Key, type Lang } from './i18n/index.ts';

export type Me = {
  id: string;
  phone: string | null;
  name: string | null;
  photo_url: string | null;
  gender: 'male' | 'female' | 'other' | null;
  age_range: string | null;
  district: string | null;
  level: string | null;
  pace_sec_per_km: number | null;
  preferred_distances: number[];
  preferred_time: string | null;
  language: Lang;
  role: 'runner' | 'club_organizer' | 'partner' | 'event_organizer' | 'moderator' | 'admin';
  visibility: 'all' | 'followers' | 'nobody';
  hide_location: boolean;
  notify_nearby: boolean;
  notify_radius_km: number;
  strava_verified: boolean;
  telegram_linked: boolean;
  telegram_username: string | null;
  invite_code: string;
  onboarded: boolean;
  totp_enabled: boolean;
  clubs: { id: string; name: string; logo_url: string | null; verified: boolean; role: string }[];
  partners: { id: string; name: string }[];
  followers: number;
  following: number;
  unread: number;
  points: { balance: number; pending: number; earned: number; level: number; current: number; next: number | null };
};

type Toast = { id: number; text: string; kind?: 'error' | 'ok' };
type Theme = 'system' | 'light' | 'dark';

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key | string, v?: Record<string, string | number>) => string;
  me: Me | null;
  loadingMe: boolean;
  refreshMe: () => Promise<Me | null>;
  login: (tokens: { accessToken: string; refreshToken: string }) => Promise<Me | null>;
  logout: () => Promise<void>;
  toast: (text: string, kind?: 'error' | 'ok') => void;
  errorText: (e: unknown) => string;
  theme: Theme;
  setTheme: (t: Theme) => void;
  unread: number;
  setUnread: (n: number) => void;
};

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const [me, setMe] = useState<Me | null>(null);
  const [loadingMe, setLoadingMe] = useState(hasSession());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setThemeState] = useState<Theme>(() => (safeGet('theme') as Theme) || 'system');
  const [unread, setUnread] = useState(0);
  const toastId = useRef(0);

  const t = useCallback((k: Key | string, v?: Record<string, string | number>) => translate(lang, k, v), [lang]);

  const toast = useCallback((text: string, kind?: 'error' | 'ok') => {
    const id = ++toastId.current;
    setToasts((x) => [...x, { id, text, kind }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 3500);
  }, []);

  const errorText = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        const key = `err.${e.code}`;
        const txt = translate(lang, key, { m: e.detail ?? '' });
        return txt === key ? translate(lang, 'err.generic') : txt;
      }
      if (e instanceof Error && translate(lang, `err.${e.message}`) !== `err.${e.message}`) return translate(lang, `err.${e.message}`);
      return translate(lang, 'err.generic');
    },
    [lang],
  );

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      safeSet('lang', l);
      if (me) api.patch('/me', { language: l }).catch(() => {});
    },
    [me],
  );

  const setTheme = useCallback((th: Theme) => {
    setThemeState(th);
    safeSet('theme', th);
  }, []);

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === 'uz' ? 'uz-Latn' : lang;
  }, [lang]);

  const refreshMe = useCallback(async () => {
    if (!hasSession()) {
      setMe(null);
      setLoadingMe(false);
      return null;
    }
    try {
      const m = await api.get<Me>('/me');
      setMe(m);
      setUnread(m.unread);
      if (m.language && m.language !== lang && !safeGet('lang')) setLangState(m.language);
      return m;
    } catch {
      return null;
    } finally {
      setLoadingMe(false);
    }
  }, [lang]);

  const login = useCallback(
    async (tokens: { accessToken: string; refreshToken: string }) => {
      setTokens(tokens);
      setLoadingMe(true);
      const m = await refreshMe();
      connectRealtime();
      // Keep the language the user picked before signing in.
      if (m && safeGet('lang') && m.language !== safeGet('lang')) api.patch('/me', { language: safeGet('lang') }).catch(() => {});
      return m;
    },
    [refreshMe],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setTokens(null);
    disconnectRealtime();
    setMe(null);
  }, []);

  useEffect(() => {
    setLogoutHandler(() => {
      disconnectRealtime();
      setMe(null);
    });
    refreshMe().then((m) => m && connectRealtime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      onRealtime((msg) => {
        if (msg.type === 'notification') {
          setUnread((n) => n + 1);
          if (!msg.notification?.data?.chat && msg.notification?.type !== 'checked_in') toast(msg.notification.title);
        }
      }),
    [toast],
  );

  const value = useMemo(
    () => ({ lang, setLang, t, me, loadingMe, refreshMe, login, logout, toast, errorText, theme, setTheme, unread, setUnread }),
    [lang, setLang, t, me, loadingMe, refreshMe, login, logout, toast, errorText, theme, setTheme, unread],
  );

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind === 'error' ? 'error' : ''}`}>
            {x.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

/** Small data-loading hook: returns [data, loading, error, reload]. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): [T | undefined, boolean, unknown, () => void, (v: T) => void] {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return [data, loading, error, () => setN((x) => x + 1), (v: T) => setData(v)];
}
