import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { LANGS } from '../i18n/index.ts';
import { getPosition } from '../lib/geo.ts';
import { fmtPace } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Chips, NavBar, PhotoInput, Segmented } from '../ui/ui.tsx';

const inviteKey = 'invite';
const saveInvite = (code: string | null) => {
  try {
    if (code) localStorage.setItem(inviteKey, code);
  } catch {
    /* ignore */
  }
};
const readInvite = () => {
  try {
    return localStorage.getItem(inviteKey) ?? undefined;
  } catch {
    return undefined;
  }
};

function LangSwitch() {
  const { lang, setLang } = useApp();
  return <Segmented value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} label="Language" />;
}

export function Welcome() {
  const { t, me } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  useEffect(() => {
    saveInvite(sp.get('invite'));
  }, [sp]);
  useEffect(() => {
    if (me) nav(me.onboarded ? '/' : '/onboarding', { replace: true });
  }, [me, nav]);
  return (
    <main className="screen no-tab" style={{ justifyContent: 'space-between', gap: 28 }}>
      <div style={{ paddingTop: 12 }}>
        <LangSwitch />
      </div>
      <div className="col" style={{ gap: 18, alignItems: 'flex-start' }}>
        <img src="/icon.svg" alt="" width={72} height={72} style={{ borderRadius: 18 }} />
        <h1 style={{ fontSize: 40, lineHeight: '44px', fontWeight: 800, letterSpacing: '-0.03em', whiteSpace: 'pre-line' }}>{t('welcome.title')}</h1>
        <p className="muted" style={{ fontSize: 19, lineHeight: '26px' }}>{t('welcome.subtitle')}</p>
      </div>
      <div className="col" style={{ gap: 10 }}>
        <Link className="btn block" to="/login">
          <Icon name="person" size={20} /> {t('welcome.phone')}
        </Link>
        <Link className="btn block tinted" to="/login?method=telegram">
          <Icon name="telegram" size={20} /> {t('welcome.telegram')}
        </Link>
        <Link className="btn block plain" to="/runs">{t('welcome.guest')}</Link>
        <p className="caption center">
          <Link to="/page/terms">{t('st.terms')}</Link> · <Link to="/page/privacy">{t('st.privacyPolicy')}</Link>
        </p>
      </div>
    </main>
  );
}

type Providers = { phone: boolean; sms: boolean; telegram: boolean; telegramBot: string | null; google: string | null; apple: string | null };

export function Login() {
  const { t, login, toast, errorText } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [sp] = useSearchParams();
  const [providers] = useLoad<Providers>(() => api.get('/auth/providers'));
  const [step, setStep] = useState<'phone' | 'code' | 'totp' | 'telegram'>(sp.get('method') === 'telegram' ? 'telegram' : 'phone');
  const [phone, setPhone] = useState('+998 ');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [tg, setTg] = useState<{ token: string; url: string } | null>(null);
  const from = (loc.state as any)?.from as string | undefined;

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const finish = async (res: any) => {
    if (res.mfaRequired) {
      setTicket(res.ticket);
      setCode('');
      setStep('totp');
      return;
    }
    const m = await login(res);
    nav(m?.onboarded ? from ?? '/' : '/onboarding', { replace: true });
  };

  const requestCode = async () => {
    setBusy(true);
    try {
      const r = await api.post('/auth/otp/request', { phone });
      setDevCode(r.devCode ?? null);
      setStep('code');
      setCooldown(60);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const r = step === 'totp' ? await api.post('/auth/totp', { ticket, code }) : await api.post('/auth/otp/verify', { phone, code, invite: readInvite() });
      await finish(r);
    } catch (e) {
      toast(errorText(e), 'error');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  // Telegram: get a one-time token, open the bot, poll until the user confirms.
  useEffect(() => {
    if (step !== 'telegram') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    let done = false;
    let poll: (() => Promise<void>) | null = null;

    const schedule = () => {
      if (!alive || done || document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      timer = setTimeout(() => void poll?.(), 2000);
    };

    // iOS and Android throttle timers while Telegram is in the foreground. Poll
    // immediately when the user returns so the login does not appear stuck.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll?.();
    };
    document.addEventListener('visibilitychange', onVisibility);

    api
      .post('/auth/telegram/start')
      .then((r) => {
        if (!alive) return;
        setTg(r);
        poll = async () => {
          if (!alive || done || inFlight) return;
          inFlight = true;
          try {
            const p = await api.get(`/auth/telegram/poll?token=${encodeURIComponent(r.token)}`);
            if (p.status === 'ok') {
              done = true;
              clearTimeout(timer);
              if (alive) await finish(p);
              return;
            }
          } catch (e) {
            if (alive) toast(errorText(e), 'error');
            done = true;
            return;
          } finally {
            inFlight = false;
          }
          schedule();
        };
        void poll();
      })
      .catch((e) => {
        toast(errorText(e), 'error');
        setStep('phone');
      });
    return () => {
      alive = false;
      done = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    codeRef.current?.focus();
  }, [step]);

  return (
    <main className="screen no-tab">
      <NavBar back={step === 'phone' || step === 'telegram' ? '/welcome' : undefined} />
      {step === 'phone' && (
        <form className="col" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); requestCode(); }}>
          <h1 className="large-title">{t('login.phoneTitle')}</h1>
          <p className="muted">{t('login.phoneHint')}</p>
          <label className="sr-only" htmlFor="phone">{t('login.phoneTitle')}</label>
          <input id="phone" className="input-big" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
          <button className="btn block" disabled={busy || phone.replace(/\D/g, '').length < 9}>{t('login.sendCode')}</button>
          {providers?.telegram && (
            <button type="button" className="btn block tinted" onClick={() => setStep('telegram')}>
              <Icon name="telegram" size={20} /> {t('welcome.telegram')}
            </button>
          )}
          <p className="caption center">{t('welcome.terms')}</p>
        </form>
      )}
      {(step === 'code' || step === 'totp') && (
        <form className="col" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <h1 className="large-title">{step === 'totp' ? t('login.totpTitle') : t('login.codeTitle')}</h1>
          <p className="muted">{step === 'totp' ? t('login.totpHint') : t('login.codeSent', { phone })}</p>
          {step === 'code' && devCode && (
            <p className="badge blue" style={{ alignSelf: 'flex-start', fontSize: 15, padding: '6px 10px' }}>
              {t('login.devCode', { code: devCode })}
            </p>
          )}
          <label className="sr-only" htmlFor="code">{t('login.codeTitle')}</label>
          <input
            id="code"
            ref={codeRef}
            className="input-big otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(v);
            }}
          />
          <button className="btn block" disabled={busy || code.length !== 6}>{t('login.verify')}</button>
          {step === 'code' && (
            <div className="row-flex" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn plain" onClick={() => setStep('phone')}>{t('login.changePhone')}</button>
              <button type="button" className="btn plain" disabled={cooldown > 0 || busy} onClick={requestCode}>
                {cooldown > 0 ? t('login.resendIn', { s: cooldown }) : t('login.resend')}
              </button>
            </div>
          )}
        </form>
      )}
      {step === 'telegram' && (
        <div className="col" style={{ gap: 18, alignItems: 'center', textAlign: 'center', paddingTop: 40 }}>
          <span className="tile lg" style={{ background: '#2AABEE', width: 72, height: 72, borderRadius: 20 }}><Icon name="telegram" size={40} /></span>
          <h1 className="title2">{t('login.telegramWaiting')}</h1>
          <div className="spinner" />
          {tg && (
            <a
              className="btn block"
              href={tg.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                // Capacitor's WebView can keep target=_blank links inside the
                // app. A direct navigation lets iOS/Android hand the t.me
                // universal link to the Telegram app when it is installed.
                if (Capacitor.isNativePlatform()) {
                  e.preventDefault();
                  window.location.assign(tg.url);
                }
              }}
            >
              {t('login.telegramOpen')}
            </a>
          )}
          <button className="btn plain" onClick={() => setStep('phone')}>{t('welcome.phone')}</button>
        </div>
      )}
    </main>
  );
}

const AGE = ['18-24', '25-34', '35-44', '45-54', '55+'];

export function Onboarding() {
  const { t, me, refreshMe, toast, errorText } = useApp();
  const nav = useNavigate();
  const [meta] = useLoad<{ districts: string[] }>(() => api.get('/meta'));
  const [step, setStep] = useState(1);
  const [f, setF] = useState({
    name: me?.name ?? '',
    photo_url: me?.photo_url ?? null,
    gender: me?.gender ?? null,
    age_range: me?.age_range ?? null,
    district: me?.district ?? null,
    level: me?.level ?? 'beginner',
    pace: me?.pace_sec_per_km ?? 390,
    preferred_distances: me?.preferred_distances?.length ? me.preferred_distances : [5],
    preferred_time: me?.preferred_time ?? 'morning',
  });
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));

  const save = async (extra: Record<string, unknown> = {}) => {
    try {
      await api.patch('/me', {
        name: f.name.trim(),
        photo_url: f.photo_url,
        gender: f.gender ?? 'other',
        age_range: f.age_range,
        district: f.district,
        level: f.level,
        pace_sec_per_km: f.pace,
        preferred_distances: f.preferred_distances.map(Number),
        preferred_time: f.preferred_time,
        ...extra,
      });
      return true;
    } catch (e) {
      toast(errorText(e), 'error');
      return false;
    }
  };

  const finish = async (withLocation: boolean) => {
    if (withLocation) {
      try {
        const p = await getPosition();
        await api.post('/me/location', { lat: p.coords.latitude, lng: p.coords.longitude });
      } catch {
        /* permission denied is fine */
      }
    }
    if (await save({ onboarded: true })) {
      await refreshMe();
      nav('/', { replace: true });
    }
  };

  return (
    <main className="screen no-tab tight">
      <div className="row-flex" style={{ justifyContent: 'space-between', paddingTop: 8 }}>
        {step > 1 ? <button className="btn plain" onClick={() => setStep(step - 1)}>{t('common.back')}</button> : <span />}
        <span className="footnote">{t('ob.step', { n: step, total: 3 })}</span>
      </div>

      {step === 1 && (
        <>
          <h1 className="large-title">{t('ob.title')}</h1>
          <div style={{ width: 140, alignSelf: 'center' }}>
            <PhotoInput value={f.photo_url} onChange={(u) => set('photo_url', u)} label={t('ob.photo')} />
          </div>
          <ul className="field-list">
            <li className="field">
              <label htmlFor="ob-name">{t('ob.name')}</label>
              <input id="ob-name" value={f.name} maxLength={60} placeholder={t('ob.namePh')} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
            </li>
          </ul>
          <section className="col" style={{ gap: 8 }}>
            <h2 className="group-label">{t('ob.gender')}</h2>
            <Segmented
              value={(f.gender ?? '') as any}
              onChange={(v) => set('gender', v)}
              options={[{ value: 'female', label: t('ob.gender.female') }, { value: 'male', label: t('ob.gender.male') }, { value: 'other', label: t('ob.gender.other') }]}
              label={t('ob.gender')}
            />
            <p className="group-foot">{t('ob.genderWhy')}</p>
          </section>
          <section className="col" style={{ gap: 8 }}>
            <h2 className="group-label">{t('ob.age')}</h2>
            <Chips value={f.age_range} onChange={(v) => set('age_range', v)} options={AGE.map((a) => ({ value: a, label: a }))} wrap label={t('ob.age')} />
          </section>
          <button className="btn block" disabled={!f.name.trim() || !f.gender} onClick={() => setStep(2)}>{t('common.next')}</button>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="large-title">{t('ob.runTitle')}</h1>
          <section className="col" style={{ gap: 8 }}>
            <h2 className="group-label">{t('ob.level')}</h2>
            <Segmented
              value={f.level as any}
              onChange={(v) => set('level', v)}
              options={(['beginner', 'intermediate', 'advanced'] as const).map((l) => ({ value: l, label: t(`level.${l}`) }))}
              label={t('ob.level')}
            />
          </section>
          <ul className="field-list">
            <li className="field">
              <label htmlFor="ob-district">{t('ob.district')}</label>
              <select id="ob-district" value={f.district ?? ''} onChange={(e) => set('district', e.target.value || null)}>
                <option value="">{t('ob.choose')}</option>
                {meta?.districts.map((d) => <option key={d}>{d}</option>)}
              </select>
            </li>
            <li className="field">
              <label htmlFor="ob-pace">{t('ob.pace')}</label>
              <input id="ob-pace" type="range" min={210} max={600} step={15} value={f.pace} onChange={(e) => set('pace', Number(e.target.value))} aria-valuetext={`${fmtPace(f.pace)} /km`} />
              <span style={{ minWidth: 70, textAlign: 'right' }}>{fmtPace(f.pace)}{t('common.perKm')}</span>
            </li>
          </ul>
          <section className="col" style={{ gap: 8 }}>
            <h2 className="group-label">{t('ob.distances')}</h2>
            <Chips value={f.preferred_distances.map(String)} multi onChange={(v: string[]) => set('preferred_distances', v.map(Number))} options={['3', '5', '10', '21', '42'].map((d) => ({ value: d, label: `${d} ${t('common.km')}` }))} wrap label={t('ob.distances')} />
          </section>
          <section className="col" style={{ gap: 8 }}>
            <h2 className="group-label">{t('ob.time')}</h2>
            <Segmented value={f.preferred_time as any} onChange={(v) => set('preferred_time', v)} options={(['morning', 'day', 'evening'] as const).map((x) => ({ value: x, label: t(`time.${x}`) }))} label={t('ob.time')} />
          </section>
          <button className="btn block" onClick={async () => (await save()) && setStep(3)}>{t('common.next')}</button>
        </>
      )}

      {step === 3 && (
        <div className="col" style={{ gap: 20, alignItems: 'center', textAlign: 'center', paddingTop: 30 }}>
          <span className="tile lg" style={{ background: 'var(--blue)', width: 80, height: 80, borderRadius: 24 }}><Icon name="locate" size={42} /></span>
          <h1 className="title2">{t('ob.locTitle')}</h1>
          <p className="muted">{t('ob.locBody')}</p>
          <button className="btn block" onClick={() => finish(true)}>{t('ob.locAllow')}</button>
          <button className="btn block plain" onClick={() => finish(false)}>{t('ob.locSkip')}</button>
        </div>
      )}
    </main>
  );
}
